import { DEFAULT_PAYLOAD } from '../payload.js';

export function getDB(env) {
  return env && (env.capi_db || env.CAPI_DB || env.DB || env.CAPI_db);
}

export async function ensureTables(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
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
      concurrents INTEGER DEFAULT 1,
      max_concurrents INTEGER DEFAULT 1,
      max_daily_attacks INTEGER DEFAULT 100,
      created_by TEXT,
      expiry_unix INTEGER
    )`).run();

    const addColumn = async (sql) => { try { await DB.prepare(sql).run(); } catch (e) {} };
    await addColumn("ALTER TABLE users ADD COLUMN allowed_methods TEXT");
    await addColumn("ALTER TABLE users ADD COLUMN allowed_targets TEXT");
    await addColumn("ALTER TABLE users ADD COLUMN bypass_slots INTEGER DEFAULT 0");
    await addColumn("ALTER TABLE users ADD COLUMN suspended INTEGER DEFAULT 0");
    await addColumn("ALTER TABLE users ADD COLUMN suspend_reason TEXT");
    await addColumn("ALTER TABLE users ADD COLUMN suspended_by TEXT");
    await addColumn("ALTER TABLE users ADD COLUMN min_time INTEGER DEFAULT 30");
    await addColumn("ALTER TABLE users ADD COLUMN max_concurrents INTEGER DEFAULT 1");
    await addColumn("ALTER TABLE users ADD COLUMN service_name TEXT");
    await addColumn('ALTER TABLE discord_links ADD COLUMN discord_username TEXT');
    await addColumn('ALTER TABLE discord_links ADD COLUMN unlinked_at TEXT');
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
      created_at TEXT
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT,
      reason TEXT,
      created_at TEXT
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS user_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      target TEXT,
      count INTEGER DEFAULT 0,
      last_warning TEXT
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

export async function saveUser(env, user) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare(`INSERT OR REPLACE INTO users (username,password,admin,reseller,vip,holder,api_access,max_time,min_time,cooldown,concurrents,max_concurrents,max_daily_attacks,created_by,expiry_unix,allowed_methods,allowed_targets,bypass_slots,suspended,service_name,suspend_reason,suspended_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
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
    user.concurrents || 1,
    user.max_concurrents || user.concurrents || 1,
    user.max_daily_attacks || 100,
    user.created_by || 'root',
    user.expiry_unix || 0,
    user.allowed_methods || null,
    user.allowed_targets || null,
    user.bypass_slots ? 1 : 0,
    user.suspended ? 1 : 0,
    user.service_name || null,
    user.suspend_reason || null,
    user.suspended_by || null
  ).run();
}

export async function deleteUser(env, username) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('DELETE FROM users WHERE username = ?').bind(username).run();
}

export async function listUsers(env) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare('SELECT username,admin,vip,reseller,holder,api_access,max_time,min_time,cooldown,concurrents,max_concurrents,max_daily_attacks,created_by,expiry_unix,allowed_methods,allowed_targets,bypass_slots,suspended,service_name FROM users').all();
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
