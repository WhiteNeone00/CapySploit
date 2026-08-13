// Main request router for API, admin, and lookup endpoints.
import { jsonResponse, routeNotFound } from './response.js';
import * as Vault from './vault-db.js';
import { apiHandler } from './api.js';
import { adminHandler } from './admin.js';
import { lookupHandler } from './lookup.js';
import { DATABASE_CONFIG, HTTP_CODES } from './config.js';
import { generateRequestId, StructuredLogger } from './logger.js';
import { validateRequestSize, sanitizeErrorMessage } from './validator.js';

const MAX_REQUEST_SIZE = 1048576; // 1MB limit

let dbInitialized = false;
let lastCleanupTime = 0;

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

    const maintenanceEnabled = await Vault.getMaintenanceMode(env);
    if (maintenanceEnabled && parts[0] !== 'admin') {
      const serviceName = env.API_NAME || 'CAPI';
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
      }, 503, { service: serviceName, requestId });
    }

    if (path === '' || path === 'health') {
      const serviceName = env.API_NAME || 'CAPI';
      logger.metric('health_check', 1);
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
      }, maintenanceEnabled ? 503 : 200, { service: serviceName, requestId });
    }

    // Initialize database and seed defaults on first request
    if (!dbInitialized) {
      await Vault.initializeDatabase(env);
      dbInitialized = true;
      logger.info('database_initialized');
    }

    // Periodically cleanup old logs to prevent unbounded database growth
    const now = Date.now();
    if (now - lastCleanupTime > DATABASE_CONFIG.CLEANUP_INTERVAL_MS) {
      lastCleanupTime = now;
      // Run cleanup in background (don't await to not block response)
      Vault.cleanupOldLogs(env, 30).catch(e => logger.error('cleanup_failed', e));
    }

    const query = new URL(request.url).searchParams;
    const username = String(query.get('username') || '').trim();
    const sourceIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitTarget = username ? `route:${username}` : `route:${sourceIp}`;
    const bypassEnabled = username ? Boolean((await Vault.getUser(env, username))?.bypass_anti_spam) : false;

    if (!bypassEnabled) {
      const { applyGlobalRateLimit } = await import('./helpers.js');
      const rateLimit = await applyGlobalRateLimit(rateLimitTarget, false, 1);
      if (!rateLimit.allowed) {
        logger.security('rate_limit_exceeded', 'WARNING', { target: rateLimitTarget, ip: sourceIp });
        return jsonResponse({
          error: true,
          message: 'Too many requests. Please wait 1 second and try again.',
          status: 'rate_limited',
          retry_after: rateLimit.secondsUntilAvailable,
          hint: 'Rapid requests are blocked to protect the service and queue state.'
        }, 429, { service: env.API_NAME || 'CAPI', requestId });
      }
    }

    // Route requests to appropriate handler with requestId
    if (parts[0] === 'api') {
      logger.info('route_api', { endpoint: parts[1] });
      return apiHandler(parts.slice(1), request, env, requestId, logger);
    }
    if (parts[0] === 'admin') {
      logger.auth('admin_access_attempt', username, true);
      return adminHandler(parts.slice(1), request, env, requestId, logger);
    }
    if (parts[0] === 'lookup') {
      logger.info('route_lookup', { type: parts[1] });
      return lookupHandler(parts.slice(1), request, env, requestId, logger);
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
