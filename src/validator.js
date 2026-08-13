// Security and validation middleware for CAPI
import { VALIDATION, HTTP_CODES } from './config.js';

/**
 * Validate username format and length
 * @param {string} username - Username to validate
 * @returns {Object} {valid: boolean, error: string}
 */
export function validateUsername(username) {
  const str = String(username || '').trim();
  if (!str) return { valid: false, error: 'Username is required' };
  if (str.length < VALIDATION.USERNAME_MIN_LENGTH) {
    return { valid: false, error: `Username must be at least ${VALIDATION.USERNAME_MIN_LENGTH} characters` };
  }
  if (str.length > VALIDATION.USERNAME_MAX_LENGTH) {
    return { valid: false, error: `Username must be at most ${VALIDATION.USERNAME_MAX_LENGTH} characters` };
  }
  // Allow alphanumeric, underscore, dash
  if (!/^[a-zA-Z0-9_-]+$/.test(str)) {
    return { valid: false, error: 'Username can only contain letters, numbers, underscore, and dash' };
  }
  return { valid: true, error: null };
}

/**
 * Validate target (IP, domain, or URL)
 * @param {string} target - Target to validate
 * @returns {Object} {valid: boolean, error: string}
 */
export function validateTarget(target) {
  const str = String(target || '').trim();
  if (!str) return { valid: false, error: 'Target is required' };
  if (str.length < VALIDATION.TARGET_MIN_LENGTH) {
    return { valid: false, error: `Target must be at least ${VALIDATION.TARGET_MIN_LENGTH} character` };
  }
  if (str.length > VALIDATION.TARGET_MAX_LENGTH) {
    return { valid: false, error: `Target must be at most ${VALIDATION.TARGET_MAX_LENGTH} characters` };
  }
  // Basic check: looks like IP, domain, or URL
  const isValidTarget = VALIDATION.IPV4_PATTERN.test(str) ||
    VALIDATION.DOMAIN_PATTERN.test(str) ||
    str.startsWith('http://') ||
    str.startsWith('https://');
  if (!isValidTarget) {
    return { valid: false, error: 'Invalid target format (must be IP, domain, or URL)' };
  }
  return { valid: true, error: null };
}

/**
 * Validate port number
 * @param {number|string} port - Port to validate
 * @returns {Object} {valid: boolean, error: string, port: number}
 */
export function validatePort(port) {
  const num = parseInt(port, 10);
  if (isNaN(num)) return { valid: false, error: 'Port must be a number', port: null };
  if (num < 1 || num > 65535) {
    return { valid: false, error: 'Port must be between 1 and 65535', port: null };
  }
  return { valid: true, error: null, port: num };
}

/**
 * Validate duration/time in seconds
 * @param {number|string} duration - Duration to validate
 * @param {number} min - Minimum allowed duration
 * @param {number} max - Maximum allowed duration
 * @returns {Object} {valid: boolean, error: string, duration: number}
 */
export function validateDuration(duration, min = 1, max = 9999) {
  const num = parseInt(duration, 10);
  if (isNaN(num)) return { valid: false, error: 'Duration must be a number', duration: null };
  if (num < min) return { valid: false, error: `Duration must be at least ${min} seconds`, duration: null };
  if (num > max) return { valid: false, error: `Duration must be at most ${max} seconds`, duration: null };
  return { valid: true, error: null, duration: num };
}

/**
 * Validate method name
 * @param {string} method - Method name to validate
 * @returns {Object} {valid: boolean, error: string}
 */
export function validateMethod(method) {
  const str = String(method || '').trim().toLowerCase();
  if (!str) return { valid: false, error: 'Method is required' };
  if (!/^[a-z0-9\-_]+$/.test(str)) {
    return { valid: false, error: 'Method name contains invalid characters' };
  }
  return { valid: true, error: null };
}

/**
 * Validate payload length
 * Fast version that returns just the number (used in api.js hot path)
 * @param {number|string} length - Payload length value
 * @returns {number} Validated length clamped to valid range
 */
export function validatePayloadLength(length) {
  const num = parseInt(length, 10);
  if (Number.isNaN(num) || num < 1) return 72; // Default
  if (num > 65535) return 65535; // Max reasonable payload
  return num;
}

/**
 * Check if value is a valid IPv4 address
 * @param {string} value - IP address to validate
 * @returns {boolean} True if valid IPv4
 */
export function isIPv4(value) {
  return typeof value === 'string' && /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/.test(value);
}

/**
 * Check if IP is in private/reserved ranges
 * @param {string} ip - IP address to check
 * @returns {boolean} True if private/reserved
 */
export function isPrivateIPRange(ip) {
  const privateRanges = [
    /^127\./, // Loopback
    /^10\./, // Private class A
    /^172\.(1[6-9]|2\d|3[01])\./, // Private class B
    /^192\.168\./, // Private class C
    /^169\.254\./, // Link-local
    /^224\./, // Multicast
    /^255\./, // Broadcast
    /^0\./ // Current network
  ];
  return privateRanges.some(range => range.test(ip));
}

/**
 * Check if domain is reserved/internal
 * @param {string} domain - Domain to check
 * @returns {boolean} True if reserved
 */
export function isReservedDomain(domain) {
  const normalizedDomain = domain.toLowerCase().trim();
  const reservedDomains = [
    'localhost',
    '.localhost',
    '.local',
    '.test',
    '.invalid',
    '.example',
    '.internal',
    '0.0.0.0',
    '255.255.255.255'
  ];
  return reservedDomains.some(reserved => 
    normalizedDomain === reserved || 
    normalizedDomain.endsWith(reserved)
  );
}

/**
 * Check if target looks like a URL/domain
 * @param {string} value - Target to check
 * @returns {boolean} True if looks like URL
 */
export function isUrlTarget(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (isIPv4(value)) return false;
  if (value.includes(' ')) return false;
  return value.includes('.') || /^https?:\/\//i.test(value);
}

/**
 * Validate target is safe to attack
 * @param {string} target - Target to validate
 * @returns {boolean} True if valid and safe
 */
export function isValidTarget(target) {
  if (!target || typeof target !== 'string') return false;
  const trimmed = target.trim();
  if (!trimmed || trimmed.length === 0) return false;
  if (trimmed.length > 255) return false;
  if (trimmed.includes(' ') || trimmed.includes('\n') || trimmed.includes('\r')) return false;
  
  const isIP = isIPv4(trimmed);
  const isURL = isUrlTarget(trimmed);
  if (!isIP && !isURL) return false;
  
  if (isIP && isPrivateIPRange(trimmed)) return false;
  if (isURL && isReservedDomain(trimmed)) return false;
  
  return true;
}

/**
 * Normalize value for blacklist comparison
 * @param {any} value - Value to normalize
 * @returns {string} Normalized lowercase string
 */
export function normalizeBlacklistValue(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Check if target is in blacklist
 * @param {string} target - Target to check
 * @param {Array} blacklistEntries - Blacklist entries
 * @returns {boolean} True if blacklisted
 */
export function isBlacklistedTarget(target, blacklistEntries) {
  const normalizedTarget = normalizeBlacklistValue(target);
  if (!normalizedTarget) return false;

  return (blacklistEntries || []).some((entry) => {
    const normalizedEntry = normalizeBlacklistValue(entry);
    if (!normalizedEntry) return false;

    const isIpPrefix = /^((\d{1,3}\.){1,3}\d{1,3})\.?$/.test(normalizedEntry);
    if (isIpPrefix) {
      const prefix = normalizedEntry.endsWith('.') ? normalizedEntry : `${normalizedEntry}.`;
      return normalizedTarget === normalizedEntry || normalizedTarget.startsWith(prefix) || normalizedEntry.startsWith(normalizedTarget);
    }

    return normalizedTarget === normalizedEntry
      || normalizedTarget.startsWith(normalizedEntry)
      || normalizedTarget.includes(normalizedEntry)
      || (normalizedEntry.startsWith('.') && normalizedTarget.endsWith(normalizedEntry))
      || normalizedEntry.startsWith(normalizedTarget);
  });
}

/**
 * Check if IP is blacklisted by metadata (country, ASN, etc)
 * @param {Object} ipinfo - IP info object from lookup
 * @param {Object} payloadBlacklists - Blacklist configuration
 * @returns {boolean} True if blacklisted
 */
export function isBlacklistedByMetadata(ipinfo, payloadBlacklists) {
  const blacklists = payloadBlacklists || {};
  const asnNumbers = (blacklists.ASN_NUMBER || []).map(normalizeBlacklistValue).filter(Boolean);
  const asnNames = (blacklists.ASN_NAME || []).map(normalizeBlacklistValue).filter(Boolean);
  const countries = (blacklists.Countries || []).map(normalizeBlacklistValue).filter(Boolean);

  const asnValue = normalizeBlacklistValue(ipinfo?.as || ipinfo?.asn || '');
  const orgValue = normalizeBlacklistValue(ipinfo?.org || ipinfo?.isp || '');
  const countryValue = normalizeBlacklistValue(ipinfo?.country || ipinfo?.countryCode || '');

  if (asnNumbers.length && asnValue && asnNumbers.includes(asnValue)) return true;
  if (asnNames.length && orgValue && asnNames.includes(orgValue)) return true;
  if (countries.length && countryValue && countries.includes(countryValue)) return true;

  return false;
}

/**
 * Validate threads count
 * @param {number|string} threads - Thread count to validate
 * @returns {Object} {valid: boolean, error: string, threads: number}
 */
export function validateThreads(threads) {
  const num = parseInt(threads, 10);
  if (isNaN(num)) return { valid: false, error: 'Threads must be a number', threads: null };
  if (num < 1) return { valid: false, error: 'Threads must be at least 1', threads: null };
  if (num > 256) return { valid: false, error: 'Threads cannot exceed 256', threads: null };
  return { valid: true, error: null, threads: num };
}

/**
 * Validate RPS (requests per second)
 * @param {number|string} rps - RPS to validate
 * @returns {Object} {valid: boolean, error: string, rps: number}
 */
export function validateRPS(rps) {
  const num = parseInt(rps, 10);
  if (isNaN(num)) return { valid: false, error: 'RPS must be a number', rps: null };
  if (num < 1) return { valid: false, error: 'RPS must be at least 1', rps: null };
  if (num > 100000) return { valid: false, error: 'RPS cannot exceed 100000', rps: null };
  return { valid: true, error: null, rps: num };
}

/**
 * Validate request body size
 * @param {number} contentLength - Content-Length header value
 * @param {number} maxBytes - Maximum allowed size (default 1MB)
 * @returns {Object} {valid: boolean, error: string}
 */
export function validateRequestSize(contentLength, maxBytes = 1048576) {
  const size = parseInt(contentLength, 10);
  if (isNaN(size)) return { valid: true, error: null }; // If no content-length, allow
  if (size > maxBytes) {
    return {
      valid: false,
      error: `Request too large (${size} bytes). Maximum is ${maxBytes} bytes`,
      status: HTTP_CODES.TOO_MANY_REQUESTS
    };
  }
  return { valid: true, error: null };
}

/**
 * Sanitize string input to remove potential injection attempts
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized input
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/--/g, '-- ')             // Prevent SQL comments
    .substring(0, VALIDATION.TARGET_MAX_LENGTH); // Truncate to max length
}

/**
 * Check if error message reveals sensitive information
 * @param {Error} error - Error object to check
 * @returns {string} Safe error message
 */
export function sanitizeErrorMessage(error) {
  const message = String(error?.message || error || '').toLowerCase();

  // Don't expose database errors, file paths, etc.
  if (message.includes('sqlite') || message.includes('sql')) {
    return 'Database error occurred';
  }
  if (message.includes('eacces') || message.includes('enoent')) {
    return 'File system error occurred';
  }
  if (message.includes('econnrefused') || message.includes('econnreset')) {
    return 'Service connection error';
  }
  if (message.includes('timeout')) {
    return 'Operation timed out';
  }
  if (message.includes('memory')) {
    return 'Resource limit exceeded';
  }

  // Return safe generic message
  return 'Internal error occurred';
}

export default {
  validateUsername,
  validateTarget,
  validatePort,
  validateDuration,
  validateMethod,
  validatePayloadLength,
  validateThreads,
  validateRPS,
  validateRequestSize,
  sanitizeInput,
  sanitizeErrorMessage
};
