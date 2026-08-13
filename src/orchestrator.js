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

  if (path === '' || path === 'health') {
    const serviceName = env.API_NAME || 'CAPI';
    return jsonResponse({
      name: serviceName,
      version: env.API_VERSION || '1.0.0',
      status: 'ok',
      uptime: 'online',
      timestamp: new Date().toISOString(),
      service: serviceName,
      description: 'CAPI / CapySploit control plane with attack routing, admin controls, and lookup helpers.',
      endpoints: {
        api: '/api/<action>',
        admin: '/admin/<action>',
        lookup: '/lookup/<type>'
      },
      available_actions: ['view_profile', 'view_plan', 'attack', 'view_ongoing', 'network_statistics', 'list_methods', 'syntax_check']
    }, 200, { service: serviceName });
  }

  const parts = path.split('/');

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

  // Check maintenance mode - STRICTLY only allow /admin/ when enabled (no exceptions)
  const maintenanceEnabled = await Vault.getMaintenanceMode(env);
  if (maintenanceEnabled && parts[0] !== 'admin') {
    return jsonResponse({
      error: true,
      message: 'API is in maintenance mode. Only /admin/ endpoints are available.',
      status: 503,
      service: env.API_NAME || 'CAPI'
    }, 503);
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
