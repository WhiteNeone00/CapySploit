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
      cooldown INTEGER DEFAULT 45,
      concurrents INTEGER DEFAULT 1,
      max_daily_attacks INTEGER DEFAULT 100,
      created_by TEXT,
      expiry_unix INTEGER
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
  await DB.prepare(`INSERT OR REPLACE INTO users (username,password,admin,reseller,vip,holder,api_access,max_time,cooldown,concurrents,max_daily_attacks,created_by,expiry_unix) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    user.username, user.password, user.admin ? 1 : 0, user.reseller ? 1 : 0, user.vip ? 1 : 0, user.holder ? 1 : 0, user.api_access ? 1 : 0, user.max_time || 60, user.cooldown || 45, user.concurrents || 1, user.max_daily_attacks || 100, user.created_by || 'root', user.expiry_unix || 0
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
  const res = await DB.prepare('SELECT username,admin,vip,reseller,holder,api_access,max_time,cooldown,concurrents,max_daily_attacks,created_by,expiry_unix FROM users').all();
  return res.results || [];
}

export async function addLog(env, log) {
  const DB = getDB(env);
  if (!DB) return;
  await DB.prepare('INSERT INTO logs (username,target,port,method,duration,concurrents,created_at) VALUES (?,?,?,?,?,?,?)').bind(log.username, log.target, log.port, log.method, log.duration, log.concurrents || 1, log.created_at || new Date().toISOString()).run();
}

export async function getLogs(env, username) {
  const DB = getDB(env);
  if (!DB) return [];
  const res = await DB.prepare('SELECT * FROM logs WHERE username = ?').bind(username).all();
  return res.results || [];
}
