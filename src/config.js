// ========================================
// CAPI Configuration & Constants
// ========================================
// Centralized configuration file for all hardcoded values.
// Modify here to change API behavior globally without touching business logic.

// ==================== TIPS & ADVERTISEMENTS ====================
export const DEFAULT_TIPS = [
  'Double-check your target and method before sending the next request.',
  'A clean setup usually performs better than a rushed one.',
  'Keep your parameters tight and your timing consistent for smoother results.',
  'Review the route and action before retrying to avoid wasted attempts.'
];

export const DEFAULT_ADS = [
  'Premium ad space is available for $5/month — place your brand where real traffic lands.',
  'Want your product featured here? Reserve an ad slot for just $5/month and get noticed.',
  'Grow your brand with a polished ad slot here for only $5/month.',
  'This spot is open for sponsors — book it for $5/month and stand out.'
];

// ==================== PASSWORD GENERATION ====================
export const PASSWORD_CONFIG = {
  DEFAULT_LENGTH: 12,
  MIN_LENGTH: 8,
  UPPERCASE: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  LOWERCASE: 'abcdefghijklmnopqrstuvwxyz',
  NUMBERS: '0123456789',
  SYMBOLS: '!@#$%^&*()-_=+',
  REQUIREMENT: {
    minLength: 8,
    hasUppercase: true,
    hasLowercase: true,
    hasNumbers: true
  }
};

// ==================== RATE LIMITING ====================
export const RATE_LIMIT_CONFIG = {
  ENABLED: true,
  WINDOW_SECONDS: 3,        // Minimum 3 seconds between requests per user
  MAX_REQUESTS_PER_WINDOW: 1,
  PROTECTED_ENDPOINTS: [
    '/admin/add_user',
    '/admin/edit_user',
    '/admin/delete_user',
    '/admin/view_user_plan',
    '/admin/suspend_user',
    '/api/attack',
    '/api/stop',
    '/api/verify'
  ]
};

// ==================== PAGINATION ====================
export const PAGINATION_CONFIG = {
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
  MIN_OFFSET: 0
};

// ==================== ADMIN FIELD PROTECTION ====================
export const ADMIN_PROTECTED_FIELDS = [
  // These fields cannot be edited via API (only via direct DB or special endpoints)
  'admin',           // Prevents privilege escalation
  'password',        // Use dedicated change_password endpoint
  'reseller',        // Role escalation protection
  'vip',             // Plan escalation protection
  'holder',          // Plan escalation protection
  'suspended',       // Use dedicated suspend/unsuspend endpoints
  'suspended_by',    // Audit trail protection
  'suspend_reason'   // Audit trail protection
];

export const ADMIN_EDITABLE_FIELDS = [
  'max_time',
  'min_time',
  'cooldown',
  'max_concurrents',
  'max_daily_attacks',
  'bypass_anti_spam',
  'power_saving',
  'allowed_methods',
  'allowed_targets'
];

// ==================== DISCORD DEFAULTS ====================
export const DISCORD_DEFAULTS = {
  VERIFIED_ROLE_NAME: 'Verified',
  CUSTOMER_ROLE_NAME: 'Customer',
  VIP_ROLE_NAME: 'VIP',
  HOLDER_ROLE_NAME: 'Holder',
  RESELLER_ROLE_NAME: 'Reseller',
  ACCENT_COLOR: 0x3498DB,
  EMBED_COLOR: 0x3498DB,
  BUTTON_STYLE: 'PRIMARY',
  DEFAULT_METHOD_NAMES: ['udp', 'tcp', 'http', 'https', 'cf-bypass', 'http-raw', 'https-raw', 'slowloris', 'tcp-flood', 'udp-flood'],
  BAR_WIDTH: 20,
  CACHE_DURATION_MS: 300000  // 5 minutes
};

// ==================== API DEFAULTS ====================
export const API_CONFIG = {
  DEFAULT_PORT: null,
  DEFAULT_PAYLOAD_LENGTH: 72,
  MAX_PAYLOAD_LENGTH: 65535,
  MIN_PAYLOAD_LENGTH: 1,
  AVERAGE_EXECUTION_TIME_SECONDS: 45,
  SLOT_BAR_WIDTH: 10,
  SLOT_EMPTY_CHAR: '⬜',
  SLOT_FILLED_CHAR: '🔵'
};

// ==================== DATABASE & CLEANUP ====================
export const DATABASE_CONFIG = {
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,  // Run cleanup every 5 minutes
  LOG_RETENTION_DAYS: 30,              // Keep logs for 30 days
  TABLES: ['users', 'logs', 'ongoing_attacks', 'attack_queue', 'blacklist', 'discord_links', 'methods', 'ranks', 'plans', 'presets']
};

// ==================== LOOKUP SERVICES ====================
export const LOOKUP_SERVICES = {
  IP_LOOKUP_URLS: [
    'http://ip-api.com/json/{target}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query'
  ],
  MINECRAFT_LOOKUP_URLS: [
    'https://api.mcsrvstat.us/2/{target}',
    'https://api.mcstatus.io/v2/status/java/{target}'
  ],
  FIVEM_LOOKUP_URLS: [
    'https://servers-frontend.fivem.net/api/servers/single/{target}'
  ]
};

// ==================== VALIDATION PATTERNS ====================
export const VALIDATION = {
  IPV4_PATTERN: /^(\d{1,3}\.){3}\d{1,3}$/,
  DOMAIN_PATTERN: /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i,
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 32,
  TARGET_MIN_LENGTH: 1,
  TARGET_MAX_LENGTH: 255
};

// ==================== RESPONSE CODES ====================
export const HTTP_CODES = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500
};

// ==================== PRIVATE IP RANGES ====================
export const PRIVATE_IP_RANGES = [
  { start: '0.0.0.0', end: '0.255.255.255' },
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.0.0.0', end: '192.0.2.255' },
  { start: '192.88.99.0', end: '192.88.99.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '198.18.0.0', end: '198.19.255.255' },
  { start: '198.51.100.0', end: '198.51.100.255' },
  { start: '203.0.113.0', end: '203.0.113.255' },
  { start: '224.0.0.0', end: '255.255.255.255' }
];

// ==================== RESERVED DOMAINS ====================
export const RESERVED_DOMAINS = [
  '.gov', '.edu', '.gouv', '.gob', '.govt',
  '.mil', '.int', '.ac.uk',
  'localhost', 'example.com', 'test.com',
  'internal', 'intranet', 'vpn'
];

// ==================== STATUS ROTATIONS ====================
export const STATUS_ROTATIONS = [
  '🔴 Online',
  '🟠 Degraded',
  '🟡 Caution',
  '🟢 Stable'
];

export default {
  DEFAULT_TIPS,
  DEFAULT_ADS,
  PASSWORD_CONFIG,
  RATE_LIMIT_CONFIG,
  PAGINATION_CONFIG,
  ADMIN_PROTECTED_FIELDS,
  ADMIN_EDITABLE_FIELDS,
  DISCORD_DEFAULTS,
  API_CONFIG,
  DATABASE_CONFIG,
  LOOKUP_SERVICES,
  VALIDATION,
  HTTP_CODES,
  PRIVATE_IP_RANGES,
  RESERVED_DOMAINS,
  STATUS_ROTATIONS
};
