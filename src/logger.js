// Structured logging with request tracking
import { HTTP_CODES } from './config.js';

/**
 * Generate a unique request ID
 * @returns {string} Request ID in format: timestamp-random
 */
export function generateRequestId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `${timestamp}-${random}`;
}

/**
 * Structured logger for CAPI
 * Logs JSON format for easy parsing and audit trails
 */
export class StructuredLogger {
  constructor(requestId, path = '', method = '') {
    this.requestId = requestId;
    this.path = path;
    this.method = method;
    this.startTime = Date.now();
  }

  /**
   * Log info level message
   */
  info(action, data = {}) {
    const entry = {
      level: 'INFO',
      requestId: this.requestId,
      path: this.path,
      method: this.method,
      action,
      data,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - this.startTime
    };
    console.log(JSON.stringify(entry));
    return entry;
  }

  /**
   * Log warning level message
   */
  warn(action, data = {}) {
    const entry = {
      level: 'WARN',
      requestId: this.requestId,
      path: this.path,
      method: this.method,
      action,
      data,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - this.startTime
    };
    console.warn(JSON.stringify(entry));
    return entry;
  }

  /**
   * Log error level message (without exposing sensitive details)
   */
  error(action, error, data = {}) {
    const entry = {
      level: 'ERROR',
      requestId: this.requestId,
      path: this.path,
      method: this.method,
      action,
      error: error?.message || String(error),
      error_name: error?.name || 'Unknown',
      error_code: error?.code || null,
      data,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - this.startTime
    };
    console.error(JSON.stringify(entry));
    return entry;
  }

  /**
   * Log security event (suspicious activity)
   */
  security(action, severity = 'WARNING', data = {}) {
    const entry = {
      level: 'SECURITY',
      requestId: this.requestId,
      path: this.path,
      method: this.method,
      severity, // WARNING, ALERT, CRITICAL
      action,
      data,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - this.startTime
    };
    console.log(JSON.stringify(entry));
    return entry;
  }

  /**
   * Log authentication event
   */
  auth(action, username = null, success = true, data = {}) {
    const entry = {
      level: 'AUTH',
      requestId: this.requestId,
      path: this.path,
      method: this.method,
      action,
      username: username || 'anonymous',
      success,
      data,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - this.startTime
    };
    console.log(JSON.stringify(entry));
    return entry;
  }

  /**
   * Log performance metric
   */
  metric(name, value, unit = 'ms') {
    const entry = {
      level: 'METRIC',
      requestId: this.requestId,
      path: this.path,
      method: this.method,
      metric_name: name,
      metric_value: value,
      metric_unit: unit,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - this.startTime
    };
    console.log(JSON.stringify(entry));
    return entry;
  }

  /**
   * Log request completion with status
   */
  complete(statusCode = 200, data = {}) {
    const entry = {
      level: 'REQUEST',
      requestId: this.requestId,
      path: this.path,
      method: this.method,
      status_code: statusCode,
      status_text: HTTP_CODES[statusCode] || 'Unknown',
      data,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - this.startTime
    };
    console.log(JSON.stringify(entry));
    return entry;
  }
}

export default {
  generateRequestId,
  StructuredLogger
};
