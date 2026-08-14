/**
 * Auto-initialization module for CAPI
 * Handles first-time setup of:
 * - D1 database tables and seed data
 * - KV namespace configuration
 * - R2 bucket setup
 * - System defaults and configurations
 */

import * as Vault from './vault-db.js';

const INIT_FLAGS = {
  DB_INITIALIZED: 'capi:db:initialized',
  KV_INITIALIZED: 'capi:kv:initialized',
  SEED_DATA_LOADED: 'capi:seed:data:loaded'
};

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
      tables: ['plans', 'users', 'logs', 'methods', 'blacklist', 'ongoing_attacks', 'discord_links', 'system_settings']
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
    { key: 'maintenance_mode', value: 'false', type: 'boolean', description: 'Enable maintenance mode to disable non-admin access' },
    { key: 'rate_limit_enabled', value: 'true', type: 'boolean', description: 'Enable global rate limiting' },
    { key: 'max_concurrent_attacks', value: '50', type: 'number', description: 'Maximum concurrent attack threads globally' },
    { key: 'max_user_concurrent_attacks', value: '3', type: 'number', description: 'Maximum concurrent attack threads per user' },
    { key: 'cleanup_interval_hours', value: '1', type: 'number', description: 'How often to run cleanup tasks (hours)' },
    { key: 'audit_log_retention_days', value: '90', type: 'number', description: 'How long to keep audit logs (days)' },
    { key: 'default_user_plan', value: 'Default', type: 'string', description: 'Default plan assigned to new users' },
    { key: 'api_version', value: '1.0.0', type: 'string', description: 'Current API version' }
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

/**
 * Initialize KV namespace with default configuration
 * Creates cache structure for cross-worker state
 * @param {Object} CAPI_KV - Cloudflare KV namespace binding
 * @returns {Promise<Object>} Initialization result
 */
export async function initializeKV(CAPI_KV) {
  if (!CAPI_KV) {
    return { success: false, error: 'KV namespace not configured' };
  }

  try {
    const kvDefaults = {
      'config:cache:ttl': JSON.stringify({ user: 15000, methods: 300000, settings: 600000 }),
      'config:concurrency:limits': JSON.stringify({ global: 50, perUser: 3, outgoing: 100 }),
      'metrics:initialized_at': new Date().toISOString(),
      'cache:methods:list': JSON.stringify([]), // Pre-allocate methods cache
      'cache:settings': JSON.stringify({})  // Pre-allocate settings cache
    };

    // Set defaults only if not already present (safe multi-init)
    for (const [key, value] of Object.entries(kvDefaults)) {
      try {
        const existing = await CAPI_KV.get(key);
        if (!existing) {
          await CAPI_KV.put(key, value, { 
            expirationTtl: 86400 * 365 // 1 year for config keys
          });
        }
      } catch (e) {
        console.warn(`Failed to initialize KV key ${key}:`, e.message);
      }
    }

    return { 
      success: true, 
      message: 'KV namespace initialized',
      namespace: 'CAPI_KV',
      keys: Object.keys(kvDefaults)
    };
  } catch (error) {
    console.error('KV initialization failed:', error);
    return { 
      success: false, 
      error: error?.message || 'KV initialization failed'
    };
  }
}

/**
 * Initialize R2 bucket structure (creates metadata objects)
 * @param {Object} R2_BUCKET - R2 bucket binding
 * @param {string} bucketName - Name of R2 bucket
 * @returns {Promise<Object>} Initialization result
 */
export async function initializeR2Bucket(R2_BUCKET, bucketName = 'capi-assets') {
  if (!R2_BUCKET) {
    return { success: false, error: 'R2 bucket not configured' };
  }

  try {
    // Create marker objects for bucket organization
    const markers = [
      'metadata/.initialized',
      'cache/.keep',
      'uploads/.keep',
      'backups/.keep'
    ];

    for (const path of markers) {
      try {
        const existing = await R2_BUCKET.get(path);
        if (!existing) {
          await R2_BUCKET.put(path, JSON.stringify({ 
            created_at: new Date().toISOString(),
            purpose: path.split('/')[0]
          }), {
            httpMetadata: {
              contentType: 'application/json'
            },
            customMetadata: {
              initialized: 'true'
            }
          });
        }
      } catch (e) {
        console.warn(`Failed to create R2 marker ${path}:`, e.message);
      }
    }

    return {
      success: true,
      message: 'R2 bucket initialized',
      bucket: bucketName,
      paths: markers
    };
  } catch (error) {
    console.error('R2 initialization failed:', error);
    return {
      success: false,
      error: error?.message || 'R2 initialization failed'
    };
  }
}

/**
 * Run full initialization sequence (database + KV + R2)
 * Call once at worker startup or when needed
 * Safe to call multiple times - all operations are idempotent
 * @param {Object} env - Cloudflare environment bindings
 * @returns {Promise<Object>} Combined initialization results
 */
export async function initializeAll(env) {
  const results = {
    timestamp: new Date().toISOString(),
    database: await initializeDatabase(env),
    kv: await initializeKV(env.CAPI_KV),
    r2: await initializeR2Bucket(env.capi_assets),
    r2_user: await initializeR2Bucket(env.capi_user_assets, 'capi-user-assets')
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
    database: !!env?.capi_db,
    kv: !!env?.CAPI_KV,
    r2_assets: !!env?.capi_assets,
    r2_user_assets: !!env?.capi_user_assets
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

  if (status.kv) {
    try {
      const test = await env.CAPI_KV.get('_health_check');
      status.kv_healthy = true; // KV.get() doesn't throw on missing keys
    } catch (e) {
      status.kv_healthy = false;
      status.kv_error = e.message;
    }
  }

  status.ready = status.database_healthy && status.kv_healthy;

  return status;
}
