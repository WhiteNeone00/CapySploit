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
 * @param {number|string} length - Payload length to validate
 * @returns {Object} {valid: boolean, error: string, length: number}
 */
export function validatePayloadLength(length) {
  const num = parseInt(length, 10);
  if (isNaN(num)) return { valid: false, error: 'Payload length must be a number', length: null };
  if (num < 1) return { valid: false, error: 'Payload length must be at least 1 byte', length: null };
  if (num > VALIDATION.MAX_PAYLOAD_LENGTH) {
    return { valid: false, error: `Payload length must be at most ${VALIDATION.MAX_PAYLOAD_LENGTH} bytes`, length: null };
  }
  return { valid: true, error: null, length: num };
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
