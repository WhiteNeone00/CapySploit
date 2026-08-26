// ========================================
// CAPI Configuration & Constants
// ========================================
// Centralized configuration file for all hardcoded values.
// Modify here to change API behavior globally without touching business logic.
// NOTE: Database system_settings is PRIMARY source; config.js is FALLBACK only

// ==================== DEFAULT PLANS & METHODS ====================
// Fallback values when database is unavailable or empty
// PRIMARY source: system_settings table in D1 database

export const DEFAULT_PLANS = [
  {
    name: 'Default',
    description: 'Basic plan',
    price: 0,
    max_time: 60,
    cooldown: 10,
    max_concurrents: 1,
    max_daily_attacks: 100,
    api: 1,
    raw_access: 0,
    star_access: 0,
    private_access: 0,
    bypass_power: 0,
    bypass_anti_spam: 0,
    bypass_blacklist: 0,
    vip: 0,
    holder: 0,
    reseller: 0
  },
  {
    name: 'VIP',
    description: 'Premium plan with extended limits',
    price: 10,
    max_time: 300,
    cooldown: 5,
    max_concurrents: 3,
    max_daily_attacks: 500,
    api: 1,
    raw_access: 0,
    star_access: 0,
    private_access: 0,
    bypass_power: 0,
    bypass_anti_spam: 0,
    bypass_blacklist: 0,
    vip: 1,
    holder: 0,
    reseller: 0
  },
  {
    name: 'Holder',
    description: 'High-tier plan for power users',
    price: 20,
    max_time: 500,
    cooldown: 3,
    max_concurrents: 5,
    max_daily_attacks: 1000,
    api: 1,
    raw_access: 1,
    star_access: 0,
    private_access: 0,
    bypass_power: 0,
    bypass_anti_spam: 0,
    bypass_blacklist: 0,
    vip: 0,
    holder: 1,
    reseller: 0
  },
  {
    name: 'Raw',
    description: 'Unlimited access tier',
    price: 50,
    max_time: 9999,
    cooldown: 1,
    max_concurrents: 99,
    max_daily_attacks: 99999,
    api: 1,
    raw_access: 1,
    star_access: 1,
    private_access: 1,
    bypass_power: 1,
    bypass_anti_spam: 1,
    bypass_blacklist: 1,
    vip: 1,
    holder: 1,
    reseller: 0
  }
];

export const DEFAULT_METHODS = [
  { name: 'udp', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'udp-pps', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'udp-free', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'udpbypass', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'spam-udp', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'spoof-udp', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: '!udp', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: '!pps', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'tcp', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'tcpbypass', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: '!tcp', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'discord', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'fivem', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'game', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'ovh', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'ovh-priv', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'http', enabled: 1, target_type: 'url', max_slots: 8, default_port: 80 },
  { name: '!http', enabled: 1, target_type: 'url', max_slots: 8, default_port: 80 },
  { name: 'browser', enabled: 1, target_type: 'url', max_slots: 8, default_port: 443 },
  { name: 'bypass', enabled: 1, target_type: 'url', max_slots: 8, default_port: 443 },
  { name: 'cloudflare', enabled: 1, target_type: 'url', max_slots: 8, default_port: 443 },
  { name: 'homehold', enabled: 1, target_type: 'ip', max_slots: 8, default_port: 80 },
  { name: 'httpsbypass', enabled: 1, target_type: 'url', max_slots: 8, default_port: 443 },
  { name: 'https', enabled: 1, target_type: 'url', max_slots: 8, default_port: 443 },
  { name: 'tls', enabled: 1, target_type: 'url', max_slots: 8, default_port: 443 },
  { name: 'tls-free', enabled: 1, target_type: 'url', max_slots: 8, default_port: 443 },
  { name: 'cf-bypass', enabled: 1, target_type: 'url', max_slots: 5, default_port: 443 },
  { name: 'slowloris', enabled: 1, target_type: 'url', max_slots: 3, default_port: 80 },
  { name: 'http-raw', enabled: 1, target_type: 'url', max_slots: 8, default_port: 80 },
  { name: 'https-raw', enabled: 1, target_type: 'url', max_slots: 8, default_port: 443 },
  { name: 'tcp-flood', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 },
  { name: 'udp-flood', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 53 },
  { name: 'icmp', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 0 },
  { name: 'syn', enabled: 1, target_type: 'ip', max_slots: 10, default_port: 80 }
];

// ==================== APP DEFAULTS & FALLBACKS ===================="
export const APP_DEFAULTS = {
  SERVICE_NAME: 'CAPI',
  SRC_NAME: 'CapySploit',
  API_BASE_URL: 'https://capi.capysploit.workers.dev',
  API_BASE_URL_FALLBACK: 'https://capi.insideproxy.me',
  ROOT_USERNAME: 'root',
  ROOT_PASSWORD: 'admin123',
  DISCORD_API_BASE_URL: 'https://discord.com/api/v10',
  DISCORD_ROLE_API_URL: 'https://discord.com/api/v10',
  ATTACK_CARD_IMAGE_URL: 'https://discord-webhook.com/uploads/5ab0b46dde847b81e431d78bf9c9757d.webp',
  MINECRAFT_ICON_URL: 'https://static.wikia.nocookie.net/minecraft_gamepedia/images/6/6b/Minecraft.png',
  FIVEM_ICON_URL: 'https://wiki.fivem.net/images/f/f8/FiveM_icon.png',
  GOOGLE_DOMAIN_ICON_URL: 'https://www.gstatic.com/images/branding/product/1x/domains_48dp.png',
  FLAG_ICON_URL_TEMPLATE: 'https://flagcdn.com/w80/{code}.png',
  WHOIS_BASE_URL: 'https://whois.domaintools.com',
  IP_LOOKUP_FALLBACK_URL: 'http://ip-api.com/json/{target}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query',
  FIVEM_LOOKUP_FALLBACK_URL: 'https://servers-frontend.fivem.net/api/servers/single/{target}',
  DEFAULT_SERVICE_NAME: 'CAPI'
};

export const DEFAULT_ROOT_CREDENTIALS = {
  username: APP_DEFAULTS.ROOT_USERNAME,
  password: APP_DEFAULTS.ROOT_PASSWORD
};

export const USER_LIMITS = {
  DEFAULT_MAX_TIME: 60,
  DEFAULT_COOLDOWN: 10,
  DEFAULT_MAX_CONCURRENTS: 1,
  DEFAULT_MAX_DAILY_ATTACKS: 100,
  DEFAULT_WARNING_LIMIT: 5,
  DAILY_WARNING_RESET_MS: 24 * 60 * 60 * 1000,
  DISCORD_LINK_TTL_MS: 10 * 60 * 1000
};

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
  // Keep generated passwords safe to paste into query-string URLs.
  SYMBOLS: '!_-',
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

// ==================== FAILED AUTH RATE LIMITING ====================
export const FAILED_AUTH_CONFIG = {
  ENABLED: true,
  MAX_ATTEMPTS: 5,                    // Max failed attempts
  LOCKOUT_WINDOW_MINUTES: 15,         // Lock out for 15 minutes
  LOCKOUT_WINDOW_MS: 15 * 60 * 1000,  // 900,000 ms
  ATTEMPT_WINDOW_MINUTES: 15,         // Count attempts within 15 minutes
  ATTEMPT_WINDOW_MS: 15 * 60 * 1000   // 900,000 ms
};

// ==================== PAGINATION ====================
export const PAGINATION_CONFIG = {
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
  MIN_OFFSET: 0
};

// ==================== CACHE CONFIGURATION ====================
export const CACHE_CONFIG = {
  ENABLED: true,
  DEFAULT_TTL_MS: 300000,          // 5 minutes default
  USER_TTL_MS: 600000,             // 10 minutes for user metadata
  METHODS_TTL_MS: 600000,          // 10 minutes for method lists
  PLANS_TTL_MS: 600000,            // 10 minutes for plan data
  SETTINGS_TTL_MS: 300000,         // 5 minutes for system settings
  STATS_TTL_MS: 60000,             // 1 minute for stats
  CLEANUP_INTERVAL_MS: 60000       // Run cleanup every 60 seconds
};

// ==================== CONCURRENCY LIMITS ====================
export const CONCURRENCY_CONFIG = {
  ENABLED: true,
  MAX_CONCURRENT_ATTACKS: 50,           // Global limit for concurrent attack fanouts
  MAX_ATTACKS_PER_USER: 3,              // Max concurrent attacks per user
  MAX_OUTGOING_REQUESTS: 100,           // Max concurrent outgoing HTTP requests
  BACKPRESSURE_THRESHOLD: 0.8,          // Start backpressure at 80% capacity
  SEMAPHORE_CLEANUP_INTERVAL_MS: 300000 // Cleanup inactive semaphores every 5 minutes
};

// ==================== REQUEST TIMEOUT CONFIGURATION ====================
export const TIMEOUT_CONFIG = {
  ENABLED: true,
  DEFAULT_TIMEOUT_MS: 30000,           // 30 seconds default
  API_TIMEOUT_MS: 25000,               // API requests (attacks, lookups)
  EXTERNAL_LOOKUP_TIMEOUT_MS: 10000,   // IP lookups, Minecraft, FiveM
  DATABASE_TIMEOUT_MS: 5000,           // Database operations
  DISCORD_TIMEOUT_MS: 8000,            // Discord API calls
  ATTACK_LAUNCH_TIMEOUT_MS: 5000,      // Attack fanout timeout
  WARNING_THRESHOLD_MS: 20000           // Warn if approaching limit
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
  'cooldown',
  'max_concurrents',
  'max_daily_attacks',
  'bypass_anti_spam',
  'power_saving'
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
  AVERAGE_EXECUTION_TIME_SECONDS: 10,
  SLOT_BAR_WIDTH: 10,
  SLOT_EMPTY_CHAR: '⬜',
  SLOT_FILLED_CHAR: '🔵'
};

// ==================== DATABASE & CLEANUP ====================
export const DATABASE_CONFIG = {
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
  LOG_RETENTION_DAYS: 30,
  TABLES: ['users', 'logs', 'ongoing_attacks', 'blacklist', 'discord_links', 'methods', 'plans']
};

// ==================== LOOKUP SERVICES ====================
export const LOOKUP_SERVICES = {
  IP_LOOKUP_URLS: [
    APP_DEFAULTS.IP_LOOKUP_FALLBACK_URL
  ],
  MINECRAFT_LOOKUP_URLS: [
    'https://api.mcsrvstat.us/2/{target}',
    'https://api.mcstatus.io/v2/status/java/{target}'
  ],
  FIVEM_LOOKUP_URLS: [
    APP_DEFAULTS.FIVEM_LOOKUP_FALLBACK_URL
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
  APP_DEFAULTS,
  DEFAULT_ROOT_CREDENTIALS,
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
