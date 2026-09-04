import { DEFAULT_PAYLOAD } from '../payload.js';
import { DEFAULT_ROOT_CREDENTIALS, DEFAULT_PLANS, USER_LIMITS } from './config.js';
import {
  getCachedMethods,
  getCachedUser,
  invalidateSystemSettingCache,
  invalidateMethodCache,
  invalidateUserCache,
  invalidateSettingsCache
} from './helpers.js';

const cleanupInFlight = new WeakMap();
let responseSettingsReady = false;

const RESPONSE_SETTINGS = [
  { key: 'rate_limit_enabled', value: 'true', type: 'boolean', description: 'Enable global rate limiting' },
  { key: 'response_include_hint', value: 'true', type: 'boolean', description: 'Include hint in non-admin API responses' },
  { key: 'response_include_timestamp', value: 'true', type: 'boolean', description: 'Include timestamp in non-admin API responses' },
  { key: 'response_include_service', value: 'true', type: 'boolean', description: 'Include service in non-admin API responses' },
  { key: 'response_include_version', value: 'true', type: 'boolean', description: 'Include version in non-admin API responses' },
  { key: 'response_include_ads', value: 'true', type: 'boolean', description: 'Include ads in non-admin API responses' },
  { key: 'response_include_tips', value: 'false', type: 'boolean', description: 'Include tips in non-admin API responses' }
];

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
    { key: 'api_version', value: '1.0.0', type: 'string', description: 'API version' },
    { key: 'service_name', value: 'CAPI', type: 'string', description: 'Public service name for API responses' },
    { key: 'maintenance_mode', value: 'false', type: 'boolean', description: 'API maintenance mode' },
    { key: 'attacks_disabled', value: 'false', type: 'boolean', description: 'Disable all attack requests globally' },
    { key: 'rate_limit_enabled', value: 'true', type: 'boolean', description: 'Enable global rate limiting' },
    { key: 'auto_cleanup_enabled', value: 'true', type: 'boolean', description: 'Enable automatic cleanup jobs' }
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


      target_type TEXT DEFAULT 'ip',
      default_port INTEGER DEFAULT 80,

      price REAL DEFAULT 0,
      lifetime_price REAL DEFAULT 0,

      max_time INTEGER DEFAULT 60,
      cooldown INTEGER DEFAULT 10,
      max_concurrents INTEGER DEFAULT 1,
      max_daily_attacks INTEGER DEFAULT 100,

      days_active INTEGER DEFAULT 5,
      api INTEGER DEFAULT 0,


      raw_access INTEGER DEFAULT 0,
      botnet_access INTEGER DEFAULT 0,

      private_access INTEGER DEFAULT 0,
      bypass_power INTEGER DEFAULT 0,
      bypass_anti_spam INTEGER DEFAULT 0,
      bypass_blacklist INTEGER DEFAULT 0,

      vip INTEGER DEFAULT 0,
      holder INTEGER DEFAULT 0,
      reseller INTEGER DEFAULT 0,
      permissions TEXT DEFAULT '{}',
      created_at TEXT,
      updated_at TEXT
    )`).run();
    
    await DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT,
      plan_id INTEGER,
      created_by TEXT,
      created_at TEXT,

      admin INTEGER DEFAULT 0,
      reseller INTEGER DEFAULT 0,
      vip INTEGER DEFAULT 0,
      holder INTEGER DEFAULT 0,
      api INTEGER DEFAULT 0,

      max_time INTEGER DEFAULT 60,
      cooldown INTEGER DEFAULT 10,
      max_concurrents INTEGER DEFAULT 1,
      max_daily_attacks INTEGER DEFAULT 100,

      raw_access INTEGER DEFAULT 0,
      star_access INTEGER DEFAULT 0,
      botnet_access INTEGER DEFAULT 0,
      private_access INTEGER DEFAULT 0,
      bypass_power INTEGER DEFAULT 0,
      bypass_slots INTEGER DEFAULT 0,

      suspended INTEGER DEFAULT 0,
      power_saving INTEGER DEFAULT 1,
      bypass_anti_spam INTEGER DEFAULT 0,
      bypass_blacklist INTEGER DEFAULT 0,

      expiry_unix INTEGER,
      last_ip TEXT,
      whitelisted_ip TEXT,

      last_request_time TEXT,
      warning_count INTEGER DEFAULT 0,
      warning_reset_at TEXT,

      suspend_reason TEXT,
      suspended_by TEXT
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

    await DB.prepare(`CREATE TABLE IF NOT EXISTS user_activity (
      username TEXT PRIMARY KEY,
      last_seen TEXT NOT NULL
    )`).run();

    await DB.prepare(`CREATE TABLE IF NOT EXISTS methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT,

      enabled INTEGER DEFAULT 1,
      target_type TEXT DEFAULT 'ip',
      default_port INTEGER DEFAULT 80,

      default_access INTEGER DEFAULT 0,
      vip INTEGER DEFAULT 1,
      reseller INTEGER DEFAULT 1,
      admin INTEGER DEFAULT 1,

      max_slots INTEGER DEFAULT 0,
      max_concurrents INTEGER DEFAULT 5,
      min_time INTEGER DEFAULT 30,
      max_time INTEGER,

      raw_access INTEGER DEFAULT 0,
      star_access INTEGER DEFAULT 0,
      botnet_access INTEGER DEFAULT 0,
      private_access INTEGER DEFAULT 0,

      created_at TEXT,
      updated_at TEXT
    )`).run();
    
    // Seed default methods if table is empty
    const methodsCheck = await DB.prepare('SELECT COUNT(*) AS c FROM methods').all();
    if (!methodsCheck.results || methodsCheck.results[0]?.c === 0) {
      const defaultMethods = [
        { name: 'udp', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
        { name: 'tcp', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
        { name: 'http', enabled: 1, target_type: 'url', max_slots: 8, default_port: 80 },
        { name: 'https', enabled: 1, target_type: 'url', max_slots: 8, default_port: 443 },
        { name: 'cf-bypass', enabled: 1, target_type: 'url', max_slots: 5, default_port: 443 },
        { name: 'slowloris', enabled: 1, target_type: 'url', max_slots: 3, default_port: 80 },
        { name: 'http-raw', enabled: 1, target_type: 'url', max_slots: 8, default_port: 80 },
        { name: 'https-raw', enabled: 1, target_type: 'url', max_slots: 8, default_port: 443 },
        { name: 'tcp-flood', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
        { name: 'udp-flood', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 53 },
        { name: 'icmp', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 0 },
        { name: 'syn', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 }
      ];
      for (const method of defaultMethods) {
        await DB.prepare(
          'INSERT INTO methods (name, enabled, target_type, max_slots, default_port, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(
          method.name, method.enabled, method.target_type, method.max_slots, method.default_port, new Date().toISOString()
        ).run();
      }
    }

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
      created_at TEXT,
      updated_at TEXT
    )`).run();

    await DB.prepare('CREATE INDEX IF NOT EXISTS idx_logs_username_created_at ON logs (username, created_at DESC)').run();
    await DB.prepare('CREATE INDEX IF NOT EXISTS idx_ongoing_status_expires_at ON ongoing_attacks (status, expires_at)').run();
    await DB.prepare('CREATE INDEX IF NOT EXISTS idx_ongoing_username_status ON ongoing_attacks (username, status)').run();
    await DB.prepare('CREATE INDEX IF NOT EXISTS idx_ongoing_method_status ON ongoing_attacks (method, status)').run();

    await addColumn(DB, 'ALTER TABLE users ADD COLUMN plan_id INTEGER');
    await addColumn(DB, 'ALTER TABLE system_settings ADD COLUMN created_at TEXT');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN last_ip TEXT');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN whitelisted_ip TEXT');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN raw_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN star_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN botnet_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN private_access INTEGER DEFAULT 0');
      await addColumn(DB, 'ALTER TABLE users ADD COLUMN bypass_power INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN warning_count INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN warning_reset_at TEXT');
    await addColumn(DB, 'ALTER TABLE users ADD COLUMN api INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN price REAL DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN lifetime_price REAL DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN cooldown INTEGER DEFAULT 10');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN max_daily_attacks INTEGER DEFAULT 100');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN days_active INTEGER DEFAULT 5');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN raw_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN star_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN botnet_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN bypass_power INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN bypass_anti_spam INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN bypass_blacklist INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN api INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN vip INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN holder INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN reseller INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE plans ADD COLUMN private_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE methods ADD COLUMN enabled INTEGER DEFAULT 1');
    await addColumn(DB, 'ALTER TABLE methods ADD COLUMN target_type TEXT DEFAULT "ip"');
    await addColumn(DB, 'ALTER TABLE methods ADD COLUMN default_port INTEGER DEFAULT 80');
    await addColumn(DB, 'ALTER TABLE methods ADD COLUMN max_time INTEGER');
    await addColumn(DB, 'ALTER TABLE methods ADD COLUMN max_concurrents INTEGER DEFAULT 5');
    await addColumn(DB, 'ALTER TABLE methods ADD COLUMN min_time INTEGER DEFAULT 30');
    await DB.prepare('UPDATE methods SET min_time = 30 WHERE min_time IS NULL OR min_time != 30').run();
    await DB.prepare('UPDATE methods SET max_concurrents = 5 WHERE max_concurrents IS NULL OR max_concurrents = 1').run();
    await addColumn(DB, 'ALTER TABLE methods ADD COLUMN raw_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE methods ADD COLUMN star_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE methods ADD COLUMN botnet_access INTEGER DEFAULT 0');
    await addColumn(DB, 'ALTER TABLE methods ADD COLUMN private_access INTEGER DEFAULT 0');

    try {
      const userExpiryColumns = await DB.prepare('PRAGMA table_info(users)').all();
      if ((userExpiryColumns?.results || []).some((column) => column.name === 'expires_at')) {
        await DB.prepare("UPDATE users SET expiry_unix = CAST(strftime('%s', expires_at) AS INTEGER) WHERE (expiry_unix IS NULL OR expiry_unix = 0) AND expires_at IS NOT NULL AND expires_at != ''").run();
        await DB.prepare('ALTER TABLE users DROP COLUMN expires_at').run();
      }
    } catch (error) {
      console.error('Failed to migrate duplicate user expiry column:', error.message);
    }

    try {
      const userColumns = await DB.prepare('PRAGMA table_info(users)').all();
      const userColumnNames = (userColumns?.results || []).map((col) => col.name);
      if (userColumnNames.includes('api_access') && !userColumnNames.includes('api')) {
        await DB.prepare('ALTER TABLE users RENAME COLUMN api_access TO api').run();
      }
      if (userColumnNames.includes('price')) {
        try { await DB.prepare('ALTER TABLE users DROP COLUMN price').run(); } catch (error) {}
      }
    } catch (error) {}

    try {
      const planColumns = await DB.prepare('PRAGMA table_info(plans)').all();
      const planColumnNames = (planColumns?.results || []).map((col) => col.name);
      if (planColumnNames.includes('api_access') && !planColumnNames.includes('api')) {
        await DB.prepare('ALTER TABLE plans RENAME COLUMN api_access TO api').run();
      }
      if (planColumnNames.includes('vip_access') && !planColumnNames.includes('vip')) {
        await DB.prepare('ALTER TABLE plans RENAME COLUMN vip_access TO vip').run();
      }
      if (planColumnNames.includes('holder_access') && !planColumnNames.includes('holder')) {
        await DB.prepare('ALTER TABLE plans RENAME COLUMN holder_access TO holder').run();
      }
      if (planColumnNames.includes('reseller_access') && !planColumnNames.includes('reseller')) {
        await DB.prepare('ALTER TABLE plans RENAME COLUMN reseller_access TO reseller').run();
      }
    } catch (error) {}

    try {
      const methodColumns = await DB.prepare('PRAGMA table_info(methods)').all();
      const methodColumnNames = (methodColumns?.results || []).map((col) => col.name);
      if (methodColumnNames.includes('default_user') && !methodColumnNames.includes('default_access')) {
        await DB.prepare('ALTER TABLE methods RENAME COLUMN default_user TO default_access').run();
      }
      if (methodColumnNames.includes('vip_user') && !methodColumnNames.includes('vip')) {
        await DB.prepare('ALTER TABLE methods RENAME COLUMN vip_user TO vip').run();
      }
      if (!methodColumnNames.includes('max_time')) {
        await addColumn(DB, 'ALTER TABLE methods ADD COLUMN max_time INTEGER');
      }
      if (!methodColumnNames.includes('raw_access')) {
        await addColumn(DB, 'ALTER TABLE methods ADD COLUMN raw_access INTEGER DEFAULT 0');
      }
      if (!methodColumnNames.includes('star_access')) {
        await addColumn(DB, 'ALTER TABLE methods ADD COLUMN star_access INTEGER DEFAULT 0');
      }
      if (!methodColumnNames.includes('botnet_access')) {
        await addColumn(DB, 'ALTER TABLE methods ADD COLUMN botnet_access INTEGER DEFAULT 0');
      }
      if (!methodColumnNames.includes('private_access')) {
        await addColumn(DB, 'ALTER TABLE methods ADD COLUMN private_access INTEGER DEFAULT 0');
      }
    } catch (error) {}

    await ensureSystemSettings(env);
  } catch (error) {
    console.error('ensureTables error:', error.message);
  }
}

async function fetchUserFromDatabase(DB, username) {
  const explicit = await DB.prepare(`SELECT
    username,password,admin,reseller,vip,holder,api,plan_id,max_time,cooldown,max_concurrents,max_daily_attacks,
    created_by,created_at,last_request_time,expiry_unix,bypass_slots,suspended,suspend_reason,suspended_by,
    power_saving,bypass_anti_spam,bypass_blacklist,raw_access,star_access,botnet_access,private_access,bypass_power,
    last_ip,whitelisted_ip,warning_count,warning_reset_at
    FROM users WHERE username = ?`).bind(username).all();
  if (explicit?.results?.[0]) return explicit.results[0];

  const fallback = await DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).all();
  return fallback?.results?.[0] || null;
}

export async function getUser(env, username, options = {}) {
  const DB = getDB(env);
  if (!DB || !username) return null;

  if (options.fresh) return fetchUserFromDatabase(DB, username);

  const cached = getCachedUser(username, async () => {
    return fetchUserFromDatabase(DB, username);
  });

  return cached;
}

export async function saveUser(env, user) {
  const DB = getDB(env);
  if (!DB) return;
  const now = new Date().toISOString();
  const apiValue = user.api ?? user.api_access ?? 0;
  const storedPassword = String(user.password || '');
  try {
    await DB.prepare(`INSERT INTO users (
      username,password,admin,reseller,vip,holder,api,plan_id,max_time,cooldown,max_concurrents,max_daily_attacks,created_by,created_at,last_request_time,expiry_unix,bypass_slots,suspended,power_saving,bypass_anti_spam,bypass_blacklist,raw_access,star_access,botnet_access,private_access,bypass_power,last_ip,whitelisted_ip,warning_count,warning_reset_at,suspend_reason,suspended_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(username) DO UPDATE SET
      password = excluded.password,
      admin = excluded.admin,
      reseller = excluded.reseller,
      vip = excluded.vip,
      holder = excluded.holder,
      api = excluded.api,
      plan_id = excluded.plan_id,
      max_time = excluded.max_time,
      cooldown = excluded.cooldown,
      max_concurrents = excluded.max_concurrents,
      max_daily_attacks = excluded.max_daily_attacks,
      created_by = excluded.created_by,
      created_at = excluded.created_at,
      last_request_time = excluded.last_request_time,
      expiry_unix = excluded.expiry_unix,
      bypass_slots = excluded.bypass_slots,
      suspended = excluded.suspended,
      power_saving = excluded.power_saving,
      bypass_anti_spam = excluded.bypass_anti_spam,
      bypass_blacklist = excluded.bypass_blacklist,
      raw_access = excluded.raw_access,
      star_access = excluded.star_access,
      botnet_access = excluded.botnet_access,
      private_access = excluded.private_access,
      bypass_power = excluded.bypass_power,
      last_ip = excluded.last_ip,
      whitelisted_ip = excluded.whitelisted_ip,
      warning_count = excluded.warning_count,
      warning_reset_at = excluded.warning_reset_at,
      suspend_reason = excluded.suspend_reason,
      suspended_by = excluded.suspended_by`).bind(
      user.username,
      storedPassword,
      user.admin ? 1 : 0,
      user.reseller ? 1 : 0,
      user.vip ? 1 : 0,
      user.holder ? 1 : 0,
      apiValue ? 1 : 0,
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
      user.power_saving !== undefined ? (user.power_saving ? 1 : 0) : 1,
      user.bypass_anti_spam ? 1 : 0,
      user.bypass_blacklist ? 1 : 0,
      user.raw_access ? 1 : 0,
      user.star_access ? 1 : 0,
      user.botnet_access ? 1 : 0,
      user.private_access ? 1 : 0,
      user.bypass_power ? 1 : 0,
      user.last_ip || null,
      user.whitelisted_ip || null,
      Number(user.warning_count || 0),
      user.warning_reset_at || now,
      user.suspend_reason || null,
      user.suspended_by || null
    ).run();
    invalidateUserCache(user.username);
    invalidateSettingsCache();
  } catch (error) {
    console.error('Error in saveUser:', error.message);
    throw error;
  }
}

export async function verifyUserPassword(env, user, password) {
  if (!user) return false;
  return String(password || '') === String(user.password || '');
}

export async function deleteUser(env, username) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('DELETE FROM users WHERE username = ?').bind(username).run();
  invalidateUserCache(username);
  invalidateSettingsCache();
}

export async function listUsers(env) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare("SELECT username,admin,vip,reseller,holder,api,plan_id,max_time,cooldown,max_concurrents,max_daily_attacks,created_by,created_at,expiry_unix,bypass_slots,suspended,last_request_time,last_ip,whitelisted_ip,raw_access,star_access,botnet_access,private_access,bypass_power,warning_count,warning_reset_at,suspend_reason,suspended_by FROM users ORDER BY CASE WHEN lower(username) = 'root' THEN 0 ELSE 1 END, rowid ASC").all();
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
  invalidateUserCache(username);
  invalidateSettingsCache();

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
  invalidateUserCache(username);
  invalidateSettingsCache();
}

export async function recordAuthenticatedActivity(env, username) {
  const DB = getDB(env);
  const normalizedUsername = String(username || '').trim().toLowerCase();
  if (!DB || !normalizedUsername) return;
  await DB.prepare(`INSERT INTO user_activity (username, last_seen)
    VALUES (?, ?)
    ON CONFLICT(username) DO UPDATE SET last_seen = excluded.last_seen`)
    .bind(normalizedUsername, new Date().toISOString())
    .run();
}

export async function countOnlineUsers(env, windowSeconds = 15) {
  const DB = getDB(env);
  if (!DB) return 0;
  const seconds = Math.max(1, Number(windowSeconds) || 15);
  const cutoff = new Date(Date.now() - Math.floor(seconds) * 1000).toISOString();
  const res = await DB.prepare('SELECT COUNT(DISTINCT lower(username)) AS c FROM user_activity WHERE last_seen >= ?')
    .bind(cutoff)
    .all();
  return Number(res?.results?.[0]?.c || 0);
}

export async function updateUserLastIp(env, username, ip) {
  const DB = getDB(env);
  if (!DB || !username || !ip) return;
  await DB.prepare('UPDATE users SET last_ip = ? WHERE username = ?').bind(String(ip), username).run();
  invalidateUserCache(username);
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

  const existing = cleanupInFlight.get(DB);
  if (existing) return existing;

  const cleanupPromise = (async () => {
    try {
    const cleanupSetting = await getSystemSetting(env, 'auto_cleanup_enabled');
    if (cleanupSetting && cleanupSetting.value === 'false') {
      return { updated: 0, deleted: 0, disabled_by_system_setting: true };
    }
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
  })();
  cleanupInFlight.set(DB, cleanupPromise);
  try {
    return await cleanupPromise;
  } finally {
    if (cleanupInFlight.get(DB) === cleanupPromise) cleanupInFlight.delete(DB);
  }
}

export async function countOngoing(env) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM ongoing_attacks WHERE status='running' AND datetime(expires_at) > datetime('now')").all();
  return Number(res?.results?.[0]?.c || 0);
}

export async function countUserOngoing(env, username) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM ongoing_attacks WHERE username = ? AND status='running' AND datetime(expires_at) > datetime('now')").bind(username).all();
  return Number(res?.results?.[0]?.c || 0);
}

export async function countMethodOngoing(env, method) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM ongoing_attacks WHERE method = ? AND status='running' AND datetime(expires_at) > datetime('now')").bind(method).all();
  return Number(res?.results?.[0]?.c || 0);
}

export async function countMethodsOngoingBatch(env, methods = []) {
  if (!methods || methods.length === 0) return {};
  const DB = getDB(env);
  if (!DB) return {};
  
  try {
    await cleanupOngoing(env);
    // Single query to get all method counts at once
    const res = await DB.prepare(`
      SELECT method, COUNT(*) AS c 
      FROM ongoing_attacks 
      WHERE status='running' AND datetime(expires_at) > datetime('now')
      GROUP BY method
    `).all();
    
    const counts = {};
    (res?.results || []).forEach((row) => {
      counts[String(row.method || '').toLowerCase()] = Number(row.c || 0);
    });
    
    // Fill in missing methods with 0
    methods.forEach((method) => {
      const key = String(method || '').toLowerCase();
      if (!(key in counts)) counts[key] = 0;
    });
    
    return counts;
  } catch (error) {
    console.error('Error in countMethodsOngoingBatch:', error.message);
    return {};
  }
}

export async function getLogs(env, username) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare('SELECT * FROM logs WHERE username = ?').bind(username).all();
  return res.results || [];
}

export async function getRecentAttacks(env, username, limit = 10) {
  const DB = getDB(env);
  if (!DB) return [];
  await cleanupOngoing(env);
  const ongoingRes = await DB.prepare("SELECT id, username, target, port, method, duration, started_at AS created_at, expires_at, status FROM ongoing_attacks WHERE username = ? AND status='running' AND datetime(expires_at) > datetime('now') ORDER BY started_at DESC LIMIT ?").bind(username, Number(limit || 10)).all();
  return ongoingRes.results || [];
}

export async function listMethods(env) {
  const DB = getDB(env);
  if (!DB) return [];

  return await getCachedMethods(async () => {
    try {
      const res = await DB.prepare('SELECT id, name, description, enabled, default_access, vip, reseller, admin, max_slots, max_concurrents, min_time, max_time, raw_access, star_access, botnet_access, private_access, created_at FROM methods ORDER BY name ASC').all();
      return res.results || [];
    } catch (error) {
      return [];
    }
  });
}

export async function addBlacklistTarget(env, target, reason) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('INSERT INTO blacklist (target, reason, created_at) VALUES (?, ?, ?)').bind(target, reason || 'manual', new Date().toISOString()).run();
  invalidateSettingsCache();
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
  invalidateSettingsCache();
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

export async function countLogsToday(env) {
  const DB = getDB(env);
  if (!DB) return 0;
  const res = await DB.prepare("SELECT COUNT(*) AS c FROM logs WHERE datetime(created_at) >= datetime('now','start of day')").all();
  return Number(res?.results?.[0]?.c || 0);
}

export async function getUserStatistics(env) {
  const DB = getDB(env);
  if (!DB) return { total: 0, active: 0, suspended: 0, vip: 0, holder: 0, reseller: 0 };
  try {
    const res = await DB.prepare(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN suspended = 0 OR suspended IS NULL THEN 1 ELSE 0 END), 0) AS active,
      COALESCE(SUM(CASE WHEN suspended = 1 THEN 1 ELSE 0 END), 0) AS suspended,
      COALESCE(SUM(CASE WHEN vip = 1 THEN 1 ELSE 0 END), 0) AS vip,
      COALESCE(SUM(CASE WHEN holder = 1 THEN 1 ELSE 0 END), 0) AS holder,
      COALESCE(SUM(CASE WHEN reseller = 1 THEN 1 ELSE 0 END), 0) AS reseller,
      COALESCE(SUM(CASE WHEN admin = 1 THEN 1 ELSE 0 END), 0) AS admin
      FROM users`).all();
    const row = res?.results?.[0] || {};
    return {
      total: Number(row.total || 0),
      active: Number(row.active || 0),
      suspended: Number(row.suspended || 0),
      vip: Number(row.vip || 0),
      holder: Number(row.holder || 0),
      reseller: Number(row.reseller || 0),
      admin: Number(row.admin || 0)
    };
  } catch (error) {
    console.error('Error getting user statistics:', error.message);
    return { total: 0, active: 0, suspended: 0, vip: 0, holder: 0, reseller: 0 };
  }
}

export async function getAdminStatistics(env) {
  const DB = getDB(env);
  if (!DB) return { users: {}, methods: 0, blacklist: 0, ongoing: 0 };
  try {
    const [users, methods, blacklist, ongoing] = await Promise.all([
      getUserStatistics(env),
      DB.prepare('SELECT COUNT(*) AS c FROM methods').all(),
      DB.prepare('SELECT COUNT(*) AS c FROM blacklist').all(),
      countOngoing(env)
    ]);
    return {
      users,
      methods: Number(methods?.results?.[0]?.c || 0),
      blacklist: Number(blacklist?.results?.[0]?.c || 0),
      ongoing: Number(ongoing || 0)
    };
  } catch (error) {
    console.error('Error getting admin statistics:', error.message);
    return { users: {}, methods: 0, blacklist: 0, ongoing: 0 };
  }
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
  invalidateUserCache(username);
  invalidateSettingsCache();
}

export async function getPlan(env, planName) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare('SELECT * FROM plans WHERE LOWER(name) = LOWER(?)').bind(planName).all();
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
    Api: Boolean(payload.api ?? payload.api_access ?? payload.Api ?? payload.Api_Acces ?? false),
    Permissions: normalizePermissions(payload.permissions || payload.Permissions || {})
  });

  await DB.prepare(`INSERT INTO plans (name, description, price, lifetime_price, max_time, cooldown, max_concurrents, days_active, max_daily_attacks, api, raw_access, star_access, botnet_access, private_access, bypass_power, bypass_anti_spam, bypass_blacklist, vip, holder, reseller, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    payload.name || payload.Name || 'Custom',
    payload.description || payload.Description || '',
    readNumber(payload.price, 0),
    readNumber(payload.lifetime_price ?? payload.Lifetime_Price, 0),
    readNumber(payload.max_time ?? payload.Max_Times, 60),
    readNumber(payload.cooldown ?? payload.Cooldown, 10),
    readNumber(payload.max_concurrents ?? payload.Max_Concurrents, 1),
    readNumber(payload.days_active ?? payload.DaysActive, 5),
    readNumber(payload.max_daily_attacks ?? payload.MaxDailyAttacks, 100),
    Boolean(payload.api ?? payload.api_access ?? payload.Api ?? payload.Api_Acces ?? false) ? 1 : 0,
    Number(payload.raw_access ?? 0) ? 1 : 0,
    Number(payload.star_access ?? 0) ? 1 : 0,
    Number(payload.botnet_access ?? 0) ? 1 : 0,
    Number(payload.private_access ?? 0) ? 1 : 0,
    Number(payload.bypass_power ?? 0) ? 1 : 0,
    Number(payload.bypass_anti_spam ?? 0) ? 1 : 0,
    Number(payload.bypass_blacklist ?? 0) ? 1 : 0,
    Number(payload.vip ?? 0) ? 1 : 0,
    Number(payload.holder ?? 0) ? 1 : 0,
    Number(payload.reseller ?? 0) ? 1 : 0,
    permissions,
    createdAt
  ).run();
  invalidateSettingsCache();

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
    for (const field of ['raw_access', 'star_access', 'botnet_access', 'private_access', 'bypass_power', 'bypass_anti_spam', 'bypass_blacklist', 'vip', 'holder', 'reseller']) {
      if (normalized[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(Number(normalized[field]) ? 1 : 0);
      }
    }
    for (const field of ['price', 'lifetime_price']) {
      if (normalized[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(readNumber(normalized[field], 0));
      }
    }
    if (normalized.api !== undefined || normalized.api_access !== undefined || normalized.Api !== undefined || normalized.Api_Acces !== undefined) {
      fields.push('api = ?');
      values.push(Boolean(normalized.api ?? normalized.api_access ?? normalized.Api ?? normalized.Api_Acces ?? false) ? 1 : 0);
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
    invalidateSettingsCache();
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
      api: 0,
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
    api: Boolean(effectivePlan.api ?? effectivePlan.api_access ?? userRecord.api ?? userRecord.api_access ?? false) ? 1 : 0,
    bypass_power: Boolean(effectivePlan.bypass_power ?? 0) ? 1 : 0,
    bypass_anti_spam: Boolean(effectivePlan.bypass_anti_spam ?? userRecord.bypass_anti_spam ?? 0) ? 1 : 0,
    bypass_blacklist: Boolean(effectivePlan.bypass_blacklist ?? userRecord.bypass_blacklist ?? 0) ? 1 : 0,
    vip: Boolean(effectivePlan.vip ?? effectivePlan.vip_access ?? 0) ? 1 : 0,
    holder: Boolean(effectivePlan.holder ?? effectivePlan.holder_access ?? 0) ? 1 : 0,
    reseller: Boolean(effectivePlan.reseller ?? effectivePlan.reseller_access ?? 0) ? 1 : 0,
    private_access: Boolean(effectivePlan.private_access ?? 0) ? 1 : 0,
    star_access: Boolean(effectivePlan.star_access ?? userRecord.star_access ?? 0) ? 1 : 0,
    botnet_access: Boolean(effectivePlan.botnet_access ?? userRecord.botnet_access ?? 0) ? 1 : 0,
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
    api: Boolean(plan.api ?? plan.api_access ?? user.api ?? user.api_access ?? false) ? 1 : 0,
    vip: Boolean(plan.vip ?? 0) ? 1 : 0,
    holder: Boolean(plan.holder ?? 0) ? 1 : 0,
    reseller: Boolean(plan.reseller ?? 0) ? 1 : 0,
    bypass_anti_spam: Boolean(plan.bypass_anti_spam ?? user.bypass_anti_spam ?? 0) ? 1 : 0,
    bypass_blacklist: Boolean(plan.bypass_blacklist ?? user.bypass_blacklist ?? 0) ? 1 : 0,
    bypass_power: Boolean(plan.bypass_power ?? 0) ? 1 : 0,
    raw_access: Boolean(plan.raw_access ?? 0) ? 1 : 0,
    star_access: Boolean(plan.star_access ?? 0) ? 1 : 0,
    botnet_access: Boolean(plan.botnet_access ?? 0) ? 1 : 0,
    private_access: Boolean(plan.private_access ?? 0) ? 1 : 0
  };

  const daysActive = Number(plan.days_active || 0);
  nextUser.expiry_unix = Number.isFinite(daysActive) && daysActive > 0
    ? Math.floor(Date.now() / 1000) + Math.floor(daysActive * 86400)
    : 0;

  await saveUser(env, nextUser);
  return nextUser;
}

export async function seedPlans(env) {
  const DB = getDB(env);
  if (!DB) return;
  try {
    {
      const defaultPlans = DEFAULT_PLANS.map((plan) => ({
        ...plan,
        days_active: plan.days_active || 30,
        max_daily_attacks: plan.max_daily_attacks || 99999,
        lifetime_price: plan.lifetime_price || 0
      }));

      for (const plan of defaultPlans) {
        await DB.prepare('INSERT INTO plans (name, description, price, lifetime_price, max_time, cooldown, max_concurrents, days_active, max_daily_attacks, api, raw_access, star_access, botnet_access, private_access, bypass_power, bypass_anti_spam, bypass_blacklist, vip, holder, reseller, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET description = excluded.description, price = excluded.price, lifetime_price = excluded.lifetime_price, max_time = excluded.max_time, cooldown = excluded.cooldown, max_concurrents = excluded.max_concurrents, days_active = excluded.days_active, max_daily_attacks = excluded.max_daily_attacks, api = excluded.api, raw_access = excluded.raw_access, star_access = excluded.star_access, botnet_access = excluded.botnet_access, private_access = excluded.private_access, bypass_power = excluded.bypass_power, bypass_anti_spam = excluded.bypass_anti_spam, bypass_blacklist = excluded.bypass_blacklist, vip = excluded.vip, holder = excluded.holder, reseller = excluded.reseller, updated_at = excluded.updated_at').bind(
          plan.name, plan.description, Number(plan.price || 0), Number(plan.lifetime_price || 0), Number(plan.max_time || 60), Number(plan.cooldown || 0), Number(plan.max_concurrents || 1), Number(plan.days_active || 30), Number(plan.max_daily_attacks || 99999), Number(plan.api || 0), Number(plan.raw_access || 0), Number(plan.star_access || 0), Number(plan.botnet_access || 0), Number(plan.private_access || 0), Number(plan.bypass_power || 0), Number(plan.bypass_anti_spam || 0), Number(plan.bypass_blacklist || 0), Number(plan.vip || 0), Number(plan.holder || 0), Number(plan.reseller || 0), new Date().toISOString(), new Date().toISOString()
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
        api: 1,
        max_time: 500,
        cooldown: 10,
        max_concurrents: 3,
        max_daily_attacks: 1000,
        created_by: rootUser,
        expiry_unix: 0,
        plan_id: (await getPlan(env, 'Default'))?.id || null
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
      await syncMethodsFromPayload(env);
    }
  } catch (error) {
    console.error('seedMethods error:', error.message);
  }
}

export async function syncMethodsFromPayload(env) {
  const DB = getDB(env);
  if (!DB) return { added: 0, updated: 0, removed: 0, error: null };

  try {
    const payloadMethods = (DEFAULT_PAYLOAD.methods || []);
    const existing = await DB.prepare('SELECT name, enabled, description, target_type, default_port, max_slots, max_concurrents, min_time, max_time FROM methods').all();
    const existingRows = (existing?.results || []).map((row) => ({
      name: String(row?.name || '').toLowerCase().trim(),
      enabled: Number(row?.enabled ?? 1),
      description: row?.description || '',
      target_type: row?.target_type || 'ip',
      default_port: row?.default_port || 80,
      max_slots: row?.max_slots || 0,
      max_concurrents: row?.max_concurrents || 5,
      min_time: 30,
      max_time: row?.max_time || null
    }));
    const existingNames = new Set(existingRows.map((row) => row.name).filter(Boolean));
    const payloadNames = new Set();

    let added = 0;
    let updated = 0;
    let removed = 0;

    for (const item of payloadMethods) {
      const name = (item.name || '').toLowerCase().trim();
      if (!name) continue;
      payloadNames.add(name);

      const normalized = {
        name,
        description: item.description || `${name} method`,
        enabled: Number(item.enabled ?? true),
        target_type: String(item.target_type || 'ip').toLowerCase(),
        default_port: Number(item.default_port ?? 80),
        default_access: Number(item.default_access ?? 0),
        vip: Number(item.vip ?? 1),
        reseller: Number(item.reseller ?? 1),
        admin: Number(item.admin ?? 1),
        max_slots: Number(item.max_slots ?? item.max_concurrents ?? 0),
        max_concurrents: Number(item.max_concurrents ?? 5),
        min_time: 30,
        max_time: item.max_time === undefined || item.max_time === null || item.max_time === '' ? null : Number(item.max_time),
        raw_access: Number(item.raw_access ?? 0),
        star_access: Number(item.star_access ?? 0),
        botnet_access: Number(item.botnet_access ?? 0),
        private_access: Number(item.private_access ?? 0)
      };

      if (!existingNames.has(name)) {
        await DB.prepare(
          'INSERT INTO methods (name, description, enabled, target_type, default_access, vip, reseller, admin, max_slots, max_concurrents, min_time, default_port, max_time, raw_access, star_access, botnet_access, private_access, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          normalized.name,
          normalized.description,
          normalized.enabled ? 1 : 0,
          normalized.target_type,
          normalized.default_access ? 1 : 0,
          normalized.vip ? 1 : 0,
          normalized.reseller ? 1 : 0,
          normalized.admin ? 1 : 0,
          normalized.max_slots || 0,
          normalized.max_concurrents || 5,
          normalized.min_time,
          normalized.default_port || 80,
          normalized.max_time,
          normalized.raw_access ? 1 : 0,
          normalized.star_access ? 1 : 0,
          normalized.botnet_access ? 1 : 0,
          normalized.private_access ? 1 : 0,
          new Date().toISOString()
        ).run();
        added++;
        existingNames.add(name);
      } else {
        await DB.prepare(
          'UPDATE methods SET description = ?, enabled = ?, target_type = ?, default_access = ?, vip = ?, reseller = ?, admin = ?, max_slots = ?, max_concurrents = ?, min_time = ?, default_port = ?, max_time = ?, raw_access = ?, star_access = ?, botnet_access = ?, private_access = ?, updated_at = ? WHERE name = ?'
        ).bind(
          normalized.description,
          normalized.enabled ? 1 : 0,
          normalized.target_type,
          normalized.default_access ? 1 : 0,
          normalized.vip ? 1 : 0,
          normalized.reseller ? 1 : 0,
          normalized.admin ? 1 : 0,
          normalized.max_slots || 0,
          normalized.max_concurrents || 5,
          normalized.min_time,
          normalized.default_port || 80,
          normalized.max_time,
          normalized.raw_access ? 1 : 0,
          normalized.star_access ? 1 : 0,
          normalized.botnet_access ? 1 : 0,
          normalized.private_access ? 1 : 0,
          new Date().toISOString(),
          normalized.name
        ).run();
        updated++;
      }
    }

    for (const row of existingRows) {
      if (!payloadNames.has(row.name)) {
        await DB.prepare('DELETE FROM methods WHERE name = ?').bind(row.name).run();
        removed++;
      }
    }

    invalidateMethodCache();
    invalidateSettingsCache();
    return { added, updated, removed, error: null };
  } catch (error) {
    console.error('syncMethodsFromPayload error:', error.message);
    invalidateMethodCache();
    invalidateSettingsCache();
    return { added: 0, updated: 0, removed: 0, error: error.message };
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

  try {
    await ensureTables(env);
    await cleanupOngoing(env);

    await seedPlans(env);
    await seedMethods(env);
    await syncMethodsFromPayload(env);
    await seedBlacklist(env);
    await seedRootUser(env);

    const settings = [
      { key: 'maintenance_mode', value: 'false', type: 'boolean', description: 'API maintenance mode' },
      { key: 'auto_cleanup_enabled', value: 'true', type: 'boolean', description: 'Enable automatic cleanup jobs' },
      { key: 'api_version', value: '1.0.0', type: 'string', description: 'API version' },
      { key: 'uptime_started_at', value: new Date().toISOString(), type: 'string', description: 'Service uptime start timestamp' },
        { key: 'response_include_hint', value: 'true', type: 'boolean', description: 'Include hint in non-admin API responses' },
      { key: 'response_include_timestamp', value: 'true', type: 'boolean', description: 'Include timestamp in non-admin API responses' },
      { key: 'response_include_service', value: 'true', type: 'boolean', description: 'Include service in non-admin API responses' },
      { key: 'response_include_version', value: 'true', type: 'boolean', description: 'Include version in non-admin API responses' },
      { key: 'response_include_ads', value: 'true', type: 'boolean', description: 'Include ads in non-admin API responses' },
      { key: 'response_include_tips', value: 'false', type: 'boolean', description: 'Include tips in non-admin API responses' }
    ];

    for (const item of settings) {
      const existing = await getSystemSetting(env, item.key);
      if (!existing) {
        await setSystemSetting(env, item.key, item.value, item.type, item.description);
      }
    }
  } catch (error) {
    console.error('initializeDatabase error:', error.message);
  }
}

export async function ensureResponseSettings(env) {
  if (responseSettingsReady) return;
  const DB = getDB(env);
  if (!DB) return;

  try {
    for (const setting of RESPONSE_SETTINGS) {
      const existing = await getSystemSetting(env, setting.key);
      if (!existing) {
        await setSystemSetting(env, setting.key, setting.value, setting.type, setting.description);
      }
    }
    responseSettingsReady = true;
  } catch (error) {
    console.error('ensureResponseSettings error:', error.message);
  }
}

export async function getSystemSetting(env, key) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const res = await DB.prepare('SELECT key, value, type, description, created_at, updated_at FROM system_settings WHERE key = ?').bind(key).all();
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
    invalidateSystemSettingCache(key);
  } catch (error) {
    console.error(`Error setting system setting ${key}:`, error.message);
  }
}

export async function getSettingOrDefault(env, key, fallback) {
  const setting = await getSystemSetting(env, key);
  if (setting && setting.value !== undefined && setting.value !== null && setting.value !== '') {
    return setting.value;
  }
  return fallback;
}

export async function getMaintenanceMode(env) {
  const value = await getSettingOrDefault(env, 'maintenance_mode', 'false');
  return (value === 'true' || value === true || value === 1);
}

export async function setMaintenanceMode(env, enabled) {
  await setSystemSetting(env, 'maintenance_mode', enabled ? 'true' : 'false', 'boolean', 'API maintenance mode - disables user attacks');
  await setSystemSetting(env, 'uptime_started_at', new Date().toISOString(), 'string', 'Service uptime start timestamp');
}

export async function getAttacksDisabled(env) {
  const value = await getSettingOrDefault(env, 'attacks_disabled', 'false');
  return (value === 'true' || value === true || value === 1);
}

export async function setAttacksDisabled(env, disabled) {
  await setSystemSetting(env, 'attacks_disabled', disabled ? 'true' : 'false', 'boolean', 'Disable all attack requests globally');
}

export async function getServiceName(env) {
  const value = await getSettingOrDefault(env, 'service_name', 'CAPI');
  return String(value || 'CAPI');
}

export async function setServiceName(env, name) {
  await setSystemSetting(env, 'service_name', String(name || 'CAPI'), 'string', 'Public service name for API responses');
}

export async function getApiVersion(env) {
  const value = await getSettingOrDefault(env, 'api_version', '1.0.0');
  return String(value || '1.0.0');
}

export async function setApiVersion(env, version) {
  await setSystemSetting(env, 'api_version', String(version || '1.0.0'), 'string', 'Current API version');
}

export async function getMethod(env, methodName) {
  const DB = getDB(env);
  if (!DB) return null;
  try {
    const explicit = await DB.prepare('SELECT id, name, description, enabled, default_access, vip, reseller, admin, max_slots, max_concurrents, min_time, default_port, max_time, raw_access, star_access, botnet_access, private_access, created_at, updated_at, target_type FROM methods WHERE name = ?').bind(methodName).all();
    if (explicit?.results?.[0]) return explicit.results[0];

    const fallback = await DB.prepare('SELECT * FROM methods WHERE name = ?').bind(methodName).all();
    return fallback?.results?.[0] || null;
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

  if (updates.default_access !== undefined || updates.default_user !== undefined) {
    fields.push('default_access = ?');
    values.push(Number(updates.default_access ?? updates.default_user) ? 1 : 0);
  }
  if (updates.vip !== undefined || updates.vip_user !== undefined) {
    fields.push('vip = ?');
    values.push(Number(updates.vip ?? updates.vip_user) ? 1 : 0);
  }
  if (updates.reseller !== undefined) {
    fields.push('reseller = ?');
    values.push(Number(updates.reseller) ? 1 : 0);
  }
  if (updates.admin !== undefined) {
    fields.push('admin = ?');
    values.push(Number(updates.admin) ? 1 : 0);
  }
  if (updates.enabled !== undefined) {
    const enabledValue = updates.enabled;
    const normalizedEnabled = (() => {
      if (enabledValue === true || enabledValue === 1 || enabledValue === '1' || enabledValue === 'true') return 1;
      if (enabledValue === false || enabledValue === 0 || enabledValue === '0' || enabledValue === 'false') return 0;
      return Number(enabledValue) ? 1 : 0;
    })();
    fields.push('enabled = ?');
    values.push(normalizedEnabled);
  }
  if (updates.max_slots !== undefined) {
    fields.push('max_slots = ?');
    values.push(Number(updates.max_slots) || 0);
  }
  if (updates.max_concurrents !== undefined) {
    fields.push('max_concurrents = ?');
    values.push(Number(updates.max_concurrents) || 1);
  }
  if (updates.default_port !== undefined) {
    fields.push('default_port = ?');
    values.push(Number(updates.default_port) || 80);
  }
  if (updates.target_type !== undefined) {
    fields.push('target_type = ?');
    values.push(String(updates.target_type || 'ip').toLowerCase());
  }
  if (updates.max_time !== undefined) {
    fields.push('max_time = ?');
    values.push(updates.max_time === null || updates.max_time === '' ? null : Number(updates.max_time));
  }
  if (updates.raw_access !== undefined) {
    fields.push('raw_access = ?');
    values.push(Number(updates.raw_access) ? 1 : 0);
  }
  if (updates.star_access !== undefined) {
    fields.push('star_access = ?');
    values.push(Number(updates.star_access) ? 1 : 0);
  }
  if (updates.botnet_access !== undefined) {
    fields.push('botnet_access = ?');
    values.push(Number(updates.botnet_access) ? 1 : 0);
  }
  if (updates.private_access !== undefined) {
    fields.push('private_access = ?');
    values.push(Number(updates.private_access) ? 1 : 0);
  }
  if (!fields.length) return;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(methodName);

  await DB.prepare(`UPDATE methods SET ${fields.join(', ')} WHERE name = ?`).bind(...values).run();
  invalidateMethodCache();
  invalidateSettingsCache();
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

export async function cleanupOldLogs(env, retentionDays = 30) {
  const DB = getDB(env);
  if (!DB) return { error: 'No database connection', deleted: 0 };
  try {
    const retention = Math.max(1, Number(retentionDays) || 30);
    const retentionMs = retention * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - retentionMs).toISOString();
    
    const result = await DB.prepare("DELETE FROM logs WHERE datetime(created_at) < datetime(?)").bind(cutoffDate).run();
    const deleted = Number(result?.meta?.changes || 0);
    
    return { success: true, deleted, retention_days: retention, cutoff_date: cutoffDate, timestamp: new Date().toISOString() };
  } catch (error) {
    console.error('Error cleaning up old logs:', error.message);
    return { error: error.message, deleted: 0 };
  }
}
