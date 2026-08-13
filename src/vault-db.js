import { DEFAULT_PAYLOAD } from '../payload.js';
import { DEFAULT_ROOT_CREDENTIALS } from './config.js';

import { USER_LIMITS } from './config.js';

export function getDB(env) {
  return env && (env.capi_db || env.CAPI_DB || env.DB || env.CAPI_db);
}

function normalizePermissions(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }
  return value && typeof value === 'object' ? value : {};
}

function readNumber(value, fallback = 0) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : fallback;
}

async function addColumn(DB, sql) {
  try {
    await DB.prepare(sql).run();
  } catch (error) {
    // SQLite D1 tolerates the "already exists" case by ignoring the error.
  }
}

async function ensureSystemSettings(env) {
  const DB = getDB(env);
  if (!DB) return;
  const defaults = [
    { key: 'maintenance_mode', value: 'false', type: 'boolean', description: 'API maintenance mode' },
    { key: 'attacks_disabled', value: 'false', type: 'boolean', description: 'Disable all attack requests globally' },
    { key: 'rate_limit_enabled', value: 'true', type: 'boolean', description: 'Global rate limit toggle' },
    { key: 'max_concurrent_attacks', value: '50', type: 'number', description: 'Max concurrent attacks globally' },
    { key: 'max_user_concurrent_attacks', value: '3', type: 'number', description: 'Max concurrent attacks per user' },
    { key: 'default_user_plan', value: 'Default', type: 'string', description: 'Default user plan' },
    { key: 'api_version', value: '1.0.0', type: 'string', description: 'API version' }
  ];

  for (const item of defaults) {
    await DB.prepare(`INSERT OR IGNORE INTO system_settings (key, value, type, description, updated_at) VALUES (?, ?, ?, ?, ?)`).bind(
      item.key,
      String(item.value),
      item.type,
      item.description,
      new Date().toISOString()
    ).run();
  }
}

export async function ensureTables(env) {
  const DB = getDB(env);
  if (!DB) return;

  try {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT,
      max_time INTEGER DEFAULT 60,
      cooldown INTEGER DEFAULT 10,
      max_concurrents INTEGER DEFAULT 1,
      days_active INTEGER DEFAULT 5,
      max_daily_attacks INTEGER DEFAULT 100,
      api_access INTEGER DEFAULT 0,
      bypass_power INTEGER DEFAULT 0,
      bypass_anti_spam INTEGER DEFAULT 0,
      bypass_blacklist INTEGER DEFAULT 0,
      vip_access INTEGER DEFAULT 0,
      holder_access INTEGER DEFAULT 0,
      reseller_access INTEGER DEFAULT 0,
      private_access INTEGER DEFAULT 0,
      permissions TEXT DEFAULT '{}',
      created_at TEXT,
      updated_at TEXT
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT,
      admin INTEGER DEFAULT 0,
      reseller INTEGER DEFAULT 0,
      vip INTEGER DEFAULT 0,
      holder INTEGER DEFAULT 0,
      api_access INTEGER DEFAULT 0,
      plan_id INTEGER,
      max_time INTEGER DEFAULT 60,
      cooldown INTEGER DEFAULT 10,
      max_concurrents INTEGER DEFAULT 1,
      max_daily_attacks INTEGER DEFAULT 100,
      created_by TEXT,
      created_at TEXT,
      last_request_time TEXT,
      expiry_unix INTEGER,
      bypass_slots INTEGER DEFAULT 0,
      suspended INTEGER DEFAULT 0,
      suspend_reason TEXT,
      suspended_by TEXT,
      power_saving INTEGER DEFAULT 1,
      bypass_anti_spam INTEGER DEFAULT 0,
      bypass_blacklist INTEGER DEFAULT 0,
      expires_at TEXT,
      last_ip TEXT,
      whitelisted_ip TEXT,
      warning_count INTEGER DEFAULT 0,
      warning_reset_at TEXT
    )`).run();

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

    await DB.prepare(`CREATE TABLE IF NOT EXISTS methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT,
      default_user INTEGER DEFAULT 0,
      vip_user INTEGER DEFAULT 1,
      reseller INTEGER DEFAULT 1,
      admin INTEGER DEFAULT 1,
      max_slots INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT,
      reason TEXT,
      created_at TEXT
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

    await DB.prepare(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      type TEXT,
      description TEXT,
      updated_at TEXT
    )`).run();

    await addColumn(DB, 'ALTER TABLE users ADD COLUMN plan_id INTEGER');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN last_ip TEXT');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN whitelisted_ip TEXT');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN expires_at TEXT');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN warning_count INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN warning_reset_at TEXT');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN bypass_power INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN bypass_anti_spam INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN bypass_blacklist INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN vip_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN holder_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN reseller_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN private_access INTEGER DEFAULT 0');

    await ensureSystemSettings(env);
  } catch (error) {
    console.error('ensureTables error:', error.message);
  }
}

export async function getUser(env, username) {
  const DB = getDB(env);
  if (!DB) return null;
  const res = await DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).all();
  return (res && res.results && res.results[0]) || null;
}

export async function getUserBatch(env, usernames = []) {
  if (!usernames || !usernames.length) return {};
  const DB = getDB(env);
  if (!DB) return {};
  try {
    const placeholders = usernames.map(() => '?').join(',');
    const res = await DB.prepare(`SELECT * FROM users WHERE username IN (${placeholders})`).bind(...usernames).all();
    const map = {};
    (res?.results || []).forEach((user) => {
      map[user.username] = user;
    });
    return map;
  } catch (error) {
    console.error('Error in getUserBatch:', error.message);
    return {};
  }
}

export async function saveUser(env, user) {
  const DB = getDB(env);
  if (!DB) return;
  const now = new Date().toISOString();
  try {
    await DB.prepare(`INSERT OR REPLACE INTO users (
      username,password,admin,reseller,vip,holder,api_access,plan_id,max_time,cooldown,max_concurrents,max_daily_attacks,created_by,created_at,last_request_time,expiry_unix,bypass_slots,suspended,suspend_reason,suspended_by,power_saving,bypass_anti_spam,bypass_blacklist,expires_at,last_ip,whitelisted_ip,warning_count,warning_reset_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      user.username,
      user.password,
      user.admin ? 1 : 0,
      user.reseller ? 1 : 0,
      user.vip ? 1 : 0,
      user.holder ? 1 : 0,
      user.api_access ? 1 : 0,
      user.plan_id ?? null,
      user.max_time ?? 60,
      user.cooldown ?? 10,
      user.max_concurrents ?? 1,
      user.max_daily_attacks ?? 100,
      user.created_by || 'root',
      user.created_at || now,
      user.last_request_time || now,
      user.expiry_unix || 0,
      user.bypass_slots ? 1 : 0,
      user.suspended ? 1 : 0,
      user.suspend_reason || null,
      user.suspended_by || null,
      user.power_saving !== undefined ? (user.power_saving ? 1 : 0) : 1,
      user.bypass_anti_spam ? 1 : 0,
      user.bypass_blacklist ? 1 : 0,
      user.expires_at || null,
      user.last_ip || null,
      user.whitelisted_ip || null,
      Number(user.warning_count || 0),
      user.warning_reset_at || now
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
  const res = await DB.prepare('SELECT username,admin,vip,reseller,holder,api_access,plan_id,max_time,cooldown,max_concurrents,max_daily_attacks,created_by,created_at,expiry_unix,bypass_slots,suspended,last_request_time,last_ip,whitelisted_ip,warning_count,warning_reset_at FROM users').all();
  return res.results || [];
}

export async function getUserWarningSummary(env, username) {
  const DB = getDB(env);
  if (!DB || !username) return { count: 0, limit: 5, suspended: false, reset_at: null, warn_status: '0/5', severity: 'clean', label: '0/5 warnings', detail: 'Warnings are tracked for abuse and policy enforcement.' };

  const user = await getUser(env, username);
  if (!user) return { count: 0, limit: 5, suspended: false, reset_at: null, warn_status: '0/5', severity: 'clean', label: '0/5 warnings', detail: 'Warnings are tracked for abuse and policy enforcement.' };

  const limit = USER_LIMITS.DEFAULT_WARNING_LIMIT;
  const now = Date.now();
  const resetAt = user.warning_reset_at ? new Date(user.warning_reset_at).getTime() : 0;
  let count = Number(user.warning_count || 0);
  let resetAtIso = user.warning_reset_at || new Date().toISOString();

  if (!user.warning_reset_at || !Number.isFinite(resetAt) || now - resetAt >= USER_LIMITS.DAILY_WARNING_RESET_MS) {
    count = 0;
    resetAtIso = new Date().toISOString();
    await DB.prepare('UPDATE users SET warning_count = ?, warning_reset_at = ? WHERE username = ?').bind(0, resetAtIso, username).run();
  }

  const suspended = Boolean(user.suspended);
  const severity = count >= limit ? 'critical' : count >= 3 ? 'high' : count >= 1 ? 'medium' : 'clean';
  return {
    count,
    limit,
    suspended,
    severity,
    reset_at: resetAtIso,
    warn_status: `${count}/${limit}`,
    label: suspended ? 'account suspended' : `${count}/${limit} warnings`,
    detail: suspended ? 'Account is suspended and must be cleared by an admin.' : 'Warnings are tracked for abuse and policy enforcement.'
  };
}

export async function recordUserWarning(env, username, reason = 'blacklisted target') {
  const DB = getDB(env);
  if (!DB || !username) {
    return { count: 0, limit: 5, suspended: false, reset_at: null, warn_status: '0/5', severity: 'clean', label: '0/5 warnings', detail: 'Warnings are tracked for abuse and policy enforcement.' };
  }

  const user = await getUser(env, username);
  if (!user) {
    return { count: 0, limit: 5, suspended: false, reset_at: null, warn_status: '0/5', severity: 'clean', label: '0/5 warnings', detail: 'Warnings are tracked for abuse and policy enforcement.' };
  }

  const currentSummary = await getUserWarningSummary(env, username);
  let nextCount = Number(currentSummary.count || 0) + 1;
  const limit = USER_LIMITS.DEFAULT_WARNING_LIMIT;
  const resetAt = new Date().toISOString();
  let suspended = Boolean(user.suspended);
  let suspendReason = user.suspend_reason || null;
  let suspendedBy = user.suspended_by || null;

  if (nextCount >= limit) {
    suspended = true;
    suspendReason = `Reached ${nextCount} warnings for ${reason || 'policy violation'}`;
    suspendedBy = 'system';
  }

  await DB.prepare('UPDATE users SET warning_count = ?, warning_reset_at = ?, suspended = ?, suspend_reason = ?, suspended_by = ? WHERE username = ?').bind(
    nextCount,
    resetAt,
    suspended ? 1 : 0,
    suspendReason,
    suspendedBy,
    username
  ).run();

  const summary = {
    count: nextCount,
    limit,
    suspended,
    severity: nextCount >= limit ? 'critical' : nextCount >= 3 ? 'high' : nextCount >= 1 ? 'medium' : 'clean',
    reset_at: resetAt,
    warn_status: `${nextCount}/${limit}`,
    label: suspended ? 'account suspended' : `${nextCount}/${limit} warnings`,
    detail: suspended ? 'Account is suspended and must be cleared by an admin.' : 'Warnings are tracked for abuse and policy enforcement.'
  };

  return summary;
}

export async function addLog(env, log) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('INSERT INTO logs (username,target,port,method,duration,concurrents,created_at) VALUES (?,?,?,?,?,?,?)').bind(log.username, log.target, log.port, log.method, log.duration, log.concurrents || 1, log.created_at || new Date().toISOString()).run();
}

export async function countUserDailyAttacks(env, username) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM logs WHERE username = ? AND datetime(created_at) >= datetime('now','start of day')").bind(username).all();
  return Number(res?.results?.[0]?.c || 0);
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

export async function addOngoingAttack(env, rec) {
  const DB = getDB(env);
  if (!DB) return;
  const started_at = new Date().toISOString();
  const expires_at = new Date(Date.now() + (Number(rec.duration) || 60) * 1000).toISOString();
  await DB.prepare('INSERT INTO ongoing_attacks (username,target,port,method,duration,started_at,expires_at,status) VALUES (?,?,?,?,?,?,?,?)').bind(rec.username, rec.target, rec.port, rec.method, Number(rec.duration) || 60, started_at, expires_at, 'running').run();
}

export async function cleanupOngoing(env) {
  const DB = getDB(env);
  if (!DB) return { updated: 0, deleted: 0 };

  try {
    const updated = await DB.prepare("UPDATE ongoing_attacks SET status='finished' WHERE status='running' AND datetime(expires_at) <= datetime('now')").run();
    const expired = await DB.prepare("DELETE FROM ongoing_attacks WHERE status='finished' AND datetime(expires_at) < datetime('now', '-7 days')").run();
    const stalePending = await DB.prepare("DELETE FROM ongoing_attacks WHERE status='pending' AND datetime(started_at) < datetime('now', '-1 day')").run();

    return {
      updated: Number(updated?.meta?.changes || 0),
      deleted: Number((expired?.meta?.changes || 0) + (stalePending?.meta?.changes || 0)),
      error: null
    };
  } catch (error) {
    return { updated: 0, deleted: 0, error: error.message };
  }
}

export async function countOngoing(env) {
  const DB = getDB(env);
  if (!DB) return 0;
  await cleanupOngoing(env);
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM ongoing_attacks WHERE status='running' AND datetime(expires_at) > datetime('now')").all();
  return Number(res?.results?.[0]?.c || 0);
}

export async function countUserOngoing(env, username) {
  const DB = getDB(env);
  if (!DB) return 0;
  await cleanupOngoing(env);
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM ongoing_attacks WHERE username = ? AND status='running' AND datetime(expires_at) > datetime('now')").bind(username).all();
  return Number(res?.results?.[0]?.c || 0);
}

export async function countMethodOngoing(env, method) {
  const DB = getDB(env);
  if (!DB) return 0;
  await cleanupOngoing(env);
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM ongoing_attacks WHERE method = ? AND status='running' AND datetime(expires_at) > datetime('now')").bind(method).all();
  return Number(res?.results?.[0]?.c || 0);
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
  return [...ongoing, ...logs].slice(0, Number(limit || 10));
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
  if (idOrTarget && !Number.isNaN(Number(idOrTarget))) {
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
  return Number(res?.results?.[0]?.c || 0);
}

export async function countPendingDiscordLinks(env) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM discord_links WHERE status = 'pending'").all();
  return Number(res?.results?.[0]?.c || 0);
}

export async function countLogsToday(env) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM logs WHERE datetime(created_at) >= datetime('now','start of day')").all();
  return Number(res?.results?.[0]?.c || 0);
}

export async function countUsersByFlag(env, flag) {
  const DB = getDB(env);
  if (!DB) return 0;
  if (!['vip', 'holder', 'reseller', 'api_access', 'suspended'].includes(flag)) return 0;
  const res = await DB.prepare(`SELECT COUNT(*) AS c FROM users WHERE ${flag} = 1`).all();
  return Number(res?.results?.[0]?.c || 0);
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

export async function setUserSuspension(env, username, suspended, reason = null, by = null) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('UPDATE users SET suspended = ?, suspend_reason = ?, suspended_by = ? WHERE username = ?').bind(suspended ? 1 : 0, reason || null, by || null, username).run();
}

export async function getPlan(env, planName) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare('SELECT * FROM plans WHERE name = ?').bind(planName).all();
    return res?.results?.[0] || null;
  } catch (error) {
    console.error(`Error getting plan ${planName}:`, error.message);
    return null;
  }
}

export async function getPlanById(env, planId) {
  const DB = getDB(env);
  if (!DB || !planId) return null;
  try {
    const res = await DB.prepare('SELECT * FROM plans WHERE id = ?').bind(planId).all();
    return res?.results?.[0] || null;
  } catch (error) {
    return null;
  }
}

export async function listPlans(env) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare('SELECT * FROM plans ORDER BY name ASC').all();
  return res.results || [];
}

export async function createPlan(env, plan) {
  const DB = getDB(env);
  if (!DB) return null;
  const payload = plan || {};
  const createdAt = new Date().toISOString();
  const permissions = JSON.stringify(normalizePermissions(payload.permissions || payload.Permissions || {}));
  const config = JSON.stringify({
    Name: payload.name || payload.Name || 'Custom',
    Description: payload.description || payload.Description || '',
    Max_Times: readNumber(payload.max_time ?? payload.Max_Times, 60),
    Cooldown: readNumber(payload.cooldown ?? payload.Cooldown, 10),
    Max_Concurrents: readNumber(payload.max_concurrents ?? payload.Max_Concurrents, 1),
    DaysActive: readNumber(payload.days_active ?? payload.DaysActive, 5),
    MaxDailyAttacks: readNumber(payload.max_daily_attacks ?? payload.MaxDailyAttacks, 100),
    Api_Acces: Boolean(payload.api_access ?? payload.Api_Acces ?? false),
    Permissions: normalizePermissions(payload.permissions || payload.Permissions || {})
  });

  await DB.prepare(`INSERT INTO plans (name, description, max_time, cooldown, max_concurrents, days_active, max_daily_attacks, api_access, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    payload.name || payload.Name || 'Custom',
    payload.description || payload.Description || '',
    readNumber(payload.max_time ?? payload.Max_Times, 60),
    readNumber(payload.cooldown ?? payload.Cooldown, 10),
    readNumber(payload.max_concurrents ?? payload.Max_Concurrents, 1),
    readNumber(payload.days_active ?? payload.DaysActive, 5),
    readNumber(payload.max_daily_attacks ?? payload.MaxDailyAttacks, 100),
    Boolean(payload.api_access ?? payload.Api_Acces ?? false) ? 1 : 0,
    permissions,
    createdAt
  ).run();

  return getPlan(env, payload.name || payload.Name || 'Custom');
}

export async function updatePlan(env, planName, updates = {}) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const fields = [];
    const values = [];
    const normalized = updates || {};

    if (normalized.name !== undefined || normalized.Name !== undefined) {
      fields.push('name = ?');
      values.push(normalized.name ?? normalized.Name);
    }
    if (normalized.description !== undefined || normalized.Description !== undefined) {
      fields.push('description = ?');
      values.push(normalized.description ?? normalized.Description);
    }
    if (normalized.max_time !== undefined || normalized.Max_Times !== undefined) {
      fields.push('max_time = ?');
      values.push(readNumber(normalized.max_time ?? normalized.Max_Times, 60));
    }
    if (normalized.cooldown !== undefined || normalized.Cooldown !== undefined) {
      fields.push('cooldown = ?');
      values.push(readNumber(normalized.cooldown ?? normalized.Cooldown, 10));
    }
    if (normalized.max_concurrents !== undefined || normalized.Max_Concurrents !== undefined) {
      fields.push('max_concurrents = ?');
      values.push(readNumber(normalized.max_concurrents ?? normalized.Max_Concurrents, 1));
    }
    if (normalized.days_active !== undefined || normalized.DaysActive !== undefined) {
      fields.push('days_active = ?');
      values.push(readNumber(normalized.days_active ?? normalized.DaysActive, 5));
    }
    if (normalized.max_daily_attacks !== undefined || normalized.MaxDailyAttacks !== undefined) {
      fields.push('max_daily_attacks = ?');
      values.push(readNumber(normalized.max_daily_attacks ?? normalized.MaxDailyAttacks, 100));
    }
    if (normalized.api_access !== undefined || normalized.Api_Acces !== undefined) {
      fields.push('api_access = ?');
      values.push(Boolean(normalized.api_access ?? normalized.Api_Acces ?? false) ? 1 : 0);
    }
    if (normalized.permissions !== undefined || normalized.Permissions !== undefined) {
      fields.push('permissions = ?');
      values.push(JSON.stringify(normalizePermissions((normalized.permissions ?? normalized.Permissions) || {})));
    }
    if (!fields.length) return;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(planName);

    const sql = `UPDATE plans SET ${fields.join(', ')} WHERE name = ?`;
    await DB.prepare(sql).bind(...values).run();
  } catch (error) {
    console.error(`Error updating plan ${planName}:`, error.message);
    throw error;
  }
}

export async function resolveUserPlanSettings(env, user) {
  const userRecord = typeof user === 'string' ? await getUser(env, user) : user;
  if (!userRecord) {
    return {
      source: 'fallback',
      plan_name: 'Default',
      max_time: 60,
      cooldown: 10,
      max_concurrents: 1,
      days_active: 5,
      max_daily_attacks: 100,
      api_access: 0,
      permissions: {}
    };
  }

  let plan = null;
  if (userRecord.plan_id) {
    plan = await getPlanById(env, userRecord.plan_id);
  }
  if (!plan) {
    if (userRecord.vip) {
      plan = await getPlan(env, 'VIP');
    } else if (userRecord.holder) {
      plan = await getPlan(env, 'Default');
    } else if (userRecord.reseller) {
      plan = await getPlan(env, 'Default');
    } else {
      plan = await getPlan(env, 'Default');
    }
  }

  const effectivePlan = plan || {};
  const permissions = normalizePermissions(effectivePlan.permissions || userRecord.permissions || {});

  return {
    source: plan ? 'plan' : 'legacy',
    plan_id: effectivePlan.id ?? userRecord.plan_id ?? null,
    plan_name: effectivePlan.name || 'Default',
    max_time: readNumber(effectivePlan.max_time ?? userRecord.max_time ?? 60, 60),
    cooldown: readNumber(effectivePlan.cooldown ?? userRecord.cooldown ?? 10, 10),
    max_concurrents: readNumber(effectivePlan.max_concurrents ?? userRecord.max_concurrents ?? 1, 1),
    days_active: readNumber(effectivePlan.days_active ?? 5, 5),
    max_daily_attacks: readNumber(effectivePlan.max_daily_attacks ?? userRecord.max_daily_attacks ?? 100, 100),
    api_access: Boolean(effectivePlan.api_access ?? userRecord.api_access ?? false) ? 1 : 0,
    bypass_power: Boolean(effectivePlan.bypass_power ?? 0) ? 1 : 0,
    bypass_anti_spam: Boolean(effectivePlan.bypass_anti_spam ?? userRecord.bypass_anti_spam ?? 0) ? 1 : 0,
    bypass_blacklist: Boolean(effectivePlan.bypass_blacklist ?? userRecord.bypass_blacklist ?? 0) ? 1 : 0,
    vip_access: Boolean(effectivePlan.vip_access ?? 0) ? 1 : 0,
    holder_access: Boolean(effectivePlan.holder_access ?? 0) ? 1 : 0,
    reseller_access: Boolean(effectivePlan.reseller_access ?? 0) ? 1 : 0,
    private_access: Boolean(effectivePlan.private_access ?? 0) ? 1 : 0,
    permissions,
    description: effectivePlan.description || ''
  };
}

export async function applyPlanToUser(env, username, planName) {
  const DB = getDB(env);
  if (!DB || !username || !planName) return null;
  const plan = await getPlan(env, planName);
  if (!plan) return null;
  const user = await getUser(env, username);
  if (!user) return null;

  const nextUser = {
    ...user,
    plan_id: plan.id,
    max_time: readNumber(plan.max_time ?? user.max_time ?? 60, 60),
    cooldown: readNumber(plan.cooldown ?? user.cooldown ?? 10, 10),
    max_concurrents: readNumber(plan.max_concurrents ?? user.max_concurrents ?? 1, 1),
    max_daily_attacks: readNumber(plan.max_daily_attacks ?? user.max_daily_attacks ?? 100, 100),
    api_access: Boolean(plan.api_access ?? user.api_access ?? false) ? 1 : 0,
    bypass_anti_spam: Boolean(plan.bypass_anti_spam ?? user.bypass_anti_spam ?? 0) ? 1 : 0,
    bypass_blacklist: Boolean(plan.bypass_blacklist ?? user.bypass_blacklist ?? 0) ? 1 : 0
  };

  await saveUser(env, nextUser);
  return nextUser;
}

export async function seedPlans(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const count = await DB.prepare('SELECT COUNT(*) AS c FROM plans').all();
    if ((count?.results?.[0]?.c || 0) === 0) {
      const defaultPlans = [
        {
          name: 'Default',
          description: 'Starter build NO VIP',
          max_time: 60,
          cooldown: 10,
          max_concurrents: 1,
          days_active: 5,
          max_daily_attacks: 100,
          api_access: false,
          bypass_power: false,
          bypass_anti_spam: false,
          bypass_blacklist: false,
          vip_access: false,
          holder_access: false,
          reseller_access: false,
          private_access: false,
          permissions: {
            Private_Acces: false,
            Bypass_PowerSaving: false,
            Reseller_Acces: false,
            Bypass_Blacklist: false,
            VIP_Acces: false,
            Holder_Acces: false,
            custom_roles: { enabled: false, roles: [{ role_name: 'main_network' }] }
          }
        },
        {
          name: 'VIP',
          description: 'Starter build VIP',
          max_time: 120,
          cooldown: 30,
          max_concurrents: 1,
          days_active: 31,
          max_daily_attacks: 250,
          api_access: false,
          bypass_power: false,
          bypass_anti_spam: false,
          bypass_blacklist: false,
          vip_access: true,
          holder_access: false,
          reseller_access: false,
          private_access: false,
          permissions: {
            Private_Acces: false,
            Bypass_PowerSaving: false,
            Bypass_Blacklist: false,
            Reseller_Acces: false,
            VIP_Acces: true,
            Holder_Acces: false,
            custom_roles: { enabled: false, roles: [{ role_name: 'main_network' }] }
          }
        },
        {
          name: 'API',
          description: 'Starter API',
          max_time: 300,
          cooldown: 10,
          max_concurrents: 2,
          days_active: 31,
          max_daily_attacks: 500,
          api_access: true,
          bypass_power: false,
          bypass_anti_spam: false,
          bypass_blacklist: false,
          vip_access: true,
          holder_access: false,
          reseller_access: false,
          private_access: false,
          permissions: {
            Private_Acces: false,
            Bypass_PowerSaving: false,
            Bypass_Blacklist: false,
            Reseller_Acces: false,
            VIP_Acces: true,
            Holder_Acces: false,
            custom_roles: { enabled: false, roles: [{ role_name: 'main_network' }] }
          }
        }
      ];

      for (const plan of defaultPlans) {
        await DB.prepare('INSERT OR IGNORE INTO plans (name, description, max_time, cooldown, max_concurrents, days_active, max_daily_attacks, api_access, bypass_power, bypass_anti_spam, bypass_blacklist, vip_access, holder_access, reseller_access, private_access, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
          plan.name,
          plan.description,
          plan.max_time || 60,
          plan.cooldown || 10,
          plan.max_concurrents || 1,
          plan.days_active || 5,
          plan.max_daily_attacks || 100,
          plan.api_access ? 1 : 0,
          plan.bypass_power ? 1 : 0,
          plan.bypass_anti_spam ? 1 : 0,
          plan.bypass_blacklist ? 1 : 0,
          plan.vip_access ? 1 : 0,
          plan.holder_access ? 1 : 0,
          plan.reseller_access ? 1 : 0,
          plan.private_access ? 1 : 0,
          JSON.stringify(plan.permissions || {}),
          new Date().toISOString()
        ).run();
      }
    }
  } catch (error) {
    console.error('seedPlans error:', error.message);
  }
}

export async function seedRootUser(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const rootUser = env.ROOT_USER || env.CAPI_ROOT_USER || DEFAULT_ROOT_CREDENTIALS.username;
    const rootPass = env.ROOT_PASS || env.CAPI_ROOT_PASS || DEFAULT_ROOT_CREDENTIALS.password;
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
        cooldown: 10,
        max_concurrents: 3,
        max_daily_attacks: 1000,
        created_by: rootUser,
        expiry_unix: 0,
        plan_id: (await getPlan(env, 'API'))?.id || null
      });
    }
  } catch (error) {
    console.error('seedRootUser error:', error.message);
  }
}

export async function seedMethods(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    const count = await DB.prepare('SELECT COUNT(*) AS c FROM methods').all();
    if ((count?.results?.[0]?.c || 0) === 0) {
      const defaults = (DEFAULT_PAYLOAD.methods || []).map((item) => [item.name, item.description || `${item.name} method`]);
      for (const [name, description] of defaults) {
        await DB.prepare('INSERT OR IGNORE INTO methods (name, description, created_at) VALUES (?, ?, ?)').bind(name, description, new Date().toISOString()).run();
      }
    }
  } catch (error) {
    console.error('seedMethods error:', error.message);
  }
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
    }
  } catch (error) {
    console.error('seedBlacklist error:', error.message);
  }
}

export async function initializeDatabase(env) {
  const DB = getDB(env);
  if (!DB) return;

  await ensureTables(env);
  await cleanupOngoing(env);

  await seedPlans(env);
  await seedMethods(env);
  await seedBlacklist(env);
  await seedRootUser(env);

  const settings = [
    { key: 'maintenance_mode', value: 'false', type: 'boolean', description: 'API maintenance mode' },
    { key: 'rate_limit_enabled', value: 'true', type: 'boolean', description: 'Global rate limit toggle' },
    { key: 'max_concurrent_attacks', value: '50', type: 'number', description: 'Max concurrent attacks globally' },
    { key: 'max_user_concurrent_attacks', value: '3', type: 'number', description: 'Max concurrent attacks per user' },
    { key: 'default_user_plan', value: 'Default', type: 'string', description: 'Default user plan' },
    { key: 'api_version', value: '1.0.0', type: 'string', description: 'API version' }
  ];

  for (const item of settings) {
    await setSystemSetting(env, item.key, item.value, item.type, item.description);
  }
}

export async function getSystemSetting(env, key) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare('SELECT * FROM system_settings WHERE key = ?').bind(key).all();
    return res?.results?.[0] || null;
  } catch (error) {
    console.error(`Error getting system setting ${key}:`, error.message);
    return null;
  }
}

export async function setSystemSetting(env, key, value, type = 'string', description = '') {
  const DB = getDB(env);
  if (!DB) return;
  try {
    await DB.prepare('INSERT OR REPLACE INTO system_settings (key, value, type, description, updated_at) VALUES (?, ?, ?, ?, ?)').bind(
      key,
      String(value),
      type,
      description,
      new Date().toISOString()
    ).run();
  } catch (error) {
    console.error(`Error setting system setting ${key}:`, error.message);
  }
}

export async function getMaintenanceMode(env) {
  const setting = await getSystemSetting(env, 'maintenance_mode');
  return (setting?.value === 'true') || false;
}

export async function setMaintenanceMode(env, enabled) {
  await setSystemSetting(env, 'maintenance_mode', enabled ? 'true' : 'false', 'boolean', 'API maintenance mode - disables user attacks');
}

export async function getAttacksDisabled(env) {
  const setting = await getSystemSetting(env, 'attacks_disabled');
  return (setting?.value === 'true') || false;
}

export async function setAttacksDisabled(env, disabled) {
  await setSystemSetting(env, 'attacks_disabled', disabled ? 'true' : 'false', 'boolean', 'Disable all attack requests globally');
}

export async function getMethod(env, methodName) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare('SELECT * FROM methods WHERE name = ?').bind(methodName).all();
    return res?.results?.[0] || null;
  } catch (error) {
    console.error(`Error getting method ${methodName}:`, error.message);
    return null;
  }
}

export async function updateMethod(env, methodName, updates = {}) {
  const DB = getDB(env);
  if (!DB) return;
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
  if (!fields.length) return;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(methodName);

  await DB.prepare(`UPDATE methods SET ${fields.join(', ')} WHERE name = ?`).bind(...values).run();
}

export async function getDatabaseStats(env) {
  const DB = getDB(env);
  if (!DB) return { error: 'No database connection' };
  try {
    const counts = {};
    const tables = ['users', 'logs', 'ongoing_attacks', 'blacklist', 'discord_links', 'methods', 'plans'];

    for (const table of tables) {
      const result = await DB.prepare(`SELECT COUNT(*) AS c FROM ${table}`).all();
      counts[table] = Number(result?.results?.[0]?.c || 0);
    }

    return { success: true, counts, timestamp: new Date().toISOString() };
  } catch (error) {
    console.error('Error getting database stats:', error.message);
    return { error: error.message };
  }
}
