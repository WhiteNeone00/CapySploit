// Shared utility functions used across multiple modules
// Extract duplicated and common functions here for DRY principle
import { getPayloadMethods } from '../payload.js';
import { PAGINATION_CONFIG, API_CONFIG, RATE_LIMIT_CONFIG, FAILED_AUTH_CONFIG, TIMEOUT_CONFIG, CACHE_CONFIG, CONCURRENCY_CONFIG, DEFAULT_PLANS, DEFAULT_METHODS, LOOKUP_SERVICES, APP_DEFAULTS } from './config.js';

// ==================== DB-FIRST CONFIGURATION PATTERN ====================
// All settings check database (system_settings) first, then fall back to config.js
// This allows dynamic configuration without code changes

/**
 * Get a setting from database with fallback to config.js
 * @param {Object} env - Cloudflare environment
 * @param {string} key - Setting key (e.g., 'maintenance_mode', 'max_concurrent_attacks')
 * @param {*} configFallback - Value from config.js to use if DB setting not found
 * @returns {Promise<*>} Setting value from DB or config.js
 */
export async function getSetting(env, key, configFallback = null) {
  try {
    // Check cache first
    const cacheKey = `setting:${key}`;
    const cached = systemSettingsCache.get(cacheKey);
    if (cached !== null && cached !== undefined) return cached;
    
    // Then check database
    const DB = env && (env.capi_db || env.CAPI_DB || env.DB);
    if (DB) {
      const res = await DB.prepare('SELECT value FROM system_settings WHERE key = ?').bind(key).all();
      if (res.results && res.results.length > 0) {
        const value = res.results[0].value;
        systemSettingsCache.set(cacheKey, value, CACHE_CONFIG.SETTINGS_TTL_MS || 300000);
        return value;
      }
    }
  } catch (err) {
    console.error(`Failed to get setting ${key} from DB:`, err);
  }
  
  // Fall back to config.js value
  return configFallback;
}

/**
 * Get all plans from database with fallback to config defaults
 * @param {Object} env - Cloudflare environment
 * @returns {Promise<Array>} Array of plans with DB values preferred
 */
export async function getPlans(env) {
  try {
    const cacheKey = 'plans:all';
    const cached = systemSettingsCache.get(cacheKey);
    if (cached) return cached;
    
    const DB = env && (env.capi_db || env.CAPI_DB || env.DB);
    if (DB) {
      const res = await DB.prepare('SELECT * FROM plans ORDER BY name ASC').all();
      if (res.results && res.results.length > 0) {
        systemSettingsCache.set(cacheKey, res.results, CACHE_CONFIG.PLANS_TTL_MS || 600000);
        return res.results;
      }
    }
  } catch (err) {
    console.error('Failed to fetch plans from DB:', err);
  }
  
  // Fall back to config defaults
  return DEFAULT_PLANS || [];
}

/**
 * Get all methods from database with fallback to config defaults
 * @param {Object} env - Cloudflare environment
 * @returns {Promise<Array>} Array of methods with DB values preferred
 */
export async function getMethods(env) {
  try {
    const cacheKey = 'methods:all';
    const cached = methodCache.get(cacheKey);
    if (cached) return cached;
    
    const DB = env && (env.capi_db || env.CAPI_DB || env.DB);
    if (DB) {
      const res = await DB.prepare('SELECT id, name, description, enabled, default_access, vip, reseller, admin, max_slots, max_concurrents, default_port, max_time, raw_access, star_access, botnet_access, private_access, target_type, created_at, updated_at FROM methods ORDER BY name ASC').all();
      if (res.results && res.results.length > 0) {
        methodCache.set(cacheKey, res.results, CACHE_CONFIG.METHODS_TTL_MS || 600000);
        return res.results;
      }
    }
  } catch (err) {
    console.error('Failed to fetch methods from DB:', err);
  }

  // Sync/runtime source of truth is payload.js; keep config constants as final fallback only.
  const payloadMethods = getPayloadMethods();
  if (Array.isArray(payloadMethods) && payloadMethods.length > 0) {
    methodCache.set('methods:all', payloadMethods, CACHE_CONFIG.METHODS_TTL_MS || 600000);
    return payloadMethods;
  }
  
  return DEFAULT_METHODS || [];
}

/**
 * Invalidate all cached settings when updated
 */
export function invalidateSettingsCache() {
  systemSettingsCache.clear();
  methodCache.clear();
}

// ==================== IN-MEMORY CACHE LAYER ====================
// Lightweight cache with TTL support for frequently accessed data
// Reduces repeated D1 database queries for hot reads

class CacheEntry {
  constructor(value, ttlMs) {
    this.value = value;
    this.expiresAt = Date.now() + ttlMs;
  }
  
  isExpired() {
    return Date.now() > this.expiresAt;
  }
}

class CacheStore {
  constructor() {
    this.data = new Map();
  }
  
  get(key) {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.isExpired()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }
  
  set(key, value, ttlMs = CACHE_CONFIG.DEFAULT_TTL_MS) {
    this.data.set(key, new CacheEntry(value, ttlMs));
  }
  
  delete(key) {
    this.data.delete(key);
  }
  
  clear() {
    this.data.clear();
  }
  
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.data.entries()) {
      if (entry.isExpired()) {
        this.data.delete(key);
      }
    }
  }
  
  size() {
    return this.data.size;
  }
}

// Initialize cache stores for different data types
const userCache = new CacheStore();
const methodCache = new CacheStore();
const systemSettingsCache = new CacheStore();
const lookupIpCache = new CacheStore();

export async function lookupIpInfo(ipOrHost) {
  const target = String(ipOrHost || '').trim();
  if (!target) return null;
  const cached = lookupIpCache.get(target);
  if (cached) return cached;

  const templates = LOOKUP_SERVICES.IP_LOOKUP_URLS?.length
    ? LOOKUP_SERVICES.IP_LOOKUP_URLS
    : [APP_DEFAULTS.IP_LOOKUP_FALLBACK_URL];
  const results = await Promise.allSettled(templates.map(async (template) => {
    const response = await fetch(template.replace('{target}', encodeURIComponent(target)), {
      signal: AbortSignal.timeout(TIMEOUT_CONFIG.EXTERNAL_LOOKUP_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.status === 'success' ? data : null;
  }));
  const result = results.find((entry) => entry.status === 'fulfilled' && entry.value)?.value || null;
  if (result) lookupIpCache.set(target, result, CACHE_CONFIG.DEFAULT_TTL_MS);
  return result;
}

/**
 * Get cached user metadata
 * @param {string} username - Username to fetch
 * @param {Function} fetchFn - Function to call if not cached
 * @returns {Promise<Object>} User object
 */
export async function getCachedUser(username, fetchFn) {
  const cacheKey = `user:${username}`;
  const cached = userCache.get(cacheKey);
  if (cached) return cached;
  
  const user = await fetchFn(username);
  if (user) {
    userCache.set(cacheKey, user, CACHE_CONFIG.USER_TTL_MS);
  }
  return user;
}

/**
 * Invalidate cached user
 * @param {string} username - Username to invalidate
 */
export function invalidateUserCache(username) {
  userCache.delete(`user:${username}`);
}

/**
 * Get cached method list
 * @param {Function} fetchFn - Function to call if not cached
 * @returns {Promise<Array>} Array of methods
 */
export async function getCachedMethods(fetchFn) {
  const cacheKey = 'methods:all';
  const cached = methodCache.get(cacheKey);
  if (cached) return cached;
  
  const methods = await fetchFn();
  if (methods) {
    methodCache.set(cacheKey, methods, CACHE_CONFIG.METHODS_TTL_MS);
  }
  return methods;
}

/**
 * Invalidate method cache
 */
export function invalidateMethodCache() {
  methodCache.clear();
}

/**
 * Get cached method metadata map
 * Creates a Map once and reuses it, with TTL invalidation
 * @param {Function} fetchFn - Function to call if cache miss
 * @returns {Promise<Map>} Map of method_name -> metadata
 */
export async function getCachedMethodMap(fetchFn) {
  const cacheKey = 'methods:map';
  let cached = methodCache.get(cacheKey);
  if (cached) return cached;
  
  const methods = await fetchFn();
  if (methods && Array.isArray(methods)) {
    const methodMap = new Map(
      (methods || []).map((item) => [String(item?.name || '').toLowerCase(), item])
    );
    methodCache.set(cacheKey, methodMap, CACHE_CONFIG.METHODS_TTL_MS);
    return methodMap;
  }
  return new Map();
}

/**
 * Get cached system setting
 * @param {string} key - Setting key
 * @param {Function} fetchFn - Function to call if not cached
 * @returns {Promise<any>} Setting value
 */
export async function getCachedSystemSetting(key, fetchFn) {
  const cacheKey = `setting:${key}`;
  const cached = systemSettingsCache.get(cacheKey);
  if (cached !== null) return cached;
  
  const value = await fetchFn(key);
  if (value !== null) {
    systemSettingsCache.set(cacheKey, value, CACHE_CONFIG.SETTINGS_TTL_MS);
  }
  return value;
}

/**
 * Invalidate system setting cache
 * @param {string} key - Setting key to invalidate (or null to clear all)
 */
export function invalidateSystemSettingCache(key = null) {
  if (key === null) {
    systemSettingsCache.clear();
  } else {
    systemSettingsCache.delete(`setting:${key}`);
  }
}

/**
 * Cleanup expired cache entries (run periodically)
 */
export function cleanupCacheStores() {
  userCache.cleanup();
  methodCache.cleanup();
  systemSettingsCache.cleanup();
}

// ==================== FAILED AUTH ATTEMPT TRACKING ====================
// In-memory store for tracking failed authentication attempts
// Format: { username: [{ timestamp, attempts }, ...] }
const failedAuthAttempts = new Map();

/**
 * Track a failed authentication attempt for a user
 * @param {string} username - Username that failed auth
 * @returns {number} Total failed attempts in current window
 */
export function trackFailedAuthAttempt(username) {
  if (!FAILED_AUTH_CONFIG.ENABLED) return 0;
  
  const now = Date.now();
  const windowStart = now - FAILED_AUTH_CONFIG.ATTEMPT_WINDOW_MS;
  
  if (!failedAuthAttempts.has(username)) {
    failedAuthAttempts.set(username, []);
  }
  
  const attempts = failedAuthAttempts.get(username);
  
  // Remove old attempts outside the window
  const validAttempts = attempts.filter(t => t > windowStart);
  validAttempts.push(now);
  failedAuthAttempts.set(username, validAttempts);
  
  return validAttempts.length;
}

/**
 * Get current failed authentication attempt count
 * @param {string} username - Username to check
 * @returns {Object} { attempts: number, limit: number, isLocked: boolean }
 */
export function getFailedAuthAttempts(username) {
  if (!FAILED_AUTH_CONFIG.ENABLED) {
    return { attempts: 0, limit: FAILED_AUTH_CONFIG.MAX_ATTEMPTS, isLocked: false };
  }

  const now = Date.now();
  const attemptWindowStart = now - FAILED_AUTH_CONFIG.ATTEMPT_WINDOW_MS;
  const lockoutWindowStart = now - FAILED_AUTH_CONFIG.LOCKOUT_WINDOW_MS;
  const attempts = failedAuthAttempts.get(username) || [];

  const recentAttempts = attempts.filter(t => t > attemptWindowStart);
  const lockoutAttempts = attempts.filter(t => t > lockoutWindowStart);
  const isLocked = lockoutAttempts.length >= FAILED_AUTH_CONFIG.MAX_ATTEMPTS;

  return {
    attempts: recentAttempts.length,
    limit: FAILED_AUTH_CONFIG.MAX_ATTEMPTS,
    isLocked,
    nextAttemptAvailable: isLocked
      ? Math.max(0, Math.ceil((lockoutAttempts[0] + FAILED_AUTH_CONFIG.LOCKOUT_WINDOW_MS - now) / 1000))
      : 0
  };
}

/**
 * Clear failed auth attempts after successful authentication
 * @param {string} username - Username to clear
 */
export function clearFailedAuthAttempts(username) {
  failedAuthAttempts.delete(username);
}

/**
 * Clean up expired auth attempts (run periodically)
 */
export function cleanupExpiredAuthAttempts() {
  const now = Date.now();
  const windowStart = now - FAILED_AUTH_CONFIG.ATTEMPT_WINDOW_MS;
  
  for (const [username, attempts] of failedAuthAttempts.entries()) {
    const validAttempts = attempts.filter(t => t > windowStart);
    if (validAttempts.length === 0) {
      failedAuthAttempts.delete(username);
    } else {
      failedAuthAttempts.set(username, validAttempts);
    }
  }
}

// ==================== TIMEOUT & DURATION TRACKING ====================

/**
 * Track request duration for monitoring and timeout warnings
 * @param {string} requestId - Unique request identifier
 * @param {number} startTime - Request start time (Date.now())
 * @returns {Object} Duration info: { elapsed: ms, remaining: ms, isWarning: bool, percentage: number }
 */
export function getRequestDuration(requestId, startTime, maxDurationMs = TIMEOUT_CONFIG.DEFAULT_TIMEOUT_MS) {
  const now = Date.now();
  const elapsed = now - startTime;
  const remaining = Math.max(0, maxDurationMs - elapsed);
  const percentage = Math.round((elapsed / maxDurationMs) * 100);
  const isWarning = elapsed > TIMEOUT_CONFIG.WARNING_THRESHOLD_MS;
  
  return {
    elapsed,
    remaining,
    isWarning,
    percentage,
    exceeded: elapsed > maxDurationMs
  };
}

/**
 * Wrap a promise with a timeout
 * Rejects if operation exceeds timeout duration
 * @param {Promise} promise - Promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} label - Operation label for error message
 * @returns {Promise} Original promise or timeout error
 * @throws {Error} Timeout error if promise exceeds duration
 * @example
 *   const result = await withTimeout(
 *     fetch('https://api.example.com/data'),
 *     5000,
 *     'fetch external API'
 *   );
 */
export async function withTimeout(promise, timeoutMs, label = 'Operation') {
  if (!TIMEOUT_CONFIG.ENABLED || !timeoutMs) return promise;
  
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    )
  ]);
}

/**
 * Format a visual slot bar representation with percentage
 * Used by API and Discord bot for displaying resource usage
 * @param {number} used - Slots used
 * @param {number} total - Total slots available
 * @returns {string} Formatted bar like "🔵🔵⬜⬜⬜ (20.00%)"
 */
export function formatSlotBar(used, total) {
  const filled = total > 0 ? Math.round(Math.min(total, used) * 10 / total) : 0;
  const empty = 10 - filled;
  const percent = total === 0 ? 0 : (used / total) * 100;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} (${percent.toFixed(2)}%)`;
}

/**
 * Sanitize user object for responses
 * Removes sensitive fields like passwords before sending to client
 * @param {Object} user - User object from database
 * @returns {Object} Sanitized user object safe to return
 */
export function sanitizeUserForResponse(user) {
  if (!user) return null;
  const sanitized = { ...user };
  // Remove sensitive fields
  delete sanitized.password;
  delete sanitized.suspend_reason;
  delete sanitized.suspended_by;
  return sanitized;
}

/**
 * Sanitize array of users for responses
 * @param {Array} users - Array of user objects
 * @returns {Array} Array of sanitized users
 */
export function sanitizeUsersForResponse(users) {
  return (users || []).map(u => sanitizeUserForResponse(u));
}

export function getClientIp(request) {
  return request?.headers?.get?.('cf-connecting-ip') || request?.headers?.get?.('x-forwarded-for') || 'unknown';
}

export function isUserIpAllowed(user, clientIp) {
  const whitelist = String(user?.whitelisted_ip || '').trim();
  return !whitelist || whitelist === String(clientIp || '').trim();
}

/**
 * Validate pagination parameters
 * @param {number} limit - Items per page
 * @param {number} offset - Starting position
 * @returns {Object} { limit: validated_limit, offset: validated_offset }
 */
export function validatePaginationParams(limit, offset) {
  const maxLimit = PAGINATION_CONFIG.MAX_LIMIT;
  const minLimit = PAGINATION_CONFIG.MIN_LIMIT;
  const minOffset = PAGINATION_CONFIG.MIN_OFFSET;
  
  let validLimit = parseInt(limit, 10) || PAGINATION_CONFIG.DEFAULT_LIMIT;
  let validOffset = parseInt(offset, 10) || 0;
  
  validLimit = Math.max(minLimit, Math.min(maxLimit, validLimit));
  validOffset = Math.max(minOffset, validOffset);
  
  return { limit: validLimit, offset: validOffset };
}

/**
 * Apply pagination to array
 * @param {Array} array - Array to paginate
 * @param {number} limit - Items per page
 * @param {number} offset - Starting position
 * @returns {Object} { items: paginated_array, total: total_count, limit, offset, page: current_page, pages: total_pages }
 */
export function paginate(array, limit, offset) {
  const { limit: validLimit, offset: validOffset } = validatePaginationParams(limit, offset);
  const total = array.length;
  const items = array.slice(validOffset, validOffset + validLimit);
  const totalPages = Math.ceil(total / validLimit);
  const currentPage = Math.floor(validOffset / validLimit) + 1;
  
  return {
    items,
    total,
    limit: validLimit,
    offset: validOffset,
    page: currentPage,
    pages: totalPages,
    has_next: currentPage < totalPages,
    has_prev: currentPage > 1
  };
}

/**
 * Format uptime in human-readable format
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted like "2h 34m 12s"
 */
export function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  
  return parts.join(' ');
}

/**
 * Check if value is a valid positive integer
 * @param {any} value - Value to check
 * @param {number} min - Minimum value (default 0)
 * @param {number} max - Maximum value (default unlimited)
 * @returns {boolean} True if valid
 */
export function isValidPositiveInt(value, min = 0, max = Infinity) {
  const num = Number(value);
  return Number.isInteger(num) && num >= min && num <= max;
}

/**
 * Check user cooldown using the user.last_request_time timestamp.
 * Supports plan-specific cooldown values and bypass_anti_spam skips.
 * @param {string|null} lastRequestTime - ISO timestamp or null
 * @param {number} cooldownSeconds - Seconds the user must wait between attacks
 * @param {boolean} bypassEnabled - Whether this user should bypass cooldown
 * @returns {{ allowed: boolean, secondsUntilAvailable: number }}
 */
export function checkUserCooldown(lastRequestTime, cooldownSeconds = 10, bypassEnabled = false) {
  if (bypassEnabled) {
    return { allowed: true, secondsUntilAvailable: 0 };
  }

  const seconds = Number(cooldownSeconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { allowed: true, secondsUntilAvailable: 0 };
  }

  if (!lastRequestTime) {
    return { allowed: true, secondsUntilAvailable: 0 };
  }

  const lastMs = new Date(lastRequestTime).getTime();
  if (!Number.isFinite(lastMs)) {
    return { allowed: true, secondsUntilAvailable: 0 };
  }

  const elapsedMs = Date.now() - lastMs;
  const minMs = seconds * 1000;
  const allowed = elapsedMs >= minMs;

  return {
    allowed,
    secondsUntilAvailable: allowed ? 0 : Math.ceil((minMs - elapsedMs) / 1000)
  };
}

/**
 * Check API rate limit (3-second minimum between requests)
 * Prevents rapid F5 spam and abuse
 * @param {string} identifier - User identifier (username or IP)
 * @param {number} minSeconds - Minimum seconds between requests (default 3)
 * @returns {Object} { allowed: boolean, secondsUntilAvailable: number }
 */
/**
 * Check if a request is within rate limit - core rate limiter function
 * Uses in-memory Map storage (checkApiRateLimit.store) that persists per worker instance
 * Prevents spam/abuse by enforcing minimum time between consecutive requests
 * @param {string} identifier - Unique identifier (username, IP, session ID, etc)
 * @param {number} minSeconds - Minimum seconds required between requests (default 3)
 * @returns {Object} {allowed: boolean, secondsUntilAvailable: number}
 * @example
 *   const check = checkApiRateLimit('user123', 1);
 *   if (!check.allowed) return error(`Too fast. Wait ${check.secondsUntilAvailable}s`);
 */
export function checkApiRateLimit(identifier, minSeconds = 3) {
  if (!checkApiRateLimit.store) {
    checkApiRateLimit.store = new Map();
  }
  
  const now = Date.now();
  const minMs = minSeconds * 1000;
  const lastRequest = checkApiRateLimit.store.get(identifier) || 0;
  const elapsed = now - lastRequest;
  const allowed = elapsed >= minMs;
  
  // Update last request time if allowed
  if (allowed) {
    checkApiRateLimit.store.set(identifier, now);
  }
  
  return {
    allowed,
    secondsUntilAvailable: allowed ? 0 : Math.ceil((minMs - elapsed) / 1000)
  };
}

/**
 * Apply global rate limiting with bypass support
 * Users with bypass_anti_spam=true skip all rate limiting (for VIP/trusted accounts)
 * @param {string} identifier - Unique ID (username, IP, etc)
 * @param {boolean} bypassEnabled - Whether user has bypass_anti_spam enabled (1/true skips limiting)
 * @param {number} cooldownSeconds - Rate limit cooldown in seconds (default 1)
 * @returns {Object} {allowed: boolean, secondsUntilAvailable: number}
 * @example
 *   const check = applyGlobalRateLimit(`user:${username}`, user.bypass_anti_spam, 1);
 *   if (!check.allowed) return error(429, `Rate limited. Try again in ${check.secondsUntilAvailable}s`);
 */
export function applyGlobalRateLimit(identifier, bypassEnabled = false, cooldownSeconds = 1) {
  // Skip rate limit if user has bypass_anti_spam enabled (VIP/admin feature)
  if (bypassEnabled) {
    return { allowed: true, secondsUntilAvailable: 0 };
  }
  return checkApiRateLimit(identifier, cooldownSeconds);
}

/**
 * Generate unique attack ID
 * Uses timestamp + random component for uniqueness
 * @returns {number} Unique attack ID
 */
export function generateAttackId() {
  // Combine timestamp (ms) with random component for uniqueness
  const timestamp = Date.now() % 1000000; // Keep last 6 digits of timestamp
  const random = Math.floor(Math.random() * 100000); // 5-digit random
  return parseInt(`${timestamp}${String(random).padStart(5, '0')}`, 10);
}

// ==================== CONCURRENCY LIMITS & SEMAPHORE ====================
// Manages concurrent attack processing and HTTP request limits

class Semaphore {
  constructor(maxConcurrent = 50) {
    this.maxConcurrent = maxConcurrent;
    this.current = 0;
    this.waiting = [];
    this.lastCleanup = Date.now();
  }
  
  async acquire(timeout = 30000) {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return true;
    }
    
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Remove from queue on timeout
        const idx = this.waiting.indexOf(resolve);
        if (idx >= 0) this.waiting.splice(idx, 1);
        resolve(false); // Indicate timeout
      }, timeout);
      
      this.waiting.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
  
  release() {
    if (this.current > 0) this.current--;
    const resolve = this.waiting.shift();
    if (resolve) {
      this.current++;
      resolve();
    }
  }
  
  available() {
    return Math.max(0, this.maxConcurrent - this.current);
  }
  
  capacity() {
    return {
      current: this.current,
      max: this.maxConcurrent,
      available: this.available(),
      utilization: (this.current / this.maxConcurrent) * 100
    };
  }
}

// Global semaphores for concurrency control
const globalAttackSemaphore = new Semaphore(CONCURRENCY_CONFIG.MAX_CONCURRENT_ATTACKS);
const outgoingRequestSemaphore = new Semaphore(CONCURRENCY_CONFIG.MAX_OUTGOING_REQUESTS);
const userConcurrencyLimits = new Map(); // Tracks per-user concurrent attacks

/**
 * Get or create semaphore for a user
 * @param {string} username - Username
 * @returns {Semaphore} Semaphore for this user
 */
function getUserSemaphore(username) {
  if (!userConcurrencyLimits.has(username)) {
    userConcurrencyLimits.set(
      username,
      new Semaphore(CONCURRENCY_CONFIG.MAX_ATTACKS_PER_USER)
    );
  }
  return userConcurrencyLimits.get(username);
}

/**
 * Acquire concurrency slots for an attack launch
 * Checks both global and per-user limits
 * @param {string} username - Username launching attack
 * @param {number} slotsNeeded - Number of concurrency slots needed
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} { acquired: boolean, global: capacity, user: capacity, backpressure: boolean }
 */
export async function acquireAttackSlots(username, slotsNeeded = 1, timeout = 10000) {
  const globalCapacity = globalAttackSemaphore.capacity();
  const userSem = getUserSemaphore(username);
  const userCapacity = userSem.capacity();
  
  // Check if we're at backpressure threshold
  const globalBackpressure = globalCapacity.utilization > (CONCURRENCY_CONFIG.BACKPRESSURE_THRESHOLD * 100);
  const userBackpressure = userCapacity.utilization > (CONCURRENCY_CONFIG.BACKPRESSURE_THRESHOLD * 100);
  
  // Try to acquire slots
  const globalAcquired = await globalAttackSemaphore.acquire(timeout);
  if (!globalAcquired) {
    return {
      acquired: false,
      reason: 'global_limit_reached',
      global: globalCapacity,
      user: userCapacity,
      backpressure: globalBackpressure,
      hint: 'System is at capacity. Please retry shortly.'
    };
  }
  
  const userAcquired = await userSem.acquire(timeout);
  if (!userAcquired) {
    globalAttackSemaphore.release();
    return {
      acquired: false,
      reason: 'user_limit_reached',
      global: globalCapacity,
      user: userCapacity,
      backpressure: userBackpressure,
      hint: 'You have reached your concurrent attack limit.'
    };
  }
  
  return {
    acquired: true,
    reason: 'success',
    global: globalCapacity,
    user: userCapacity,
    backpressure: globalBackpressure || userBackpressure,
    hint: null
  };
}

/**
 * Release concurrency slots after attack completes
 * @param {string} username - Username who launched attack
 */
export function releaseAttackSlots(username) {
  globalAttackSemaphore.release();
  const userSem = getUserSemaphore(username);
  userSem.release();
}

/**
 * Acquire slot for an outgoing HTTP request
 * Prevents overwhelming external services
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} True if slot acquired
 */
export async function acquireOutgoingRequestSlot(timeout = 5000) {
  return outgoingRequestSemaphore.acquire(timeout);
}

/**
 * Release slot for an outgoing HTTP request
 */
export function releaseOutgoingRequestSlot() {
  outgoingRequestSemaphore.release();
}

/**
 * Get current concurrency capacity info
 * @returns {Object} Capacity info for monitoring
 */
export function getConcurrencyStatus() {
  return {
    global_attacks: globalAttackSemaphore.capacity(),
    outgoing_requests: outgoingRequestSemaphore.capacity(),
    active_users: userConcurrencyLimits.size
  };
}



