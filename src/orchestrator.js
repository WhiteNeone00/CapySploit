// Main request router for API, admin, and lookup endpoints.
import { jsonResponse, routeNotFound } from './response.js';
import * as Vault from './vault-db.js';
import { initializeAll, getInitializationStatus } from './initialize.js';
import { apiHandler } from './api.js';
import { adminHandler } from './admin.js';
import { lookupHandler } from './lookup.js';
import { DATABASE_CONFIG, HTTP_CODES, CACHE_CONFIG, CONCURRENCY_CONFIG, APP_DEFAULTS } from './config.js';
import { generateRequestId, StructuredLogger } from './logger.js';
import { validateRequestSize, sanitizeErrorMessage } from './validator.js';
import { cleanupExpiredAuthAttempts, getCachedSystemSetting, cleanupCacheStores } from './helpers.js';

const MAX_REQUEST_SIZE = 1048576; // 1MB limit
const INIT_CHECK_INTERVAL = 60000; // 1 minute between init checks

let dbInitialized = false;
let initializationPromise = null;
let lastInitCheck = 0;
let lastCleanupTime = 0;
let lastCacheCleanupTime = 0;
let cleanupQueue = [];
let isCleanupRunning = false;

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

    // Load independent settings concurrently and cache them between requests.
    const [maintenanceEnabled, serviceName, apiVersion] = await Promise.all([
      getCachedSystemSetting(
        'maintenance_mode',
        async () => (await Vault.getMaintenanceMode(env)) ? 'true' : 'false'
      ),
      getCachedSystemSetting('service_name', async () => Vault.getServiceName(env)),
      getCachedSystemSetting('api_version', async () => Vault.getApiVersion(env))
    ]);
    const isMaintenance = maintenanceEnabled === 'true';

    if (isMaintenance && parts[0] !== 'admin') {
      logger.info('maintenance_mode_active', { endpoint: parts[0] });
      return jsonResponse({
        error: true,
        message: 'Maintenance mode is active. The service is temporarily unavailable while scheduled maintenance is in progress.',
        status: 'maintenance',
        maintenance_mode: true,
        service: serviceName,
        available: ['admin'],
        endpoints: { admin: '/admin/<action>' },
        hint: 'Only administrative routes are available during maintenance. Please try again later.'
      }, 503, { service: serviceName, version: apiVersion, requestId });
    }

    if (path === '' || path === 'health') {
      logger.metric('health_check', 1);
      return jsonResponse({
        name: serviceName,
        version: apiVersion,
        status: isMaintenance ? 'maintenance' : 'ok',
        uptime: isMaintenance ? 'maintenance' : 'online',
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

    // Initialize database and seed defaults on first request
    if (!dbInitialized) {
      initializationPromise ||= initializeAll(env);
      const currentInitialization = initializationPromise;
      try {
        await currentInitialization;
        dbInitialized = true;
      } finally {
        if (initializationPromise === currentInitialization) initializationPromise = null;
      }
      logger.info('database_initialized');
    }

    // Queue processing disabled by user request; direct execution is preferred.

    // Periodically cleanup cache stores
    const now = Date.now();
    if (now - lastCacheCleanupTime > CACHE_CONFIG.CLEANUP_INTERVAL_MS) {
      lastCacheCleanupTime = now;
      cleanupCacheStores();
    }

    // Create request context to avoid repeated DB lookups
    const requestContext = {
      requestId,
      username,
      sourceIp,
      user: null,
      userBypassEnabled: false,
      rateLimitTarget: username ? `route:${username}` : `route:${sourceIp}`,
      serviceName,
      apiVersion
    };

    // Load user info once per request if username provided
    if (username) {
      try {
        requestContext.user = await Vault.getUser(env, username);
        requestContext.userBypassEnabled = Boolean(requestContext.user?.bypass_anti_spam);
      } catch (e) {
        logger.error('user_lookup_error', e);
        // Continue without user context
      }
    }

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
