// Main request router for API, admin, and lookup endpoints.
import { jsonResponse, routeNotFound } from './response.js';
import * as Vault from './vault-db.js';
import { initializeAll } from './initialize.js';
import { apiHandler } from './api.js';
import { adminHandler } from './admin.js';
import { lookupHandler } from './lookup.js';
import { DATABASE_CONFIG, HTTP_CODES, CACHE_CONFIG, APP_DEFAULTS, RATE_LIMIT_CONFIG } from './config.js';
import { generateRequestId, StructuredLogger } from './logger.js';
import { validateRequestSize, sanitizeErrorMessage } from './validator.js';
import { getCachedSystemSetting, cleanupCacheStores, checkApiRateLimit } from './helpers.js';

const MAX_REQUEST_SIZE = 1048576; // 1MB limit
let dbInitialized = false;
let initializationPromise = null;
let lastCleanupTime = 0;
let lastCacheCleanupTime = 0;
let cleanupQueue = [];
let isCleanupRunning = false;

function formatUptime(startedAt) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const days = Math.floor(elapsedSeconds / 86400);
  const hours = Math.floor((elapsedSeconds % 86400) / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

/**
 * Background cleanup queue handler
 * Runs cleanup tasks asynchronously without blocking requests
 */
async function processCleanupQueue() {
  if (isCleanupRunning || cleanupQueue.length === 0) return;
  isCleanupRunning = true;
  
  try {
    while (cleanupQueue.length > 0) {
      const task = cleanupQueue.shift();
      try {
        await task();
      } catch (e) {
        console.error('Cleanup task failed:', e.message);
      }
    }
  } finally {
    isCleanupRunning = false;
  }
}

/**
 * Queue a cleanup task to run in background
 * @param {Function} task - Async cleanup function
 */
function queueCleanupTask(task) {
  cleanupQueue.push(task);
  // Don't await - let it run in background
  processCleanupQueue().catch(e => console.error('Cleanup queue error:', e));
}

export async function handleRequest(request, env) {
  // Generate unique request ID for tracking
  const requestId = generateRequestId();
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/+/g, '').replace(/\/+$/g, '');
  const logger = new StructuredLogger(requestId, path, request.method);

  try {
    // Check request size limit
    const contentLength = request.headers.get('content-length');
    const sizeValidation = validateRequestSize(contentLength, MAX_REQUEST_SIZE);
    if (!sizeValidation.valid) {
      logger.security('request_too_large', 'WARNING', { content_length: contentLength });
      return jsonResponse({
        error: true,
        message: sizeValidation.error,
        status: 'error'
      }, sizeValidation.status || HTTP_CODES.BAD_REQUEST);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'X-Request-ID': requestId
        }
      });
    }

    const parts = path.split('/');
    const query = new URL(request.url).searchParams;
    const username = String(query.get('username') || '').trim();
    const sourceIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

    if (RATE_LIMIT_CONFIG.ENABLED && RATE_LIMIT_CONFIG.PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix.replace(/^\//, '')))) {
      const rateLimitKey = username ? `route:${username}` : `route:${sourceIp}`;
      const rateLimitCheck = checkApiRateLimit(rateLimitKey, RATE_LIMIT_CONFIG.WINDOW_SECONDS);
      if (!rateLimitCheck.allowed) {
        return jsonResponse({
          error: true,
          message: `Rate limited. Please wait ${rateLimitCheck.secondsUntilAvailable} second${rateLimitCheck.secondsUntilAvailable !== 1 ? 's' : ''} before trying again.`,
          status: 'rate_limited',
          retry_after: rateLimitCheck.secondsUntilAvailable
        }, 429, { service: env.API_NAME || APP_DEFAULTS.DEFAULT_SERVICE_NAME, version: env.API_VERSION || '1.0.0', requestId });
      }
    }

    // Load independent settings concurrently and cache them between requests.
    const [maintenanceEnabled, serviceName, apiVersion, uptimeStartedAt] = await Promise.all([
      getCachedSystemSetting(
        'maintenance_mode',
        async () => (await Vault.getMaintenanceMode(env)) ? 'true' : 'false'
      ),
      getCachedSystemSetting('service_name', async () => Vault.getServiceName(env)),
      getCachedSystemSetting('api_version', async () => Vault.getApiVersion(env)),
      getCachedSystemSetting('uptime_started_at', async () => Vault.getSettingOrDefault(env, 'uptime_started_at', new Date().toISOString()))
    ]);
    const isMaintenance = maintenanceEnabled === 'true';
    const uptimeStartedMs = Date.parse(uptimeStartedAt);
    const uptime = formatUptime(Number.isFinite(uptimeStartedMs) ? uptimeStartedMs : Date.now());

    const attackRouteInMaintenance = isMaintenance && parts[0] === 'api' && parts[1] === 'attack';
    if (attackRouteInMaintenance) {
      logger.info('maintenance_mode_active', { endpoint: parts[0] });
      return jsonResponse({
        error: true,
        message: 'Attacks are temporarily disabled while maintenance mode is active.',
        status: 'maintenance',
        maintenance_mode: true,
        service: serviceName,
        hint: 'API status, plans, methods, and other read-only endpoints remain available.'
      }, 503, { service: serviceName, version: apiVersion, requestId });
    }

    if (path === '' || path === 'health') {
      logger.metric('health_check', 1);
      return jsonResponse({
        name: serviceName,
        version: apiVersion,
        status: isMaintenance ? 'maintenance' : 'ok',
        uptime,
        uptime_started_at: uptimeStartedAt,
        timestamp: new Date().toISOString(),
        service: serviceName,
        description: 'CAPI / CapySploit control plane with attack routing, admin controls, and lookup helpers.',
        endpoints: {
          api: '/api/<action>',
          admin: '/admin/<action>',
          lookup: '/lookup/<type>'
        },
        available_actions: ['view_plan', 'attack', 'view_ongoing', 'my_attacks', 'network_statistics', 'list_methods', 'syntax_check']
      }, isMaintenance ? 503 : 200, { service: serviceName, version: apiVersion, requestId });
    }

    // Bootstrap only when the core schema is missing; avoid full seeding on every cold worker.
    if (!dbInitialized) {
      let schemaReady = false;
      try {
        const schema = await env?.capi_db?.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'plans', 'methods')"
        ).all();
        schemaReady = (schema?.results || []).length === 3;
      } catch (error) {
        schemaReady = false;
      }

      if (!schemaReady) {
        initializationPromise ||= initializeAll(env);
        const currentInitialization = initializationPromise;
        try {
          await currentInitialization;
        } finally {
          if (initializationPromise === currentInitialization) initializationPromise = null;
        }
      }
      dbInitialized = true;
      logger.info('database_initialized');
    }

    // Periodically cleanup cache stores
    const now = Date.now();
    if (now - lastCacheCleanupTime > CACHE_CONFIG.CLEANUP_INTERVAL_MS) {
      lastCacheCleanupTime = now;
      cleanupCacheStores();
    }

    if (now - lastCleanupTime > DATABASE_CONFIG.CLEANUP_INTERVAL_MS) {
      lastCleanupTime = now;
      queueCleanupTask(async () => {
        const cleanupSetting = await Vault.getSystemSetting(env, 'auto_cleanup_enabled');
        if (cleanupSetting?.value === 'false') return;
        await Vault.cleanupOngoing(env);
      });
    }

    // Pass shared request metadata to route handlers.
    const requestContext = {
      requestId,
      username,
      sourceIp,
      user: null,
      rateLimitTarget: username ? `route:${username}` : `route:${sourceIp}`,
      serviceName,
      apiVersion,
      uptime
    };

    // Route requests to appropriate handler with context
    if (parts[0] === 'api') {
      logger.info('route_api', { endpoint: parts[1] });
      return apiHandler(parts.slice(1), request, env, requestId, logger, requestContext);
    }
    if (parts[0] === 'admin') {
      logger.auth('admin_access_attempt', username, true);
      return adminHandler(parts.slice(1), request, env, requestId, logger, requestContext);
    }
    if (parts[0] === 'lookup') {
      logger.info('route_lookup', { type: parts[1] });
      return lookupHandler(parts.slice(1), request, env, requestId, logger, requestContext);
    }
    if (parts[0] === 'discord' || parts[0] === 'interactions') {
      const { handleDiscordInteraction, registerDiscordCommand } = await import('./discord-interactions.js');
      if (parts[0] === 'discord' && parts[1] === 'register') {
        logger.info('discord_command_register');
        return await registerDiscordCommand(request, env, requestId, logger);
      }
      logger.info('discord_interaction');
      return await handleDiscordInteraction(request, env, requestId, logger);
    }

    logger.info('route_not_found', { path });
    return routeNotFound(path);
  } catch (error) {
    logger.error('unhandled_error', error, { path: url.pathname });
    const safeMessage = sanitizeErrorMessage(error);
    return jsonResponse({
      error: true,
      message: safeMessage,
      status: 'error',
      hint: 'An unexpected error occurred. If this persists, contact support.'
    }, HTTP_CODES.INTERNAL_SERVER_ERROR, { requestId });
  }
}

export {};
