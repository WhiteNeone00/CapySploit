import { jsonResponse, parseQuery, routeNotFound } from './engine.js';
import * as DB from './db.js';

export async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/+/g, '').replace(/\/+$/g, '');

  if (path === '' || path === 'health') {
    return jsonResponse({ name: env.API_NAME || 'CAPI', version: env.API_VERSION || '1.0.0', status: 'ok', timestamp: new Date().toISOString(), endpoints: ['api', 'admin', 'lookup'] });
  }

  const parts = path.split('/');
  const domain = `${parts[0] || ''}/${parts[1] || ''}`.replace(/\/$/, '');

  await DB.ensureTables(env);
  await seedRootUser(env);

  // route dispatch
  if (parts[0] === 'api') return apiHandler(parts.slice(1), request, env);
  if (parts[0] === 'admin') return adminHandler(parts.slice(1), request, env);
  if (parts[0] === 'lookup') return lookupHandler(parts.slice(1), request, env);

  return routeNotFound();
}

async function seedRootUser(env) {
  const DBref = DB.getDB(env);
  const rootUser = env.ROOT_USER || env.CAPI_ROOT_USER || 'root';
  const rootPass = env.ROOT_PASS || env.CAPI_ROOT_PASS || 'admin123';
  if (!DBref) return;
  const users = await DB.listUsers(env);
  if (!users || users.length === 0) {
    await DB.saveUser(env, { username: rootUser, password: rootPass, admin: 1, reseller: 0, vip: 1, holder: 1, api_access: 1, max_time: 500, cooldown: 10, concurrents: 3, max_daily_attacks: 1000, created_by: rootUser, expiry_unix: 0 });
  }
}

async function apiHandler(parts, request, env) {
  const q = parseQuery(request);
  const endpoint = parts[0] || '';
  if (endpoint === 'network_statistics') {
    const total = (await DB.listUsers(env)).length;
    return jsonResponse({ error: false, online_users_count: 1, total_users_count: total, active_users_count: total, expired_users_count: 0, attacks_are_enabled: true, total_ongoing_attacks: 0, max_attack_c2_slots: 9, max_attack_api_slots: 10, maintenance_mode: false, src_name: 'CAPI', src_uptime: 'up' });
  }

  if (endpoint === 'view_plan') {
    const u = await DB.getUser(env, q.username) || { username: q.username || 'test', vip: false, reseller: false, admin: false, holder: false, api_access: false, max_time: 60, cooldown: 45, concurrents: 1 };
    return jsonResponse({ error: false, ...u });
  }

  if (endpoint === 'view_ongoing') {
    return jsonResponse({ error: false, user_only: true, ongoing: [] });
  }

  if (endpoint === 'attack') {
    const qv = parseQuery(request);
    const record = { username: qv.username || 'anon', target: qv.host || '0.0.0.0', port: qv.port || '80', method: qv.method || 'udp', duration: qv.time || '60', concurrents: Number(qv.concurrents || 1), created_at: new Date().toISOString() };
    await DB.addLog(env, record);
    return jsonResponse({ error: false, ...record, message: 'attack queued (simulated)' });
  }

  if (endpoint === 'stop') {
    return jsonResponse({ error: false, kill_id: 1 });
  }

  return routeNotFound();
}

async function adminHandler(parts, request, env) {
  const q = parseQuery(request);
  const endpoint = parts[0] || '';

  if (endpoint === 'add_user') {
    const adminUser = q.username;
    const adminPass = q.password;
    // basic admin check if admin exists
    const admin = adminUser ? await DB.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.username_to_add) return jsonResponse({ error: true, message: 'missing username_to_add' }, 400);
    const user = { username: q.username_to_add, password: q.password_to_add || 'changeme', admin: 0, reseller: 0, vip: 0, holder: 0, api_access: 0, max_time: 60, cooldown: 45, concurrents: 1, max_daily_attacks: 100, created_by: adminUser || 'root', expiry_unix: 0 };
    await DB.saveUser(env, user);
    return jsonResponse({ error: false, message: 'user added', user: { username: user.username } });
  }

  if (endpoint === 'edit_user') {
    if (!q.user_to_edit || !q.field_to_edit) return jsonResponse({ error: true, message: 'missing params' }, 400);
    const u = await DB.getUser(env, q.user_to_edit);
    if (!u) return jsonResponse({ error: true, message: 'user not found' }, 404);
    u[q.field_to_edit] = isNaN(Number(q.new_value)) ? q.new_value : Number(q.new_value);
    await DB.saveUser(env, u);
    return jsonResponse({ error: false, message: 'user updated' });
  }

  if (endpoint === 'delete_user') {
    if (!q.user_to_delete) return jsonResponse({ error: true, message: 'missing user_to_delete' }, 400);
    if (q.user_to_delete === 'root') return jsonResponse({ error: true, message: 'cannot remove root user' }, 403);
    await DB.deleteUser(env, q.user_to_delete);
    return jsonResponse({ error: false, message: 'user removed' });
  }

  if (endpoint === 'view_user_logs') {
    if (!q.user_to_view) return jsonResponse({ error: true, message: 'missing user_to_view' }, 400);
    const logs = await DB.getLogs(env, q.user_to_view);
    return jsonResponse({ error: false, user_logs: logs });
  }

  if (endpoint === 'view_user_plan') {
    const u = await DB.getUser(env, q.user_to_view) || null;
    if (!u) return jsonResponse({ error: true, message: 'user not found' }, 404);
    return jsonResponse(u);
  }

  if (endpoint === 'view_all_logs') {
    const DBref = DB.getDB(env);
    if (!DBref) return jsonResponse({ error: false, logs: [] });
    const res = await DBref.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 100').all();
    return jsonResponse({ error: false, logs: res.results || [] });
  }

  if (endpoint === 'view_all_users') {
    const users = await DB.listUsers(env);
    return jsonResponse({ error: false, users });
  }

  if (endpoint === 'key_info') {
    return jsonResponse({ created_by: 'root', days_remaining: '973.69', dev_infos: 'royalprojets.com', dlc_status: 'true', ip_address: 'IP ADDRESS', license_key: 'License Key', product_name: 'Royal SRC', royal_src_version: '1.8.7.2' });
  }

  return routeNotFound();
}

async function lookupHandler(parts, request, env) {
  const endpoint = parts[0] || '';
  const q = parseQuery(request);
  if (endpoint === 'lookup_fivem') {
    return jsonResponse({ ip_info: { City: 'Gravelines', Country: 'FR', Hostname: 'ip134.ip-137-74-33.eu', IP: '137.74.33.134', Loc: '50.9865,2.1281', Org: 'AS16276 OVH SAS', Postal: '59820', Readme: 'https://ipinfo.io/missingauth', Region: 'Hauts-de-France', Timezone: 'Europe/Paris' }, server: { CurrentClients: 1, DiscordLink: 'https://discord.gg/stellantia', EnhancedHosting: 'true', Gametype: 'Stellantia RP', IP: '137.74.33.134', Map: 'San Andreas', MaxClients: 128, Name: '^5Stellantia RP^0', Owner: 'DrekRS', Port: '30176', ProjectDesc: 'Compatible manette ! Serveur français FreeAccess basé sur un RP USA, plongez dans un RP immersif !', ProjectName: 'Stellantia RP', ResourcesCount: 249, ServerVersion: 'FXServer-master v1.0.0.12180 linux' } });
  }
  if (endpoint === 'lookup_mc') {
    return jsonResponse({ ip_info: { City: 'Paris', Country: 'FR', Hostname: '88-177-70-205.subs.proxad.net', IP: '88.177.70.205', Loc: '48.8534,2.3488', Org: 'AS12322 Free SAS', Postal: '75000', Readme: 'https://ipinfo.io/missingauth', Region: 'Île-de-France', Timezone: 'Europe/Paris' }, server: { City: 'Paris', Country: 'FR', Hostname: 'membre.papanost.fr', IP: '88.177.70.205', Port: 25565, Postal: '75000', Region: 'Île-de-France', Timezone: 'Europe/Paris' } });
  }
  return routeNotFound();
}
