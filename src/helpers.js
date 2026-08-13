// Shared utility functions used across multiple modules
// Extract duplicated and common functions here for DRY principle

/**
 * Fetch from primary URL, fallback to secondary if primary fails
 * Ensures API always works even if primary domain is temporarily down
 * @param {string} path - API path to request
 * @param {Array<string>} urlCandidates - Array of URLs to try [primary, secondary, ...]
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export async function fetchWithFallback(path, urlCandidates, options = {}) {
  // Filter out empty URLs
  const urls = (urlCandidates || []).filter(Boolean);
  if (urls.length === 0) throw new Error('No valid URLs provided');
  
  let lastError = null;
  for (const baseUrl of urls) {
    try {
      const fullUrl = `${baseUrl}${path}`;
      const response = await fetch(fullUrl, options);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      // Continue to next URL
    }
  }
  throw lastError || new Error('All fallback URLs failed');
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

/**
 * Validate pagination parameters
 * @param {number} limit - Items per page
 * @param {number} offset - Starting position
 * @returns {Object} { limit: validated_limit, offset: validated_offset }
 */
export function validatePaginationParams(limit, offset) {
  const maxLimit = 100; // Max 100 items per page
  const minLimit = 1;
  const minOffset = 0;
  
  let validLimit = parseInt(limit, 10) || 10; // Default 10
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

/**
 * Validate payload length parameter
 * @param {any} value - Length value from query
 * @returns {number} Validated length (default 72)
 */
export function validatePayloadLength(value) {
  const len = parseInt(value, 10);
  if (Number.isNaN(len) || len < 0) return 72; // Default
  if (len > 65535) return 65535; // Max reasonable payload
  return len;
}

/**
 * Standardized response data builder
 * Ensures consistent field ordering and structure across all responses
 * @param {Object} data - Data to structure
 * @param {string} type - Response type (user, attack, plan, stats, etc.)
 * @returns {Object} Standardized response data
 */
export function buildStructuredData(data, type = 'generic') {
  if (type === 'attack') {
    return {
      attack_id: data.attack_id,
      target: data.target,
      port: data.port,
      method: data.method,
      time_used: data.time_used,
      len: data.len,
      threads: data.threads,
      rps: data.rps,
      geo: data.geo,
      target_asn: data.target_asn,
      target_city: data.target_city,
      target_country: data.target_country,
      target_country_code: data.target_country_code,
      target_isp: data.target_isp,
      target_org: data.target_org,
      target_region: data.target_region,
      target_timezone: data.target_timezone,
      target_zip: data.target_zip,
      username: data.username,
      max_time: data.max_time,
      min_time: data.min_time,
      max_concurrents: data.max_concurrents,
      method_max_slots: data.method_max_slots,
      method_active_slots: data.method_active_slots,
      cooldown: data.cooldown,
      attacks_remaining: data.attacks_remaining,
      bypass_slots: data.bypass_slots,
      holder_status: data.holder_status,
      vip_status: data.vip_status,
      api_status: data.api_status,
      admin_status: data.admin_status,
      power_saving: data.power_saving,
      bypass_power: data.bypass_power,
      time_to_send: data.time_to_send
    };
  }
  
  if (type === 'user') {
    return {
      username: data.username,
      admin: data.admin,
      reseller: data.reseller,
      vip: data.vip,
      holder: data.holder,
      api_access: data.api_access,
      max_time: data.max_time,
      min_time: data.min_time,
      cooldown: data.cooldown,
      concurrents: data.concurrents,
      max_daily_attacks: data.max_daily_attacks,
      attacks_remaining: data.attacks_remaining,
      power_saving: data.power_saving,
      bypass_power: data.bypass_power,
      bypass_slots: data.bypass_slots,
      suspended: data.suspended,
      created_by: data.created_by,
      created_at: data.created_at,
      expiry_unix: data.expiry_unix,
      service_name: data.service_name
    };
  }
  
  if (type === 'plan') {
    return {
      username: data.username,
      admin: data.admin,
      reseller: data.reseller,
      vip: data.vip,
      holder: data.holder,
      api_access: data.api_access,
      max_time: data.max_time,
      min_time: data.min_time,
      cooldown: data.cooldown,
      concurrents: data.concurrents,
      max_daily_attacks: data.max_daily_attacks,
      attacks_remaining: data.attacks_remaining,
      power_saving: data.power_saving,
      bypass_power: data.bypass_power,
      bypass_slots: data.bypass_slots,
      method_max_slots: data.method_max_slots,
      suspended: data.suspended,
      created_by: data.created_by,
      plan_type: data.plan_type,
      rank: data.rank,
      discord_linked: data.discord_linked,
      warnings: data.warnings
    };
  }
  
  return data;
}

/**
 * Build standardized success message
 * @param {string} action - Action performed (created, updated, retrieved, etc.)
 * @param {string} entity - Entity type (user, attack, method, etc.)
 * @param {any} count - Number of items (optional)
 * @returns {string} Standardized message
 */
export function buildMessage(action, entity, count = null) {
  const messages = {
    created: `${entity} created successfully${count ? ` (${count} total)` : ''}.`,
    updated: `${entity} updated successfully.`,
    deleted: `${entity} deleted successfully.`,
    retrieved: `${entity} retrieved successfully${count ? ` (${count} found)` : ''}.`,
    listed: `${entity} list retrieved${count ? ` (${count} items)` : ''}.`,
    accepted: `${entity} accepted and processing.`,
    completed: `${entity} completed successfully.`,
    suspended: `${entity} has been suspended.`,
    resumed: `${entity} has been resumed.`,
    linked: `${entity} linked successfully.`,
    unlinked: `${entity} unlinked successfully.`,
    verified: `${entity} verified successfully.`,
    generated: `${entity} generated successfully.`,
    synced: `${entity} synchronized${count ? ` (${count} items)` : ''}.`,
    enabled: `${entity} enabled.`,
    disabled: `${entity} disabled.`
  };
  
  return messages[action] || `Operation completed for ${entity}.`;
}

/**
 * Auto-create missing entity in database
 * @param {string} type - Entity type (user, method, blacklist, etc.)
 * @param {Object} entity - Entity data
 * @param {Object} env - Environment/database
 * @returns {Promise<Object>} Created entity or existing
 */
export async function autoCreateIfMissing(type, entity, env) {
  if (type === 'method' && entity.name) {
    const Vault = await import('./vault-db.js');
    const existing = await Vault.listMethods(env);
    const found = existing?.find(m => (m.name || '').toLowerCase() === entity.name.toLowerCase());
    if (!found) {
      await Vault.addMethod(env, { 
        name: entity.name, 
        description: entity.description || `${entity.name} attack method` 
      });
      return { created: true, name: entity.name };
    }
    return { created: false, name: entity.name };
  }
  
  if (type === 'blacklist' && entity.target) {
    const Vault = await import('./vault-db.js');
    const existing = await Vault.listBlacklist(env);
    const found = existing?.find(b => b.target === entity.target);
    if (!found) {
      await Vault.addBlacklistTarget(env, entity.target, entity.reason || 'auto-added');
      return { created: true, target: entity.target };
    }
    return { created: false, target: entity.target };
  }
  
  return { created: false };
}

/**
 * Build metadata object for responses
 * @param {Object} options - Metadata options
 * @returns {Object} Metadata object
 */
export function buildMetadata(options = {}) {
  return {
    timestamp: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    version: '1.0.0',
    ...options
  };
}

