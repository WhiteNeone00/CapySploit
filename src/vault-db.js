import { DEFAULT_PAYLOAD } from '../payload.js';

export function getDB(env) {
  return env && (env.capi_db || env.CAPI_DB || env.DB || env.CAPI_db);
}

export async function ensureTables(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    // Ranks table (Admin, Reseller, User)
    await DB.prepare(`CREATE TABLE IF NOT EXISTS ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT,
      access_level INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )`).run();

    // Plans table (Default, VIP, Holder, Raw, Star)
    await DB.prepare(`CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT,
      max_time INTEGER DEFAULT 60,
      max_concurrents INTEGER DEFAULT 1,
      max_daily_attacks INTEGER DEFAULT 100,
      created_at TEXT
    )`).run();

    // Presets table (combinations of rank + plan)
    await DB.prepare(`CREATE TABLE IF NOT EXISTS presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      rank_id INTEGER,
      plan_id INTEGER,
      description TEXT,
      created_at TEXT,
      FOREIGN KEY(rank_id) REFERENCES ranks(id),
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT,
      admin INTEGER DEFAULT 0,
      reseller INTEGER DEFAULT 0,
      vip INTEGER DEFAULT 0,
      holder INTEGER DEFAULT 0,
      api_access INTEGER DEFAULT 0,
      max_time INTEGER DEFAULT 60,
      min_time INTEGER DEFAULT 30,
      cooldown INTEGER DEFAULT 45,
      max_concurrents INTEGER DEFAULT 1,
      max_daily_attacks INTEGER DEFAULT 100,
      created_by TEXT,
      created_at TEXT,
      last_request_time TEXT,
      expiry_unix INTEGER
    )`).run();

    const addColumn = async (sql) => { try { await DB.prepare(sql).run(); } catch (e) {} };
    await addColumn("ALTER TABLE users ADD COLUMN allowed_methods TEXT");
    await addColumn("ALTER TABLE users ADD COLUMN allowed_targets TEXT");
    await addColumn("ALTER TABLE users ADD COLUMN bypass_slots INTEGER DEFAULT 0");
    await addColumn("ALTER TABLE users ADD COLUMN suspended INTEGER DEFAULT 0");
    await addColumn("ALTER TABLE users ADD COLUMN suspend_reason TEXT");
    await addColumn("ALTER TABLE users ADD COLUMN suspended_by TEXT");
    await addColumn("ALTER TABLE users ADD COLUMN service_name TEXT");
    await addColumn("ALTER TABLE users ADD COLUMN power_saving INTEGER DEFAULT 1");
    await addColumn("ALTER TABLE users ADD COLUMN bypass_anti_spam INTEGER DEFAULT 0");
    await addColumn("ALTER TABLE users ADD COLUMN bypass_blacklist INTEGER DEFAULT 0");
    await addColumn("ALTER TABLE users ADD COLUMN expires_at TEXT");
    await addColumn("ALTER TABLE users ADD COLUMN last_ip TEXT");
    await addColumn('ALTER TABLE discord_links ADD COLUMN discord_username TEXT');
    await addColumn('ALTER TABLE discord_links ADD COLUMN unlinked_at TEXT');
    // Performance indexes for common queries
    await addColumn("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)");
    await addColumn("CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)");
    await addColumn("CREATE INDEX IF NOT EXISTS idx_logs_username ON logs(username)");
    await addColumn("CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at)");
    await addColumn("CREATE INDEX IF NOT EXISTS idx_discord_links_discord_user_id ON discord_links(discord_user_id)");
    await addColumn("CREATE INDEX IF NOT EXISTS idx_user_warnings_username ON user_warnings(username)");
    await addColumn("CREATE INDEX IF NOT EXISTS idx_blacklist_target ON blacklist(target)");
    await DB.prepare(`CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      target TEXT,
      port TEXT,
      method TEXT,
      duration TEXT,
      concurrents INTEGER,
      created_at TEXT
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS api_endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      url TEXT,
      method TEXT DEFAULT 'GET',
      active INTEGER DEFAULT 1,
      created_at TEXT
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT,
      default_user INTEGER DEFAULT 0,
      vip_user INTEGER DEFAULT 1,
      reseller INTEGER DEFAULT 1,
      admin INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT,
      reason TEXT,
      created_at TEXT
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS user_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      target TEXT,
      count INTEGER DEFAULT 0,
      last_warning TEXT,
      expires_at TEXT
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS ongoing_attacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      target TEXT,
      port TEXT,
      method TEXT,
      duration INTEGER,
      started_at TEXT,
      expires_at TEXT,
      status TEXT DEFAULT 'running'
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS discord_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      client TEXT,
      code TEXT UNIQUE,
      discord_user_id TEXT,
      discord_username TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT,
      expires_at TEXT,
      verified_at TEXT,
      unlinked_at TEXT
    )`).run();

    // Attack queue table for storing queued attacks when slots are full
    await DB.prepare(`CREATE TABLE IF NOT EXISTS attack_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      target TEXT,
      port TEXT,
      method TEXT,
      duration INTEGER,
      threads INTEGER DEFAULT 0,
      rps INTEGER DEFAULT 0,
      len INTEGER DEFAULT 72,
      geo TEXT,
      concurrents INTEGER DEFAULT 1,
      queued_at TEXT,
      status TEXT DEFAULT 'pending',
      reason TEXT,
      position INTEGER
    )`).run();

    // System settings table for global configuration
    await DB.prepare(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      type TEXT,
      description TEXT,
      updated_at TEXT
    )`).run();

    // Initialize default settings if not exists
    await DB.prepare(`INSERT OR IGNORE INTO system_settings (key, value, type, description, updated_at) VALUES 
      ('maintenance_mode', 'false', 'boolean', 'Enable/disable maintenance mode', ?),
      ('attacks_disabled', 'false', 'boolean', 'Disable all attack requests globally', ?)
    `).bind(new Date().toISOString(), new Date().toISOString()).run();

    const countMethods = await DB.prepare('SELECT COUNT(*) AS c FROM methods').all();
    if ((countMethods && countMethods.results && countMethods.results[0] && countMethods.results[0].c) === 0) {
      const defaults = (DEFAULT_PAYLOAD.methods || []).map(item => [item.name, item.description || `${item.name} method`]);
      for (const [name, description] of defaults) {
        await DB.prepare('INSERT OR IGNORE INTO methods (name, description, created_at) VALUES (?, ?, ?)').bind(name, description, new Date().toISOString()).run();
      }
    }

    const countBlacklist = await DB.prepare('SELECT COUNT(*) AS c FROM blacklist').all();
    if ((countBlacklist && countBlacklist.results && countBlacklist.results[0] && countBlacklist.results[0].c) === 0) {
      const targets = (DEFAULT_PAYLOAD.blacklists && DEFAULT_PAYLOAD.blacklists.Blacklists_Targets) || [];
      for (const target of targets) {
        await DB.prepare('INSERT OR IGNORE INTO blacklist (target, reason, created_at) VALUES (?, ?, ?)').bind(target, 'payload-default', new Date().toISOString()).run();
      }
    }
  } catch (e) {}
}

export async function getUser(env, username) {
  const DB = getDB(env);
  if (!DB) return null;
  const res = await DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).all();
  return (res && res.results && res.results[0]) || null;
}

/**
 * Batch-get multiple users by usernames (reduces individual queries)
 * @param {Object} env - Cloudflare Workers environment
 * @param {Array<string>} usernames - Array of usernames to fetch
 * @returns {Promise<Object>} Map of username -> user object
 */
export async function getUserBatch(env, usernames = []) {
  if (!usernames || !usernames.length) return {};
  const DB = getDB(env);
  if (!DB) return {};
  try {
    const placeholders = usernames.map(() => '?').join(',');
    const res = await DB.prepare(`SELECT * FROM users WHERE username IN (${placeholders})`).bind(...usernames).all();
    const map = {};
    (res?.results || []).forEach(user => {
      map[user.username] = user;
    });
    return map;
  } catch (e) {
    console.error('Error in getUserBatch:', e.message);
    return {};
  }
}

export async function saveUser(env, user) {
  const DB = getDB(env);
  if (!DB) return;
  const now = new Date().toISOString();
  // Use INSERT OR REPLACE for atomic upsert - all fields to preserve on update
  // Note: Removed duplicate concurrents (use max_concurrents), discord_linked (use discord_links table), preset, warn_count (use user_warnings table)
  try {
    await DB.prepare(`INSERT OR REPLACE INTO users 
      (username,password,admin,reseller,vip,holder,api_access,max_time,min_time,cooldown,max_concurrents,max_daily_attacks,created_by,created_at,last_request_time,expiry_unix,allowed_methods,allowed_targets,bypass_slots,suspended,suspend_reason,suspended_by,service_name,power_saving,bypass_anti_spam,bypass_blacklist,expires_at) 
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      user.username,
      user.password,
      user.admin ? 1 : 0,
      user.reseller ? 1 : 0,
      user.vip ? 1 : 0,
      user.holder ? 1 : 0,
      user.api_access ? 1 : 0,
      user.max_time || 60,
      user.min_time || 30,
      user.cooldown || 45,
      user.max_concurrents || 1,
      user.max_daily_attacks || 100,
      user.created_by || 'root',
      user.created_at || now,
      user.last_request_time || now,
      user.expiry_unix || 0,
      user.allowed_methods || null,
      user.allowed_targets || null,
      user.bypass_slots ? 1 : 0,
      user.suspended ? 1 : 0,
      user.suspend_reason || null,
      user.suspended_by || null,
      user.service_name || null,
      user.power_saving !== undefined ? (user.power_saving ? 1 : 0) : 1,
      user.bypass_anti_spam ? 1 : 0,
      user.bypass_blacklist ? 1 : 0,
      user.expires_at || null
    ).run();
  } catch (error) {
    console.error('Error in saveUser:', error.message);
    throw error;
  }
}

export async function deleteUser(env, username) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('DELETE FROM users WHERE username = ?').bind(username).run();
}

export async function listUsers(env) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare('SELECT username,admin,vip,reseller,holder,api_access,max_time,min_time,cooldown,max_concurrents,max_daily_attacks,created_by,created_at,expiry_unix,allowed_methods,allowed_targets,bypass_slots,suspended,service_name FROM users').all();
  return res.results || [];
}

export async function addLog(env, log) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('INSERT INTO logs (username,target,port,method,duration,concurrents,created_at) VALUES (?,?,?,?,?,?,?)').bind(log.username, log.target, log.port, log.method, log.duration, log.concurrents || 1, log.created_at || new Date().toISOString()).run();
}

export async function countUserDailyAttacks(env, username) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM logs WHERE username = ? AND datetime(created_at) >= datetime('now','-1 day')").bind(username).all();
  return (res && res.results && res.results[0] && res.results[0].c) || 0;
}

export async function getLastAttackTime(env, username) {
  const DB = getDB(env);
  if (!DB) return null;
  const res = await DB.prepare('SELECT created_at FROM logs WHERE username = ? ORDER BY created_at DESC LIMIT 1').bind(username).all();
  return (res && res.results && res.results[0] && res.results[0].created_at) || null;
}

export async function updateUserLastRequestTime(env, username, ip = null) {
  const DB = getDB(env);
  if (!DB) return;
  const sql = ip 
    ? 'UPDATE users SET last_request_time = ?, last_ip = ? WHERE username = ?'
    : 'UPDATE users SET last_request_time = ? WHERE username = ?';
  const params = ip 
    ? [new Date().toISOString(), ip, username]
    : [new Date().toISOString(), username];
  await DB.prepare(sql).bind(...params).run();
}

export async function getUserLastRequestTime(env, username) {
  const DB = getDB(env);
  if (!DB) return null;
  const res = await DB.prepare('SELECT last_request_time FROM users WHERE username = ?').bind(username).all();
  return (res && res.results && res.results[0] && res.results[0].last_request_time) || null;
}

// ==================== ATTACK QUEUE FUNCTIONS ====================
// Queue system for attacks when API slots or method slots are full

/**
 * Add an attack to the queue when slots are full
 * @param {Object} env - Environment object with database
 * @param {Object} attack - Attack data to queue
 * @param {string} reason - Reason for queueing (e.g., 'api_slots_full', 'method_slots_full')
/**
 * Queue an attack for later execution when slots become available
 * 
 * When API slots or method-specific slots are full, attacks are queued
 * instead of being rejected. Each queued attack gets a position number
 * that determines when it will be executed.
 * 
 * @param {Object} env - Cloudflare Workers environment with D1 database
 * @param {Object} attack - Attack object containing target, method, etc.
 * @param {string} reason - Reason for queuing (e.g., 'api_slots_full', 'method_slots_full')
 * @returns {Promise<number>} The queue position assigned to this attack
 */
export async function queueAttack(env, attack, reason) {
  const DB = getDB(env);
  if (!DB) return null;
  
  // Get current queue position (highest existing + 1)
  const posRes = await DB.prepare('SELECT MAX(position) AS max_pos FROM attack_queue WHERE status = ?').bind('pending').all();
  const maxPos = (posRes?.results?.[0]?.max_pos) || 0;
  const newPosition = maxPos + 1;
  
  await DB.prepare(`
    INSERT INTO attack_queue 
    (username, target, port, method, duration, threads, rps, len, geo, concurrents, queued_at, status, reason, position) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    attack.username,
    attack.target,
    attack.port || '80',
    attack.method,
    attack.duration || 60,
    attack.threads || 0,
    attack.rps || 0,
    attack.len || 72,
    attack.geo || null,
    attack.concurrents || 1,
    new Date().toISOString(),
    'pending',
    reason,
    newPosition
  ).run();
  
  return newPosition;
}

/**
 * Get queued attacks for a specific user
 * @param {Object} env - Environment object
 * @param {string} username - Username to get queue for
/**
 * Retrieve all queued attacks for a specific user
 * 
 * Returns pending attacks in position order. Users can check this
 * via the /api/queue_status endpoint to see their place in line.
 * 
 * @param {Object} env - Cloudflare Workers environment with D1 database
 * @param {string} username - Username to fetch queue for
 * @returns {Promise<Array>} Array of queued attack objects sorted by position
 */
export async function getQueuedAttacks(env, username) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare(
    'SELECT id, position, target, port, method, duration, concurrents, queued_at, reason FROM attack_queue WHERE username = ? AND status = ? ORDER BY position ASC'
  ).bind(username, 'pending').all();
  return res?.results || [];
}

/**
 * Get total queue length across all users
 * 
 * Returns the count of all pending attacks in the global queue.
 * Used to display queue statistics and manage system load.
 * 
 * @param {Object} env - Cloudflare Workers environment with D1 database
 * @returns {Promise<number>} Total number of pending attacks in queue
 */
export async function getQueueLength(env) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare('SELECT COUNT(*) AS c FROM attack_queue WHERE status = ?').bind('pending').all();
  return (res?.results?.[0]?.c) || 0;
}

export async function countUserQueued(env, username) {
  const DB = getDB(env);
  if (!DB || !username) return 0;
  const res = await DB.prepare('SELECT COUNT(*) AS c FROM attack_queue WHERE username = ? AND status = ?').bind(username, 'pending').all();
  return Number(res?.results?.[0]?.c || 0);
}

/**
 * Remove an attack from queue (when user can send it)
/**
 * Remove an attack from the queue and execute it
 * 
 * When a slot becomes available, this function is called to:
 * 1. Retrieve the attack data from the queue
 * 2. Mark it as processed
 * 3. Reposition all remaining queued attacks (move everyone up by 1)
 * 
 * @param {Object} env - Cloudflare Workers environment with D1 database
 * @param {number} queueId - Database ID of the queued attack entry
 * @returns {Promise<Object|null>} The attack data that was dequeued, or null if not found
 */
export async function dequeueAttack(env, queueId) {
  const DB = getDB(env);
  if (!DB) return null;
  
  // Get the attack data before deleting
  const res = await DB.prepare('SELECT * FROM attack_queue WHERE id = ? AND status = ?').bind(queueId, 'pending').all();
  const attackData = res?.results?.[0] || null;
  
  if (attackData) {
    // Mark as processed and reposition
    await DB.prepare('UPDATE attack_queue SET status = ? WHERE id = ?').bind('processed', queueId).run();
    
    // Reorder remaining queue
    await DB.prepare(`
      UPDATE attack_queue 
      SET position = position - 1 
      WHERE status = ? AND position > ?
    `).bind('pending', attackData.position).run();
  }
  
  return attackData;
}

export async function addOngoingAttack(env, rec) {
  const DB = getDB(env);
  if (!DB) return;
  const started_at = new Date().toISOString();
  const expires_at = new Date(Date.now() + (Number(rec.duration) || 60) * 1000).toISOString();
  await DB.prepare('INSERT INTO ongoing_attacks (username,target,port,method,duration,started_at,expires_at,status) VALUES (?,?,?,?,?,?,?,?)').bind(rec.username, rec.target, rec.port, rec.method, Number(rec.duration) || 60, started_at, expires_at, 'running').run();
}

export async function cleanupOngoing(env) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare("UPDATE ongoing_attacks SET status='finished' WHERE status='running' AND datetime(expires_at) <= datetime('now')").run();
}

export async function countOngoing(env) {
  const DB = getDB(env);
  if (!DB) return 0;
  await cleanupOngoing(env);
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM ongoing_attacks WHERE status='running' AND datetime(expires_at) > datetime('now')").all();
  return (res && res.results && res.results[0] && res.results[0].c) || 0;
}

export async function countUserOngoing(env, username) {
  const DB = getDB(env);
  if (!DB) return 0;
  await cleanupOngoing(env);
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM ongoing_attacks WHERE username = ? AND status='running' AND datetime(expires_at) > datetime('now')").bind(username).all();
  return (res && res.results && res.results[0] && res.results[0].c) || 0;
}

export async function countMethodOngoing(env, method) {
  const DB = getDB(env);
  if (!DB) return 0;
  await cleanupOngoing(env);
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM ongoing_attacks WHERE method = ? AND status='running' AND datetime(expires_at) > datetime('now')").bind(method).all();
  return (res && res.results && res.results[0] && res.results[0].c) || 0;
}

export async function getLogs(env, username) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare('SELECT * FROM logs WHERE username = ?').bind(username).all();
  return res.results || [];
}

export async function listOngoing(env) {
  const DB = getDB(env);
  if (!DB) return [];
  await cleanupOngoing(env);
  const res = await DB.prepare("SELECT id, username, target, port, method, duration, started_at, expires_at, status FROM ongoing_attacks WHERE status='running' AND datetime(expires_at) > datetime('now') ORDER BY started_at DESC").all();
  return res.results || [];
}

export async function getRecentAttacks(env, username, limit = 10) {
  const DB = getDB(env);
  if (!DB) return [];
  await cleanupOngoing(env);
  const ongoingRes = await DB.prepare("SELECT id, username, target, port, method, duration, started_at AS created_at, expires_at, status FROM ongoing_attacks WHERE username = ? AND status='running' ORDER BY started_at DESC").bind(username).all();
  const ongoing = ongoingRes.results || [];
  const logsRes = await DB.prepare('SELECT id, username, target, port, method, duration, created_at FROM logs WHERE username = ? ORDER BY created_at DESC LIMIT ?').bind(username, Number(limit || 10)).all();
  const logs = logsRes.results || [];
  // Merge ongoing first, then recent logs, dedupe by target+created_at
  const merged = [...ongoing, ...logs].slice(0, Number(limit || 10));
  return merged;
}

export async function addAPI(env, api) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('INSERT INTO api_endpoints (name,url,method,active,created_at) VALUES (?,?,?,?,?)').bind(api.name || 'api', api.url, (api.method || 'GET').toUpperCase(), api.active ? 1 : 0, new Date().toISOString()).run();
}

export async function listAPIs(env) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare('SELECT id,name,url,method,active,created_at FROM api_endpoints ORDER BY id DESC').all();
  return res.results || [];
}

export async function deleteAPI(env, id) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('DELETE FROM api_endpoints WHERE id = ?').bind(id).run();
}

export async function addMethod(env, method) {
  const DB = getDB(env);
  if (!DB) return;
  const name = (method.name || method).toLowerCase().trim();
  const description = method.description || `${name} method`;
  await DB.prepare('INSERT OR IGNORE INTO methods (name, description, created_at) VALUES (?, ?, ?)').bind(name, description, new Date().toISOString()).run();
}

export async function listMethods(env) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare('SELECT id, name, description, created_at FROM methods ORDER BY name ASC').all();
  return res.results || [];
}

export async function addBlacklistTarget(env, target, reason) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('INSERT INTO blacklist (target, reason, created_at) VALUES (?, ?, ?)').bind(target, reason || 'manual', new Date().toISOString()).run();
}

export async function listBlacklist(env) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare('SELECT id, target, reason, created_at FROM blacklist ORDER BY id DESC').all();
  return res.results || [];
}

export async function removeBlacklistTarget(env, idOrTarget) {
  const DB = getDB(env);
  if (!DB) return;
  if (idOrTarget && !isNaN(Number(idOrTarget))) {
    await DB.prepare('DELETE FROM blacklist WHERE id = ?').bind(Number(idOrTarget)).run();
  } else {
    await DB.prepare('DELETE FROM blacklist WHERE target = ?').bind(idOrTarget).run();
  }
}

export async function createDiscordLinkRequest(env, username, client, code, expiresAt) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('DELETE FROM discord_links WHERE username = ? AND client = ? AND status = ?').bind(username, client, 'pending').run();
  await DB.prepare('INSERT INTO discord_links (username, client, code, status, created_at, expires_at) VALUES (?,?,?,?,?,?)').bind(
    username,
    client,
    code,
    'pending',
    new Date().toISOString(),
    expiresAt
  ).run();
}

export async function getDiscordLinkByCode(env, code) {
  const DB = getDB(env);
  if (!DB) return null;
  const res = await DB.prepare('SELECT * FROM discord_links WHERE code = ?').bind(code).all();
  return (res && res.results && res.results[0]) || null;
}

export async function verifyDiscordLinkCode(env, code, discordUserId, discordUsername = null) {
  const DB = getDB(env);
  if (!DB) return null;
  const verifiedAt = new Date().toISOString();
  await DB.prepare('UPDATE discord_links SET status = ?, discord_user_id = ?, discord_username = ?, verified_at = ? WHERE code = ?').bind('verified', discordUserId, discordUsername, verifiedAt, code).run();
  const res = await DB.prepare('SELECT * FROM discord_links WHERE code = ?').bind(code).all();
  return (res && res.results && res.results[0]) || null;
}

export async function countVerifiedDiscordLinks(env) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM discord_links WHERE status = 'verified'").all();
  return (res && res.results && res.results[0] && res.results[0].c) || 0;
}

export async function countPendingDiscordLinks(env) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM discord_links WHERE status = 'pending'").all();
  return (res && res.results && res.results[0] && res.results[0].c) || 0;
}

export async function countLogsToday(env) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM logs WHERE datetime(created_at) >= datetime('now','start of day')").all();
  return (res && res.results && res.results[0] && res.results[0].c) || 0;
}

export async function countUsersByFlag(env, flag) {
  const DB = getDB(env);
  if (!DB) return 0;
  if (!['vip','holder','reseller','api_access','suspended'].includes(flag)) return 0;
  const res = await DB.prepare(`SELECT COUNT(*) AS c FROM users WHERE ${flag} = 1`).all();
  return (res && res.results && res.results[0] && res.results[0].c) || 0;
}

export async function getDiscordLinkByUsername(env, username) {
  const DB = getDB(env);
  if (!DB) return null;
  const res = await DB.prepare('SELECT * FROM discord_links WHERE username = ? ORDER BY created_at DESC LIMIT 1').bind(username).all();
  return (res && res.results && res.results[0]) || null;
}

export async function getVerifiedDiscordLinkByDiscordId(env, discordUserId) {
  const DB = getDB(env);
  if (!DB) return null;
  const res = await DB.prepare("SELECT * FROM discord_links WHERE discord_user_id = ? AND status = 'verified' ORDER BY verified_at DESC LIMIT 1").bind(discordUserId).all();
  return (res && res.results && res.results[0]) || null;
}

export async function getVerifiedDiscordLinkByUsername(env, username) {
  const DB = getDB(env);
  if (!DB) return null;
  const res = await DB.prepare("SELECT * FROM discord_links WHERE username = ? AND status = 'verified' ORDER BY verified_at DESC LIMIT 1").bind(username).all();
  return (res && res.results && res.results[0]) || null;
}

export async function unlinkDiscordLinkByUsername(env, username, unlinkedBy) {
  const DB = getDB(env);
  if (!DB) return null;
  const verifiedLink = await getVerifiedDiscordLinkByUsername(env, username);
  if (!verifiedLink) return null;
  const unlinkedAt = new Date().toISOString();
  await DB.prepare('UPDATE discord_links SET status = ?, unlinked_at = ? WHERE id = ?').bind('unlinked', unlinkedAt, verifiedLink.id).run();
  return { ...verifiedLink, status: 'unlinked', unlinked_at: unlinkedAt };
}

export async function unlinkDiscordLinkByDiscordId(env, discordUserId, unlinkedBy) {
  const DB = getDB(env);
  if (!DB) return null;
  const verifiedLink = await getVerifiedDiscordLinkByDiscordId(env, discordUserId);
  if (!verifiedLink) return null;
  const unlinkedAt = new Date().toISOString();
  await DB.prepare('UPDATE discord_links SET status = ?, unlinked_at = ? WHERE id = ?').bind('unlinked', unlinkedAt, verifiedLink.id).run();
  return { ...verifiedLink, status: 'unlinked', unlinked_at: unlinkedAt };
}

export async function getUserWarnings(env, username) {
  const DB = getDB(env);
  if (!DB) return { count: 0, limit: 5, suspended: false, last_warning: null };
  const res = await DB.prepare('SELECT * FROM user_warnings WHERE username = ?').bind(username).all();
  const row = res && res.results && res.results[0] ? res.results[0] : null;
  const count = Number(row?.count || 0);
  const lastWarning = row?.last_warning ? new Date(row.last_warning) : null;
  const now = new Date();
  const expired = lastWarning && !Number.isNaN(lastWarning.getTime()) && (now.getTime() - lastWarning.getTime()) > 7 * 24 * 60 * 60 * 1000;

  if (row && expired) {
    await DB.prepare('UPDATE user_warnings SET count = 0, last_warning = NULL WHERE username = ?').bind(username).run();
    return { count: 0, limit: 5, suspended: false, last_warning: null };
  }

  return { count, limit: 5, suspended: false, last_warning: row?.last_warning || null };
}

export async function incrementUserWarning(env, username, target) {
  const DB = getDB(env);
  if (!DB) return { count: 0, limit: 5, suspended: false };
  const existingWarnings = await getUserWarnings(env, username);
  const nextCount = Number(existingWarnings.count || 0) + 1;
  const ts = new Date().toISOString();
  const existing = await DB.prepare('SELECT * FROM user_warnings WHERE username = ?').bind(username).all();
  const row = existing && existing.results && existing.results[0] ? existing.results[0] : null;

  if (row) {
    await DB.prepare('UPDATE user_warnings SET target = ?, count = ?, last_warning = ? WHERE username = ?').bind(target || row.target, nextCount, ts, username).run();
  } else {
    await DB.prepare('INSERT INTO user_warnings (username, target, count, last_warning) VALUES (?, ?, ?, ?)').bind(username, target || null, nextCount, ts).run();
  }

  const limit = 5;
  const suspended = nextCount >= limit;
  if (suspended) {
    await DB.prepare('UPDATE users SET suspended = 1, suspend_reason = ?, suspended_by = ? WHERE username = ?').bind('Suspended by AutoMod after warning threshold reached.', 'AutoMod', username).run();
  }
  return { count: nextCount, limit, suspended };
}

export async function clearUserWarnings(env, username) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('DELETE FROM user_warnings WHERE username = ?').bind(username).run();
}

export async function setUserSuspension(env, username, suspended, reason = null, by = null) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('UPDATE users SET suspended = ?, suspend_reason = ?, suspended_by = ? WHERE username = ?').bind(suspended ? 1 : 0, reason || null, by || null, username).run();
}

// ==================== SEEDING FUNCTIONS ====================

export async function seedRanks(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const count = await DB.prepare('SELECT COUNT(*) AS c FROM ranks').all();
    if ((count?.results?.[0]?.c || 0) === 0) {
      const defaultRanks = [
        { name: 'Admin', description: 'Full control, manages users/methods/settings' },
        { name: 'Reseller', description: 'Can create sub-users and manage their own services' },
        { name: 'User', description: 'Standard API access with inherited limits' }
      ];
      for (const rank of defaultRanks) {
        await DB.prepare('INSERT OR IGNORE INTO ranks (name, description, created_at) VALUES (?, ?, ?)').bind(rank.name, rank.description, new Date().toISOString()).run();
      }
    }
  } catch (e) { console.error('seedRanks error:', e.message); }
}

export async function seedPlans(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const count = await DB.prepare('SELECT COUNT(*) AS c FROM plans').all();
    if ((count?.results?.[0]?.c || 0) === 0) {
      const defaultPlans = [
        { name: 'Default', description: 'Basic plan', max_time: 60, max_concurrents: 1, max_daily_attacks: 100 },
        { name: 'VIP', description: 'VIP plan with better limits', max_time: 300, max_concurrents: 3, max_daily_attacks: 500 },
        { name: 'Holder', description: 'Premium holder plan', max_time: 500, max_concurrents: 5, max_daily_attacks: 1000 },
        { name: 'Raw', description: 'Unlimited/custom plan', max_time: 9999, max_concurrents: 99, max_daily_attacks: 99999 },
        { name: 'Star', description: 'Special/legacy tier', max_time: 600, max_concurrents: 4, max_daily_attacks: 800 }
      ];
      for (const plan of defaultPlans) {
        await DB.prepare('INSERT OR IGNORE INTO plans (name, description, max_time, max_concurrents, max_daily_attacks, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
          plan.name, plan.description, plan.max_time, plan.max_concurrents, plan.max_daily_attacks, new Date().toISOString()
        ).run();
      }
    }
  } catch (e) { console.error('seedPlans error:', e.message); }
}

export async function seedPresets(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const count = await DB.prepare('SELECT COUNT(*) AS c FROM presets').all();
    if ((count?.results?.[0]?.c || 0) === 0) {
      // Get rank and plan IDs
      const ranks = await DB.prepare('SELECT id, name FROM ranks').all();
      const plans = await DB.prepare('SELECT id, name FROM plans').all();
      const rankMap = Object.fromEntries((ranks.results || []).map(r => [r.name, r.id]));
      const planMap = Object.fromEntries((plans.results || []).map(p => [p.name, p.id]));
      
      const defaultPresets = [
        { name: 'admin-raw', rank: 'Admin', plan: 'Raw', description: 'Admin with unlimited resources' },
        { name: 'reseller-vip', rank: 'Reseller', plan: 'VIP', description: 'Reseller with VIP limits' },
        { name: 'reseller-default', rank: 'Reseller', plan: 'Default', description: 'Reseller with basic limits' },
        { name: 'user-vip', rank: 'User', plan: 'VIP', description: 'User with VIP plan' },
        { name: 'user-default', rank: 'User', plan: 'Default', description: 'User with basic plan' },
        { name: 'user-holder', rank: 'User', plan: 'Holder', description: 'User with holder plan' }
      ];
      
      for (const preset of defaultPresets) {
        const rankId = rankMap[preset.rank];
        const planId = planMap[preset.plan];
        if (rankId && planId) {
          await DB.prepare('INSERT OR IGNORE INTO presets (name, rank_id, plan_id, description, created_at) VALUES (?, ?, ?, ?, ?)').bind(
            preset.name, rankId, planId, preset.description, new Date().toISOString()
          ).run();
        }
      }
    }
  } catch (e) { console.error('seedPresets error:', e.message); }
}

export async function seedRootUser(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const rootUser = env.ROOT_USER || env.CAPI_ROOT_USER || null;
    const rootPass = env.ROOT_PASS || env.CAPI_ROOT_PASS || null;
    
    // Require explicit env vars
    if (!rootUser || !rootPass) {
      console.warn('⚠️  ROOT_USER and ROOT_PASS env vars not set - root user auto-creation skipped');
      return;
    }

    const existing = await getUser(env, rootUser);
    if (!existing) {
      await saveUser(env, {
        username: rootUser,
        password: rootPass,
        admin: 1,
        reseller: 0,
        vip: 1,
        holder: 1,
        api_access: 1,
        max_time: 500,
        min_time: 30,
        cooldown: 10,
        concurrents: 3,
        max_daily_attacks: 1000,
        created_by: rootUser,
        expiry_unix: 0
      });
      console.log(`✓ Root user '${rootUser}' created automatically`);
    }
  } catch (e) { console.error('seedRootUser error:', e.message); }
}

export async function seedMethods(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const count = await DB.prepare('SELECT COUNT(*) AS c FROM methods').all();
    if ((count?.results?.[0]?.c || 0) === 0) {
      const defaults = (DEFAULT_PAYLOAD.methods || []).map(item => [item.name, item.description || `${item.name} method`]);
      for (const [name, description] of defaults) {
        await DB.prepare('INSERT OR IGNORE INTO methods (name, description, created_at) VALUES (?, ?, ?)').bind(name, description, new Date().toISOString()).run();
      }
      console.log(`✓ ${defaults.length} default methods seeded`);
    }
  } catch (e) { console.error('seedMethods error:', e.message); }
}

export async function seedBlacklist(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const count = await DB.prepare('SELECT COUNT(*) AS c FROM blacklist').all();
    if ((count?.results?.[0]?.c || 0) === 0) {
      const targets = (DEFAULT_PAYLOAD.blacklists?.Blacklists_Targets) || [];
      for (const target of targets) {
        await DB.prepare('INSERT OR IGNORE INTO blacklist (target, reason, created_at) VALUES (?, ?, ?)').bind(target, 'payload-default', new Date().toISOString()).run();
      }
      console.log(`✓ ${targets.length} blacklist entries seeded`);
    }
  } catch (e) { console.error('seedBlacklist error:', e.message); }
}

export async function initializeDatabase(env) {
  // Master initialization function - call this once on startup
  await ensureTables(env);
  await seedRanks(env);
  await seedPlans(env);
  await seedPresets(env);
  await seedMethods(env);
  await seedBlacklist(env);
  await seedRootUser(env);
}

/**
 * Get system setting by key from database
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} key - Setting key name
 * @returns {Promise<Object|null>} Setting object {key, value, type, description, updated_at} or null
 */
export async function getSystemSetting(env, key) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare('SELECT * FROM system_settings WHERE key = ?').bind(key).all();
    return res?.results?.[0] || null;
  } catch (e) {
    console.error(`Error getting system setting ${key}:`, e.message);
    return null;
  }
}

/**
 * Set system setting in database
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} key - Setting key name
 * @param {string} value - Setting value (stored as text)
 * @param {string} type - Data type: 'boolean', 'number', 'string'
 * @param {string} description - Human-readable description
 * @returns {Promise<void>}
 */
export async function setSystemSetting(env, key, value, type = 'string', description = '') {
  const DB = getDB(env);
  if (!DB) return;
  try {
    await DB.prepare(`INSERT OR REPLACE INTO system_settings (key, value, type, description, updated_at) VALUES (?, ?, ?, ?, ?)`).bind(
      key,
      String(value),
      type,
      description,
      new Date().toISOString()
    ).run();
  } catch (e) {
    console.error(`Error setting system setting ${key}:`, e.message);
  }
}

/**
 * Get maintenance mode status
 * @param {Object} env - Cloudflare Workers environment
 * @returns {Promise<boolean>} True if maintenance mode is enabled
 */
export async function getMaintenanceMode(env) {
  const setting = await getSystemSetting(env, 'maintenance_mode');
  return (setting?.value === 'true') || false;
}

/**
 * Set maintenance mode status
 * @param {Object} env - Cloudflare Workers environment
 * @param {boolean} enabled - Enable or disable maintenance mode
 * @returns {Promise<void>}
 */
export async function setMaintenanceMode(env, enabled) {
  await setSystemSetting(env, 'maintenance_mode', enabled ? 'true' : 'false', 'boolean', 'API maintenance mode - disables user attacks');
}

/**
 * Cleanup old logs from database to prevent unbounded growth
 * Keeps logs from last N days only
 * @param {Object} env - Cloudflare Workers environment
 * @param {number} retentionDays - Number of days to keep logs (default 30)
 * @returns {Promise<{deleted: number, error: string|null}>} Deletion result
 */
export async function cleanupOldLogs(env, retentionDays = 30) {
  const DB = getDB(env);
  if (!DB) return { deleted: 0, error: 'No database connection' };
  try {
    // Calculate cutoff date (N days ago)
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const cutoffISO = cutoffDate.toISOString();
    
    const deletedCounts = {};
    
    // Delete old logs
    const logResult = await DB.prepare('DELETE FROM logs WHERE created_at < ?').bind(cutoffISO).run();
    deletedCounts.logs = logResult?.meta?.changes || 0;
    
    // Delete old processed queue items
    const queueResult = await DB.prepare('DELETE FROM attack_queue WHERE status = ? AND queued_at < ?').bind('processed', cutoffISO).run();
    deletedCounts.queue = queueResult?.meta?.changes || 0;
    
    // Delete expired ongoing attacks
    const ongoingResult = await DB.prepare('DELETE FROM ongoing_attacks WHERE expires_at < ?').bind(cutoffISO).run();
    deletedCounts.ongoing = ongoingResult?.meta?.changes || 0;
    
    // Delete expired discord links (pending only)
    const discordResult = await DB.prepare('DELETE FROM discord_links WHERE status = ? AND expires_at < ?').bind('pending', cutoffISO).run();
    deletedCounts.discord = discordResult?.meta?.changes || 0;
    
    // Delete expired user warnings (older than 2 days)
    const warningResult = await DB.prepare('DELETE FROM user_warnings WHERE expires_at < ?').bind(now.toISOString()).run();
    deletedCounts.warnings = warningResult?.meta?.changes || 0;
    
    const totalDeleted = Object.values(deletedCounts).reduce((a, b) => a + b, 0);
    if (totalDeleted > 0) {
      console.log(`✓ Database cleanup: Deleted ${totalDeleted} old records (${retentionDays} day retention) - logs:${deletedCounts.logs} queue:${deletedCounts.queue} ongoing:${deletedCounts.ongoing} discord:${deletedCounts.discord} warnings:${deletedCounts.warnings}`);
    }
    
    return { deleted: totalDeleted, details: deletedCounts, error: null };
  } catch (e) {
    console.error('Error during database cleanup:', e.message);
    return { deleted: 0, error: e.message };
  }
}

/**
 * Get database statistics and health info
 * @param {Object} env - Cloudflare Workers environment
 * @returns {Promise<Object>} Stats including record counts
 */
export async function getDatabaseStats(env) {
  const DB = getDB(env);
  if (!DB) return { error: 'No database connection' };
  try {
    const counts = {};
    const tables = ['users', 'logs', 'ongoing_attacks', 'attack_queue', 'blacklist', 'discord_links', 'methods'];
    
    for (const table of tables) {
      const result = await DB.prepare(`SELECT COUNT(*) AS c FROM ${table}`).all();
      counts[table] = result?.results?.[0]?.c || 0;
    }
    
    return { success: true, counts, timestamp: new Date().toISOString() };
  } catch (e) {
    console.error('Error getting database stats:', e.message);
    return { error: e.message };
  }
}

/**
 * Get preset by name (admin-raw, user-vip, user-default, etc.)
 * Presets define default rank + plan combinations
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} presetName - Preset name (e.g., 'user-default')
 * @returns {Promise<Object|null>} Preset with rank and plan, or null if not found
 */
export async function getPreset(env, presetName) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare(`
      SELECT p.*, r.name as rank_name, pl.name as plan_name 
      FROM presets p
      LEFT JOIN ranks r ON p.rank_id = r.id
      LEFT JOIN plans pl ON p.plan_id = pl.id
      WHERE p.name = ?
    `).bind(presetName).all();
    return res?.results?.[0] || null;
  } catch (e) {
    console.error(`Error getting preset ${presetName}:`, e.message);
    return null;
  }
}

/**
 * Add a warning to a user for violations
 * Records warning in user_warnings table with 2-day expiration
 * Auto-suspends if active warnings >= 5
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} username - Username to warn
 * @param {string} reason - Reason for warning (e.g., 'blacklist_target', 'rate_limit_abuse')
 * @returns {Promise<Object>} Object with warning info and current active warning count
 */
export async function addUserWarning(env, username, reason = 'violation') {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const user = await getUser(env, username);
    if (!user) return null;
    
    // Record warning with 2-day expiration
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    
    await DB.prepare(`
      INSERT INTO user_warnings 
      (username, target, count, last_warning, expires_at) 
      VALUES (?, ?, ?, ?, ?)
    `).bind(username, reason, 1, now.toISOString(), expiresAt).run();
    
    // Count active (non-expired) warnings
    const activeWarnings = await DB.prepare(`
      SELECT COUNT(*) AS c FROM user_warnings 
      WHERE username = ? AND expires_at > ?
    `).bind(username, now.toISOString()).all();
    
    const activeCount = activeWarnings?.results?.[0]?.c || 0;
    
    // Auto-suspend if active warnings >= 5
    if (activeCount >= 5) {
      user.suspended = 1;
      user.suspend_reason = 'Multiple violations (auto-suspended)';
      user.suspended_by = 'system';
      await saveUser(env, user);
    }
    
    return { username, reason, activeCount, expiresAt };
  } catch (e) {
    console.error(`Error adding warning to ${username}:`, e.message);
    return null;
  }
}

/**
 * Get user warning record
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} username - Username
 * @returns {Promise<Object|null>} Warning record or null
 */
export async function getUserWarning(env, username) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare(`SELECT * FROM user_warnings WHERE username = ?`).bind(username).all();
    return res?.results?.[0] || null;
  } catch (e) {
    console.error(`Error getting warning for ${username}:`, e.message);
    return null;
  }
}

/**
 * Check if attacks are globally disabled
 * @param {Object} env - Cloudflare Workers environment
 * @returns {Promise<boolean>} True if attacks are disabled
 */
export async function getAttacksDisabled(env) {
  const setting = await getSystemSetting(env, 'attacks_disabled');
  return (setting?.value === 'true') || false;
}

/**
 * Set attacks disabled status
 * @param {Object} env - Cloudflare Workers environment
 * @param {boolean} disabled - Enable or disable attacks
 * @returns {Promise<void>}
 */
export async function setAttacksDisabled(env, disabled) {
  await setSystemSetting(env, 'attacks_disabled', disabled ? 'true' : 'false', 'boolean', 'Disable all attack requests globally');
}

/**
 * Get rank by name
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} rankName - Rank name (Admin, Reseller, User, etc.)
 * @returns {Promise<Object|null>} Rank object or null if not found
 */
export async function getRank(env, rankName) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare('SELECT * FROM ranks WHERE name = ?').bind(rankName).all();
    return res?.results?.[0] || null;
  } catch (e) {
    console.error(`Error getting rank ${rankName}:`, e.message);
    return null;
  }
}

/**
 * Update rank properties
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} rankName - Rank name
 * @param {Object} updates - Fields to update (access_level, description, etc.)
 * @returns {Promise<void>}
 */
export async function updateRank(env, rankName, updates = {}) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const fields = [];
    const values = [];
    
    if (updates.access_level !== undefined) {
      fields.push('access_level = ?');
      values.push(Number(updates.access_level));
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(rankName);
    
    const sql = `UPDATE ranks SET ${fields.join(', ')} WHERE name = ?`;
    await DB.prepare(sql).bind(...values).run();
  } catch (e) {
    console.error(`Error updating rank ${rankName}:`, e.message);
    throw e;
  }
}

/**
 * Get plan by name
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} planName - Plan name (Default, VIP, Holder, etc.)
 * @returns {Promise<Object|null>} Plan object or null if not found
 */
export async function getPlan(env, planName) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare('SELECT * FROM plans WHERE name = ?').bind(planName).all();
    return res?.results?.[0] || null;
  } catch (e) {
    console.error(`Error getting plan ${planName}:`, e.message);
    return null;
  }
}

/**
 * Update plan attack limits
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} planName - Plan name
 * @param {Object} updates - Fields to update (max_time, max_concurrents, max_daily_attacks)
 * @returns {Promise<void>}
 */
export async function updatePlan(env, planName, updates = {}) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const fields = [];
    const values = [];
    
    if (updates.max_time !== undefined) {
      fields.push('max_time = ?');
      values.push(Number(updates.max_time));
    }
    if (updates.max_concurrents !== undefined) {
      fields.push('max_concurrents = ?');
      values.push(Number(updates.max_concurrents));
    }
    if (updates.max_daily_attacks !== undefined) {
      fields.push('max_daily_attacks = ?');
      values.push(Number(updates.max_daily_attacks));
    }
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(planName);
    
    const sql = `UPDATE plans SET ${fields.join(', ')} WHERE name = ?`;
    await DB.prepare(sql).bind(...values).run();
  } catch (e) {
    console.error(`Error updating plan ${planName}:`, e.message);
    throw e;
  }
}

/**
 * Get method by name
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} methodName - Method name
 * @returns {Promise<Object|null>} Method object with access levels
 */
export async function getMethod(env, methodName) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare('SELECT * FROM methods WHERE name = ?').bind(methodName).all();
    return res?.results?.[0] || null;
  } catch (e) {
    console.error(`Error getting method ${methodName}:`, e.message);
    return null;
  }
}

/**
 * Update method access levels (which ranks/plans can use it)
 * @param {Object} env - Cloudflare Workers environment
 * @param {string} methodName - Method name
 * @param {Object} updates - Fields to update (default_user, vip_user, reseller, admin - all 0 or 1)
 * @returns {Promise<void>}
 */
export async function updateMethod(env, methodName, updates = {}) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const fields = [];
    const values = [];
    
    if (updates.default_user !== undefined) {
      fields.push('default_user = ?');
      values.push(Number(updates.default_user) ? 1 : 0);
    }
    if (updates.vip_user !== undefined) {
      fields.push('vip_user = ?');
      values.push(Number(updates.vip_user) ? 1 : 0);
    }
    if (updates.reseller !== undefined) {
      fields.push('reseller = ?');
      values.push(Number(updates.reseller) ? 1 : 0);
    }
    if (updates.admin !== undefined) {
      fields.push('admin = ?');
      values.push(Number(updates.admin) ? 1 : 0);
    }
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(methodName);
    
    const sql = `UPDATE methods SET ${fields.join(', ')} WHERE name = ?`;
    await DB.prepare(sql).bind(...values).run();
  } catch (e) {
    console.error(`Error updating method ${methodName}:`, e.message);
    throw e;
  }
}
