// Admin route handlers for user, method, blacklist, and misc controls.
import { jsonResponse, structuredResponse, parseQuery, routeNotFound, resolveServiceName, makePolishedError } from './response.js';
import * as Vault from './vault-db.js';
import { checkJavaScriptSyntax } from './response.js';
import { getPayloadMethods } from '../payload.js';

async function requireAdminCredentials(q, env) {
  const username = String(q.username || '').trim();
  const password = String(q.password || '').trim();

  if (!username || !password) {
    return { ok: false, response: makePolishedError('admin authentication required', 401, { hint: 'Provide username and password as query parameters for the admin route.' }) };
  }

  const admin = await Vault.getUser(env, username);
  if (!admin || admin.password !== password || !admin.admin) {
    return { ok: false, response: makePolishedError('invalid admin credentials', 401, { hint: 'Use a valid administrator account and its matching password.' }) };
  }

  return { ok: true, admin };
}

export async function adminHandler(parts, request, env) {
  const q = parseQuery(request);
  const endpoint = parts[0] || '';

  const guard = await requireAdminCredentials(q, env);
  if (!guard.ok) return guard.response;

  if (endpoint === 'add_user') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return makePolishedError('invalid admin credentials', 401, { hint: 'Use the correct admin username and password.' });
    if (!q.username_to_add) return makePolishedError('missing username_to_add', 400, { hint: 'Provide username_to_add in the request.' });
    const inheritedServiceName = admin?.service_name || (admin?.reseller ? q.service_name || admin?.service_name : null) || null;
    const user = {
      username: q.username_to_add,
      password: q.password_to_add || 'changeme',
      admin: 0,
      reseller: 0,
      vip: 0,
      holder: 0,
      api_access: 0,
      max_time: 60,
      min_time: 30,
      cooldown: 45,
      concurrents: 1,
      max_concurrents: 1,
      max_daily_attacks: 100,
      created_by: adminUser || 'root',
      expiry_unix: 0,
      allowed_methods: q.allowed_methods || null,
      allowed_targets: q.allowed_targets || null,
      bypass_slots: Number(q.bypass_slots || 0),
      suspended: Number(q.suspended || 0),
      service_name: q.service_name || inheritedServiceName || null
    };
    await Vault.saveUser(env, user);
    return jsonResponse({ error: false, message: 'user added', user: { username: user.username } });
  }

  if (endpoint === 'edit_user') {
    if (!q.user_to_edit || !q.field_to_edit) return makePolishedError('missing params', 400, { hint: 'Provide both user_to_edit and field_to_edit.' });
    const u = await Vault.getUser(env, q.user_to_edit);
    if (!u) return makePolishedError('user not found', 404, { hint: 'Verify the username before trying again.' });
    u[q.field_to_edit] = isNaN(Number(q.new_value)) ? q.new_value : Number(q.new_value);
    await Vault.saveUser(env, u);
    return jsonResponse({ error: false, message: 'user updated' });
  }

  if (endpoint === 'delete_user') {
    if (!q.user_to_delete) return makePolishedError('missing user_to_delete', 400, { hint: 'Provide user_to_delete in the request.' });
    if (q.user_to_delete === 'root') return makePolishedError('cannot remove root user', 403, { hint: 'Use a different target than the root account.' });
    await Vault.deleteUser(env, q.user_to_delete);
    return jsonResponse({ error: false, message: 'user removed' });
  }

  if (endpoint === 'view_user_logs') {
    if (!q.user_to_view) return makePolishedError('missing user_to_view', 400, { hint: 'Provide user_to_view in the request.' });
    const logs = await Vault.getLogs(env, q.user_to_view);
    return structuredResponse({ error: false, message: 'user logs loaded', data: { user: q.user_to_view, logs } });
  }

  if (endpoint === 'view_user_plan') {
    const u = await Vault.getUser(env, q.user_to_view) || null;
    if (!u) return makePolishedError('user not found', 404, { hint: 'Verify the username before trying again.' });
    const warnings = await Vault.getUserWarnings(env, u.username);
    const serviceName = await resolveServiceName(u, env, env.API_NAME || 'CAPI');
    const warnLabel = warnings.count >= 5 ? `🚫 ${warnings.count}/5 warnings` : `⚠️ ${warnings.count}/5 warnings`;
    const discordLink = await Vault.getVerifiedDiscordLinkByUsername(env, u.username);
    return structuredResponse({
      error: false,
      message: 'user plan loaded',
      data: {
        user: {
          ...u,
          service_name: serviceName,
          warning_status: `${warnings.count}/5`,
          warning_summary: warnLabel,
          warnings: { count: warnings.count, limit: 5, suspended: Boolean(u.suspended), label: warnLabel },
          discord_link: discordLink ? {
            linked: true,
            client: discordLink.client,
            discord_user_id: discordLink.discord_user_id,
            discord_username: discordLink.discord_username,
            verified_at: discordLink.verified_at
          } : { linked: false }
        }
      },
      service: serviceName
    });
  }

  if (endpoint === 'unlink_discord') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (!admin || admin.password !== adminPass || !admin.admin) return makePolishedError('invalid admin credentials', 401, { hint: 'Use a valid admin account to unlink Discord verification.' });
    if (!q.user_to_unlink) return makePolishedError('missing user_to_unlink', 400, { hint: 'Provide user_to_unlink in the request.' });
    const result = await Vault.unlinkDiscordLinkByUsername(env, q.user_to_unlink, adminUser);
    if (!result) return makePolishedError('no verified discord link found for user', 404, { hint: 'The target user does not have an active Discord verification to unlink.' });
    return jsonResponse({ error: false, message: 'discord link removed', user: q.user_to_unlink, discord_user_id: result.discord_user_id, discord_username: result.discord_username, unlinked_at: result.unlinked_at });
  }

  if (endpoint === 'view_all_logs') {
    const DBref = Vault.getDB(env);
    if (!DBref) return structuredResponse({ error: false, message: 'no log database available', data: { logs: [] } });
    const res = await DBref.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 100').all();
    return structuredResponse({ error: false, message: 'all logs loaded', data: { logs: res.results || [] } });
  }

  if (endpoint === 'view_all_users') {
    const users = await Vault.listUsers(env);
    return structuredResponse({ error: false, message: 'all users loaded', data: { users } });
  }

  if (endpoint === 'syntax_check') {
    const source = q.source || q.code || '';
    if (!source) return makePolishedError('missing source', 400, { hint: 'Provide the source code to validate.' });
    const result = checkJavaScriptSyntax(source, q.file_name || q.file || 'inline.js');
    if (!result.valid) {
      return structuredResponse({ error: true, message: 'syntax check failed', status: 400, extra: { debug: result } });
    }
    return structuredResponse({ error: false, message: 'syntax check passed', data: { valid: true, file: q.file_name || q.file || 'inline.js' } });
  }

  if (endpoint === 'add_api') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.url) return makePolishedError('missing url', 400, { hint: 'Provide the target URL for the new API endpoint.' });
    await Vault.addAPI(env, { name: q.name || 'api', url: q.url, method: q.method || 'GET', active: q.active ? 1 : 1 });
    return jsonResponse({ error: false, message: 'api endpoint added' });
  }

  if (endpoint === 'list_apis') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    const apis = await Vault.listAPIs(env);
    return jsonResponse({ error: false, apis });
  }

  if (endpoint === 'delete_api') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.id) return makePolishedError('missing id', 400, { hint: 'Provide the numeric id of the API endpoint to remove.' });
    await Vault.deleteAPI(env, q.id);
    return jsonResponse({ error: false, message: 'api removed' });
  }

  if (endpoint === 'add_method') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.name) return makePolishedError('missing name', 400, { hint: 'Provide a method name for the new method.' });
    await Vault.addMethod(env, { name: q.name, description: q.description || `${q.name} method` });
    return jsonResponse({ error: false, message: 'method added' });
  }

  if (endpoint === 'list_methods') {
    const dbMethods = await Vault.listMethods(env);
    const payloadMethods = getPayloadMethods();
    const methodMap = new Map((payloadMethods || []).map((item) => [String(item?.name || '').toLowerCase(), item]));

    const methods = (dbMethods || []).map((method) => {
      const meta = methodMap.get(String(method?.name || '').toLowerCase()) || null;
      return {
        id: method?.id || null,
        name: method?.name || null,
        description: method?.description || meta?.description || `${method?.name || 'method'} method`,
        created_at: method?.created_at || null,
        enabled: Boolean(meta?.enabled ?? true),
        target_type: meta?.target_type || null,
        default_port: meta?.default_port || null,
        min_time: meta?.min_time || null,
        max_time: meta?.max_time || null,
        max_concurrents: meta?.max_concurrents || null,
        max_slots: meta?.max_slots || null,
        api_links: Array.isArray(meta?.api_links) ? meta.api_links : []
      };
    });

    return structuredResponse({ error: false, message: 'methods loaded', data: { methods } });
  }

  if (endpoint === 'add_blacklist') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.target) return makePolishedError('missing target', 400, { hint: 'Provide the target to blacklist.' });
    await Vault.addBlacklistTarget(env, q.target, q.reason || 'manual');
    return jsonResponse({ error: false, message: 'target blacklisted' });
  }

  if (endpoint === 'list_blacklist') {
    const data = await Vault.listBlacklist(env);
    return structuredResponse({ error: false, message: 'blacklist loaded', data: { blacklist: data } });
  }

  if (endpoint === 'remove_blacklist') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.target && !q.id) return makePolishedError('missing target or id', 400, { hint: 'Provide either the blacklist target or its id.' });
    await Vault.removeBlacklistTarget(env, q.target || q.id);
    return jsonResponse({ error: false, message: 'blacklist entry removed' });
  }

  if (endpoint === 'suspend_user') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.user_to_suspend) return makePolishedError('missing user_to_suspend', 400, { hint: 'Provide the target username to suspend.' });
    const reason = q.reason || 'Suspended by admin action.';
    const actor = adminUser || 'admin';
    await Vault.setUserSuspension(env, q.user_to_suspend, true, reason, actor);
    return jsonResponse({ error: false, message: 'user suspended', user: q.user_to_suspend, suspended_by: actor, suspend_reason: reason });
  }

  if (endpoint === 'unsuspend_user') {
    const adminUser = q.username;
    const adminPass = q.password;
    const admin = adminUser ? await Vault.getUser(env, adminUser) : null;
    if (admin && admin.password !== adminPass) return jsonResponse({ error: true, message: 'invalid admin credentials' }, 401);
    if (!q.user_to_unsuspend) return makePolishedError('missing user_to_unsuspend', 400, { hint: 'Provide the target username to unsuspend.' });
    await Vault.clearUserWarnings(env, q.user_to_unsuspend);
    await Vault.setUserSuspension(env, q.user_to_unsuspend, false, null, null);
    return jsonResponse({ error: false, message: 'user unsuspended', user: q.user_to_unsuspend });
  }

  if (endpoint === 'key_info') {
    return structuredResponse({ error: false, message: 'license info loaded', data: { created_by: 'root', days_remaining: '973.69', dev_infos: 'capi.dev', dlc_status: 'true', ip_address: 'IP ADDRESS', license_key: 'License Key', product_name: 'CAPI / CapySploit', royal_src_version: '1.8.7.2' } });
  }

  return routeNotFound();
}
