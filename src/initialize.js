/**
 * Auto-initialization module for CAPI
 * Handles first-time setup of D1 database tables, seed data, and system defaults.
 */

import * as Vault from './vault-db.js';

/**
 * Initialize D1 database with all tables and seed data
 * Safe to call multiple times - uses IF NOT EXISTS for all operations
 * @param {Object} env - Cloudflare environment bindings
 * @returns {Promise<Object>} Initialization result
 */
export async function initializeDatabase(env) {
  if (!env || !env.capi_db) {
    return { success: false, error: 'D1 database not configured' };
  }

  try {
    await Vault.initializeDatabase(env);
    await initializeSystemSettings(env);

    return { 
      success: true, 
      message: 'Database initialized successfully',
      tables: ['plans', 'users', 'methods', 'blacklist', 'ongoing_attacks', 'discord_links', 'system_settings']
    };
  } catch (error) {
    console.error('Database initialization failed:', error);
    return { 
      success: false, 
      error: error?.message || 'Database initialization failed' 
    };
  }
}

/**
 * Initialize system settings table with default values
 * @param {Object} env - Cloudflare environment
 */
async function initializeSystemSettings(env) {
  const defaults = [
    { key: 'api_version', value: '1.0.0', type: 'string', description: 'Current API version' },
    { key: 'service_name', value: 'CAPI', type: 'string', description: 'Public service name for API responses' },
    { key: 'maintenance_mode', value: 'false', type: 'boolean', description: 'Enable maintenance mode to disable non-admin access' },
    { key: 'attacks_disabled', value: 'false', type: 'boolean', description: 'Disable all attack requests globally' },
    { key: 'rate_limit_enabled', value: 'true', type: 'boolean', description: 'Enable global rate limiting' },
    { key: 'auto_cleanup_enabled', value: 'true', type: 'boolean', description: 'Enable automatic cleanup jobs' },
    { key: 'response_include_hint', value: 'true', type: 'boolean', description: 'Include hint in non-admin API responses' },
    { key: 'response_include_timestamp', value: 'true', type: 'boolean', description: 'Include timestamp in non-admin API responses' },
    { key: 'response_include_service', value: 'true', type: 'boolean', description: 'Include service in non-admin API responses' },
    { key: 'response_include_version', value: 'true', type: 'boolean', description: 'Include version in non-admin API responses' },
    { key: 'response_include_ads', value: 'true', type: 'boolean', description: 'Include ads in non-admin API responses' },
    { key: 'response_include_tips', value: 'false', type: 'boolean', description: 'Include tips in non-admin API responses' }
  ];

  for (const setting of defaults) {
    try {
      const existing = await Vault.getSystemSetting(env, setting.key);
      if (!existing) {
        await Vault.setSystemSetting(env, setting.key, setting.value, setting.type, setting.description);
      }
    } catch (e) {
      console.warn(`Failed to initialize setting ${setting.key}:`, e.message);
    }
  }
}

/** Run the D1 initialization sequence. */
export async function initializeAll(env) {
  const database = await initializeDatabase(env);
  const results = {
    timestamp: new Date().toISOString(),
    database
  };

  const allSuccess = Object.values(results)
    .filter(r => typeof r === 'object' && !Array.isArray(r))
    .every(r => r.success !== false);

  results.all_success = allSuccess;
  results.status = allSuccess ? 'ready' : 'partial';

  return results;
}

/**
 * Health check - verify all systems are initialized
 * @param {Object} env - Cloudflare environment
 * @returns {Promise<Object>} Health status
 */
export async function getInitializationStatus(env) {
  const status = {
    timestamp: new Date().toISOString(),
    database: !!env?.capi_db
  };

  // Try to get a value from each service
  if (status.database) {
    try {
      const DB = env.capi_db;
      const result = await DB.prepare('SELECT 1 as test').first();
      status.database_healthy = result !== undefined;
    } catch (e) {
      status.database_healthy = false;
      status.database_error = e.message;
    }
  }

  status.ready = status.database_healthy === true;

  return status;
}
