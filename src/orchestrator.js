// Main request router for API, admin, and lookup endpoints.
import { jsonResponse, routeNotFound } from './response.js';
import * as Vault from './vault-db.js';
import { apiHandler } from './api.js';
import { adminHandler } from './admin.js';
import { lookupHandler } from './lookup.js';

let dbInitialized = false;
let lastCleanupTime = 0;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Run cleanup every 5 minutes

export async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/+/g, '').replace(/\/+$/g, '');

  const parts = path.split('/');

  const maintenanceEnabled = await Vault.getMaintenanceMode(env);
  if (maintenanceEnabled && parts[0] !== 'admin') {
    const serviceName = env.API_NAME || 'CAPI';
    return jsonResponse({
      error: true,
      message: 'Maintenance mode is active. The service is temporarily unavailable while scheduled maintenance is in progress.',
      status: 'maintenance',
      maintenance_mode: true,
      service: serviceName,
      available: ['admin'],
      endpoints: {
        admin: '/admin/<action>'
      },
      hint: 'Only administrative routes are available during maintenance. Please try again later.'
    }, 503, { service: serviceName });
  }

  if (path === '' || path === 'health') {
    const serviceName = env.API_NAME || 'CAPI';
    return jsonResponse({
      name: serviceName,
      version: env.API_VERSION || '1.0.0',
      status: maintenanceEnabled ? 'maintenance' : 'ok',
      uptime: maintenanceEnabled ? 'maintenance' : 'online',
      timestamp: new Date().toISOString(),
      service: serviceName,
      description: 'CAPI / CapySploit control plane with attack routing, admin controls, and lookup helpers.',
      endpoints: {
        api: '/api/<action>',
        admin: '/admin/<action>',
        lookup: '/lookup/<type>'
      },
      available_actions: ['view_plan', 'attack', 'view_ongoing', 'my_attacks', 'network_statistics', 'list_methods', 'syntax_check']
    }, maintenanceEnabled ? 503 : 200, { service: serviceName });
  }

  // Initialize database and seed defaults on first request
  if (!dbInitialized) {
    await Vault.initializeDatabase(env);
    dbInitialized = true;
  }

  // Periodically cleanup old logs to prevent unbounded database growth
  const now = Date.now();
  if (now - lastCleanupTime > CLEANUP_INTERVAL_MS) {
    lastCleanupTime = now;
    // Run cleanup in background (don't await to not block response)
    Vault.cleanupOldLogs(env, 30).catch(e => console.error('Background cleanup failed:', e.message));
  }

  const query = new URL(request.url).searchParams;
  const username = String(query.get('username') || '').trim();
  const sourceIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimitTarget = username ? `route:${username}` : `route:${sourceIp}`;
  const bypassEnabled = username ? Boolean((await Vault.getUser(env, username))?.bypass_anti_spam) : false;
  if (!bypassEnabled) {
    const rateLimit = await import('./helpers.js').then(({ applyGlobalRateLimit }) => applyGlobalRateLimit(rateLimitTarget, false, 1));
    if (!rateLimit.allowed) {
      return jsonResponse({
        error: true,
        message: 'Too many requests. Please wait 1 second and try again.',
        status: 'rate_limited',
        retry_after: rateLimit.secondsUntilAvailable,
        hint: 'Rapid requests are blocked to protect the service and queue state.'
      }, 429, { service: env.API_NAME || 'CAPI' });
    }
  }

  if (parts[0] === 'api') return apiHandler(parts.slice(1), request, env);
  if (parts[0] === 'admin') return adminHandler(parts.slice(1), request, env);
  if (parts[0] === 'lookup') return lookupHandler(parts.slice(1), request, env);
  if (parts[0] === 'discord' || parts[0] === 'interactions') {
    const { handleDiscordInteraction, registerDiscordCommand } = await import('./discord-interactions.js');
    if (parts[0] === 'discord' && parts[1] === 'register') {
      return await registerDiscordCommand(request, env);
    }
    return await handleDiscordInteraction(request, env);
  }

  return routeNotFound(path);
}

export {};
