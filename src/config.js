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
    description: 'Basic default methods plan',
    price: 0,
    lifetime_price: 0,
    max_time: 60,
    cooldown: 10,
    max_concurrents: 1,
    max_daily_attacks: 100,
    api: 1,
    raw_access: 0,
    star_access: 0,
    botnet_access: 0,
    private_access: 0,
    bypass_power: 0,
    bypass_anti_spam: 0,
    bypass_blacklist: 0,
    vip: 0,
    holder: 0,
    reseller: 0
  },
  {
    name: 'Silver',
    description: 'Default methods plan',
    price: 15,
    lifetime_price: 120,
    max_time: 120,
    cooldown: 0,
    max_concurrents: 1,
    max_daily_attacks: 100,
    api: 1,
    raw_access: 0,
    star_access: 0,
    botnet_access: 0,
    private_access: 0,
    bypass_power: 0,
    bypass_anti_spam: 0,
    bypass_blacklist: 0,
    vip: 1,
    holder: 0,
    reseller: 0
  },
  {
    name: 'Gold',
    description: 'VIP and Star methods plan',
    price: 25,
    lifetime_price: 140,
    max_time: 200,
    cooldown: 0,
    max_concurrents: 3,
    max_daily_attacks: 500,
    api: 1,
    raw_access: 0,
    star_access: 1,
    botnet_access: 0,
    private_access: 0,
    bypass_power: 0,
    bypass_anti_spam: 0,
    bypass_blacklist: 0,
    vip: 1,
    holder: 0,
    reseller: 0
  },
  {
    name: 'Diamond',
    description: 'VIP and Star methods plan',
    price: 30,
    lifetime_price: 180,
    max_time: 400,
    cooldown: 0,
    max_concurrents: 5,
    max_daily_attacks: 1000,
    api: 1,
    raw_access: 0,
    star_access: 1,
    botnet_access: 0,
    private_access: 0,
    bypass_power: 0,
    bypass_anti_spam: 0,
    bypass_blacklist: 0,
    vip: 1,
    holder: 0,
    reseller: 0
  },
  {
    name: 'Champion',
    description: 'VIP and Star methods plan',
    price: 45,
    lifetime_price: 200,
    max_time: 600,
    cooldown: 0,
    max_concurrents: 8,
    max_daily_attacks: 99999,
    api: 1,
    raw_access: 0,
    star_access: 1,
    botnet_access: 0,
    private_access: 0,
    bypass_power: 0,
    bypass_anti_spam: 0,
    bypass_blacklist: 0,
    vip: 1,
    holder: 0,
    reseller: 0
  },
  {
    name: 'Extreme',
    description: 'VIP, Star, and Private methods plan',
    price: 60,
    lifetime_price: 300,
    max_time: 1000,
    cooldown: 0,
    max_concurrents: 12,
    max_daily_attacks: 99999,
    api: 1,
    raw_access: 0,
    star_access: 1,
    botnet_access: 0,
    private_access: 1,
    bypass_power: 0,
    bypass_anti_spam: 0,
    bypass_blacklist: 0,
    vip: 1,
    holder: 0,
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

// ==================== DISCORD WEBHOOK LOGGING ====================
// Central source for Discord webhook routing. Add as many hook URLs as you want to any channel,
// then filter with allowed events, route modes, or admin/view-only rules without editing business logic.
export const DISCORD_WEBHOOK_CONFIG = {
  enabled: true,
  timeoutMs: 8000,
  defaultUsername: 'CAPI Event Feed',
  defaultAvatarUrl: '',
  defaultWebhookUrl: 'https://discord.com/api/webhooks/1542555438791393405/__a8rBRnvxO-OKoK8sTEhCVMJ_b-cgYHoQkUEZTgyeXomZNhe8E8l6VQP6j-BIXkEpkY',
  eventStyles: {
    request: { title: 'REQUEST RECEIVED', color: 0x3498DB, footer: 'CAPI Request Monitor' },
    attack: { title: 'ATTACK LAUNCHED', color: 0xE74C3C, footer: 'CAPI Activity Monitor' },
    view: { title: 'PLAN VIEWED', color: 0x2ECC71, footer: 'CAPI Activity Monitor' },
    admin: { title: 'ADMIN ACTION', color: 0x9B59B6, footer: 'CAPI Admin Monitor' },
    security: { title: 'SECURITY EVENT', color: 0xF1C40F, footer: 'CAPI Security Monitor' }
  },
  routeModes: {
    admin_only: ['admin_only_logs', 'all_logs'],
    view_only: ['view_only_logs', 'all_logs'],
    logs_only: ['logs_only', 'send_only_logs', 'all_logs'],
    send_only: ['send_only_logs', 'all_logs'],
    all: ['all_logs']
  },
  channels: {
    admin_only_logs: {
      enabled: true,
      urls: ['https://discord.com/api/webhooks/1542555438791393405/__a8rBRnvxO-OKoK8sTEhCVMJ_b-cgYHoQkUEZTgyeXomZNhe8E8l6VQP6j-BIXkEpkY'],
      username: 'CAPI Admin',
      avatar_url: '',
      color: 0x5865F2,
      allowed_events: ['admin', 'audit', 'security', 'attack', 'request'],
      include_fields: ['action', 'admin_username', 'target_user', 'status', 'source_ip'],
      route_mode: 'admin_only'
    },
    view_only_logs: {
      enabled: true,
      urls: ['https://discord.com/api/webhooks/1542555438791393405/__a8rBRnvxO-OKoK8sTEhCVMJ_b-cgYHoQkUEZTgyeXomZNhe8E8l6VQP6j-BIXkEpkY'],
      username: 'CAPI Views',
      avatar_url: '',
      color: 0x7289DA,
      allowed_events: ['view', 'read', 'lookup', 'attack', 'request'],
      include_fields: ['route', 'username', 'target_user', 'status'],
      route_mode: 'view_only'
    },
    logs_only: {
      enabled: true,
      urls: ['https://discord.com/api/webhooks/1542555438791393405/__a8rBRnvxO-OKoK8sTEhCVMJ_b-cgYHoQkUEZTgyeXomZNhe8E8l6VQP6j-BIXkEpkY'],
      username: 'CAPI Events',
      avatar_url: '',
      color: 0x57F287,
      allowed_events: ['audit', 'admin', 'view', 'read', 'lookup', 'system', 'attack', 'request'],
      include_fields: ['action', 'route', 'target_user', 'status'],
      route_mode: 'logs_only'
    },
    send_only_logs: {
      enabled: true,
      urls: ['https://discord.com/api/webhooks/1542555438791393405/__a8rBRnvxO-OKoK8sTEhCVMJ_b-cgYHoQkUEZTgyeXomZNhe8E8l6VQP6j-BIXkEpkY'],
      username: 'CAPI Activity',
      avatar_url: '',
      color: 0xFAA61A,
      allowed_events: ['audit', 'admin', 'view', 'read', 'lookup', 'system', 'attack', 'request'],
      include_fields: ['action', 'route', 'target_user', 'status'],
      route_mode: 'send_only'
    },
    all_logs: {
      enabled: true,
      urls: ['https://discord.com/api/webhooks/1542555438791393405/__a8rBRnvxO-OKoK8sTEhCVMJ_b-cgYHoQkUEZTgyeXomZNhe8E8l6VQP6j-BIXkEpkY'],
      username: 'CAPI Full Feed',
      avatar_url: '',
      color: 0xEB459E,
      allowed_events: ['audit', 'admin', 'view', 'read', 'lookup', 'system', 'security', 'attack', 'request'],
      include_fields: ['action', 'route', 'target_user', 'status'],
      route_mode: 'all'
    }
  }
};

export function getDiscordWebhookChannels() {
  return DISCORD_WEBHOOK_CONFIG?.channels || {};
}

export function getDiscordWebhookUrls(channelKey) {
  const channel = getDiscordWebhookChannels()[channelKey] || {};
  const urls = Array.isArray(channel.urls) ? channel.urls : [];
  return urls.filter(Boolean);
}

export function shouldDispatchDiscordWebhook(channelKey, eventType, context = {}) {
  if (!DISCORD_WEBHOOK_CONFIG.enabled) return false;
  const channel = getDiscordWebhookChannels()[channelKey] || {};
  if (!channel.enabled || !Array.isArray(channel.urls) || channel.urls.length === 0) return false;

  const allowed = Array.isArray(channel.allowed_events) ? channel.allowed_events : [];
  if (allowed.length > 0 && !allowed.includes(eventType)) return false;

  const routeMode = String(context?.mode || channel?.route_mode || 'all');
  const permittedChannels = DISCORD_WEBHOOK_CONFIG.routeModes?.[routeMode] || ['all_logs'];
  const matchesRoute = permittedChannels.includes(channelKey) || permittedChannels.includes('all_logs') || channelKey === 'all_logs';
  if (!matchesRoute) return false;

  return true;
}

export function buildDiscordWebhookEmbed(eventType, payload = {}, overrides = {}) {
  const entry = payload && typeof payload === 'object' ? payload : { message: String(payload || '') };
  const title = overrides.title || `${String(eventType || 'event').toUpperCase()} LOG`;
  const description = overrides.description || entry.description || entry.message || 'No description supplied.';
  const configuredFields = Array.isArray(overrides.includeFields) ? overrides.includeFields : null;
  const fields = Array.isArray(overrides.fields) ? overrides.fields : [
    ...(configuredFields || Object.keys(entry))
      .map((key) => [key, entry[key]])
      .filter(([key, value]) => key !== 'message' && key !== 'description' && value !== undefined && value !== null && value !== '')
      .slice(0, 10)
      .map(([key, value]) => ({ name: String(key).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()), value: typeof value === 'string' ? value : JSON.stringify(value), inline: true }))
  ];

  return {
    title,
    description: String(description).slice(0, 2000),
    color: overrides.color ?? 0x5865F2,
    timestamp: new Date().toISOString(),
    author: overrides.author ? { name: String(overrides.author).slice(0, 256) } : undefined,
    url: overrides.url || undefined,
    footer: overrides.footer ? { text: String(overrides.footer) } : { text: 'CAPI webhook' },
    fields: fields.length ? fields.slice(0, 10).map((field) => ({
      name: String(field.name || 'Details').slice(0, 256),
      value: String(field.value || 'n/a').slice(0, 1024),
      inline: Boolean(field.inline)
    })) : []
  };
}

export function buildDiscordWebhookPayload(eventType, payload = {}, options = {}) {
  const channel = options.channel || {};
  const eventLabel = String(eventType || 'event').toUpperCase();
  const userName = channel.username || DISCORD_WEBHOOK_CONFIG.defaultUsername;
  const avatarUrl = channel.avatar_url || DISCORD_WEBHOOK_CONFIG.defaultAvatarUrl;
  const content = options.content || '';
  const style = DISCORD_WEBHOOK_CONFIG.eventStyles?.[eventType] || {};

  return {
    username: userName,
    avatar_url: avatarUrl || undefined,
    content: content || undefined,
    embeds: [
      buildDiscordWebhookEmbed(eventType, payload, {
        title: options.title || style.title || `${eventLabel} LOG`,
        description: options.description || payload?.message || payload?.description || 'Webhook event fired.',
        color: options.color ?? style.color ?? channel.color ?? 0x5865F2,
        footer: options.footer || style.footer || 'CAPI Discord Alerts',
        author: options.author || 'CAPI Control Plane',
        includeFields: channel.include_fields,
        fields: Array.isArray(options.fields) ? options.fields : undefined
      })
    ]
  };
}

export async function sendDiscordWebhook(url, payload = {}, timeoutMs = DISCORD_WEBHOOK_CONFIG.timeoutMs) {
  if (!url || !payload) return { ok: false, reason: 'missing_webhook' };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    clearTimeout(timer);
    return {
      ok: response.ok,
      status: response.status,
      reason: response.ok ? 'success' : text || 'webhook_failed',
      text
    };
  } catch (error) {
    return { ok: false, reason: error?.message || 'webhook_error' };
  }
}

export async function sendDiscordWebhookForEvent(eventType, payload = {}, context = {}) {
  if (!DISCORD_WEBHOOK_CONFIG.enabled) return [];

  const results = [];
  const seenUrls = new Set();
  const channelKeys = Object.keys(getDiscordWebhookChannels());

  for (const channelKey of channelKeys) {
    const channel = getDiscordWebhookChannels()[channelKey] || {};
    if (!channel.enabled) continue;
    if (!shouldDispatchDiscordWebhook(channelKey, eventType, context)) continue;

    const urls = getDiscordWebhookUrls(channelKey);
    for (const url of urls) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const payloadToSend = buildDiscordWebhookPayload(eventType, payload, {
        channel,
        title: context.title,
        description: context.description || payload?.message || payload?.description || 'CAPI event notification',
        footer: context.footer,
        author: context.author || 'CAPI Control Plane',
        fields: Array.isArray(context.fields) ? context.fields : undefined,
        content: context.content || `CAPI ${String(eventType || 'event').toUpperCase()} update`
      });

      const result = await sendDiscordWebhook(url, payloadToSend, DISCORD_WEBHOOK_CONFIG.timeoutMs);
      results.push({ channel: channelKey, url, ...result });
    }
  }

  return results;
}

// ==================== API RESPONSE TEXTS ====================
// Central source for API response strings. Set enabled: false to disable a custom message
// and fall back to the route-provided string, or change the value here to tweak wording globally.
export const API_RESPONSE_TEXT = {
  enabled: true,
  templates: {
    admin_auth_required: { enabled: true, message: 'admin authentication required', hint: 'Provide username and password as query parameters for the admin route.' },
    missing_credentials: { enabled: true, message: 'missing credentials', hint: 'Provide username and password for this API route.' },
    invalid_credentials: { enabled: true, message: 'invalid credentials', hint: 'Username or password is incorrect.' },
    access_denied_ip: { enabled: true, message: 'access denied from this IP address', hint: 'This account is restricted to a specific IP address. Contact an administrator to change the whitelist.' },
    account_suspended: { enabled: true, message: 'account suspended', hint: 'This account is suspended. Contact an administrator to restore access.' },
    account_expired: { enabled: true, message: 'account expired', hint: 'Your account has expired. Contact an administrator to renew access.' },
    no_ongoing_attacks: { enabled: true, message: 'No ongoing attacks found', hint: null },
    ongoing_attacks_success: { enabled: true, message: 'Ongoing attacks retrieved successfully.', hint: 'The finish value shows how many seconds remain before the attack expires.' },
    user_not_found: { enabled: true, message: 'user not found', hint: 'The requested user does not exist.' },
    rate_limited: { enabled: true, message: 'rate limit exceeded', hint: 'You are making requests too quickly. Upgrade to bypass rate limits or wait before retrying.' },
    generic_error: { enabled: true, message: 'request failed', hint: 'Review your request and try again.' },
    network_statistics_success: { enabled: true, message: 'Network statistics retrieved successfully.' },
    endpoint_catalog_loaded: { enabled: true, message: 'endpoint catalog loaded' },
    graph_stats_loaded: { enabled: true, message: 'graph stats loaded' },
    public_methods_loaded: { enabled: true, message: 'public methods loaded' },
    discord_profile_loaded: { enabled: true, message: 'discord profile loaded' },
    verification_code_generated: { enabled: true, message: 'verification code generated' },
    discord_account_verified: { enabled: true, message: 'discord account verified' },
    discord_account_unlinked: { enabled: true, message: 'Discord account unlinked successfully.' },
    user_plan_retrieved: { enabled: true, message: 'User plan retrieved successfully.' },
    attack_history_retrieved: { enabled: true, message: 'Attack history retrieved' },
    attack_request_accepted: { enabled: true, message: 'Attack request accepted and launched successfully.' },
    admin_init_completed: { enabled: true, message: 'System initialization completed' },
    admin_status_check: { enabled: true, message: 'System status check' },
    admin_stats_loaded: { enabled: true, message: 'Admin statistics loaded' },
    attacks_status_retrieved: { enabled: true, message: 'Attacks status retrieved' },
    attacks_toggled: { enabled: true, message: 'Attacks toggled globally' },
    maintenance_status_retrieved: { enabled: true, message: 'Maintenance mode status retrieved' },
    maintenance_mode_toggled: { enabled: true, message: 'Maintenance mode toggled' },
    database_cleanup_completed: { enabled: true, message: 'Database cleanup completed' },
    database_statistics_retrieved: { enabled: true, message: 'Database statistics retrieved' },
    methods_synced: { enabled: true, message: 'Methods synced from payload.js' },
    plan_updated: { enabled: true, message: 'Plan updated successfully.' },
    method_updated: { enabled: true, message: 'Method access levels updated successfully.' },
    service_settings_retrieved: { enabled: true, message: 'Service settings retrieved' },
    service_settings_updated: { enabled: true, message: 'Service settings updated successfully' },
    system_logs_retrieved: { enabled: true, message: 'System logs retrieved' },
    audit_logs_retrieved: { enabled: true, message: 'Audit logs retrieved' },
    system_users_retrieved: { enabled: true, message: 'System users retrieved' },
    syntax_validation_failed: { enabled: true, message: 'Code syntax validation failed.' },
    syntax_valid: { enabled: true, message: 'Code syntax is valid and error-free.' },
    attack_methods_retrieved: { enabled: true, message: 'Attack methods retrieved' },
    target_added_to_blacklist: { enabled: true, message: 'Target added to the blacklist.' },
    blacklist_entries_retrieved: { enabled: true, message: 'Blacklist entries retrieved' },
    blacklist_removed: { enabled: true, message: 'Blacklist entry has been removed.' },
    user_suspended: { enabled: true, message: 'User suspended.' },
    user_unsuspended: { enabled: true, message: 'User unsuspended.' },
    user_created: { enabled: true, message: 'User created successfully.' },
    user_password_changed: { enabled: true, message: 'Password changed successfully.' },
    user_password_generated: { enabled: true, message: 'Password generated successfully.' },
    user_field_updated: { enabled: true, message: 'User field updated successfully.' },
    plan_assigned: { enabled: true, message: 'Plan assigned to user successfully.' },
    user_deleted: { enabled: true, message: 'User deleted successfully.' },
    user_logs_retrieved: { enabled: true, message: "User logs retrieved successfully." },
    admin_discord_unlinked: { enabled: true, message: 'Discord account has been unlinked from user successfully.' },
    log_database_unavailable: { enabled: true, message: 'Log database is unavailable.' },
    admin_unknown_action: { enabled: true, message: 'unknown action', hint: 'Use ?action=get or ?action=set' },
    discord_registration_not_configured: { enabled: true, message: 'Discord registration is not configured. Set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID.' },
    discord_command_registered: { enabled: true, message: 'Discord command registered successfully' },
    discord_interaction_reachable: { enabled: true, message: 'Discord interaction endpoint is reachable. POST Discord interactions with signature headers to this route.' },
    discord_integration_not_configured: { enabled: true, message: 'Discord integration not configured properly' },
    missing_username_to_add: { enabled: true, message: 'missing username_to_add', hint: 'Provide username_to_add in the request.' },
    username_already_exists: { enabled: true, message: 'username already exists', hint: 'Choose a different username or use /admin/edit_user to modify.' },
    weak_password: { enabled: true, message: 'weak password', hint: 'Password does not meet the required complexity rules.' },
    plan_not_found: { enabled: true, message: 'plan not found', hint: 'The requested plan does not exist.' },
    field_not_editable: { enabled: true, message: 'field not editable', hint: 'This field cannot be edited via this endpoint.' },
    field_not_editable_for_security: { enabled: true, message: 'field not editable for security', hint: 'This field cannot be edited via this endpoint for security reasons.' },
    invalid_or_unknown_code: { enabled: true, message: 'invalid or unknown code' },
    code_already_used: { enabled: true, message: 'code already used' },
    code_expired: { enabled: true, message: 'code expired' },
    user_does_not_exist: { enabled: true, message: 'user does not exist' },
    api_access_disabled: { enabled: true, message: 'api access disabled' },
    user_already_verified: { enabled: true, message: 'user already verified via Discord; use admin/unlink_discord to reset' },
    discord_already_linked: { enabled: true, message: 'This Discord account is already linked. Use /unlink first, then run /link again with a new code.' },
    linked_user_no_longer_exists: { enabled: true, message: 'linked user no longer exists' },
    discord_not_linked: { enabled: true, message: 'Discord account is not currently linked. Use /link to verify first.' },
    discord_profile_not_linked: { enabled: true, message: 'Discord account not linked. Use /link to verify your account first; /plan is only available for linked users.' },
    user_plan_retrieved_admin: { enabled: true, message: 'User plan retrieved successfully.' },
    maintenance_toggled: { enabled: true, message: 'Maintenance mode toggled' },
    unknown_action: { enabled: true, message: 'unknown action', hint: 'Use ?action=get or ?action=set' }
  }
};

function interpolateTemplate(templateString, values = {}) {
  if (typeof templateString !== 'string') return templateString;
  return Object.entries(values).reduce((result, [key, value]) => {
    const pattern = new RegExp(`\\{${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g');
    return result.replace(pattern, String(value ?? ''));
  }, templateString);
}

export function resolveApiMessage(key, fallback = null, values = {}) {
  const template = API_RESPONSE_TEXT?.templates?.[key];
  if (!template || template.enabled === false || !template.message) return fallback;
  return interpolateTemplate(template.message, values);
}

export function resolveApiHint(key, fallback = 'Review your request and try again.', values = {}) {
  const template = API_RESPONSE_TEXT?.templates?.[key];
  if (!template || template.enabled === false) return fallback;
  if (template.hint === null || template.hint === undefined) return fallback === undefined ? null : fallback;
  return interpolateTemplate(template.hint, values);
}

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
  WINDOW_SECONDS: 1,        // Minimum 1 second between requests per user
  PROTECTED_PREFIXES: ['/api/', '/admin/']
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
  'admin'
];

export const ADMIN_EDITABLE_FIELDS = [
  'password',
  'reseller',
  'vip',
  'holder',
  'api',
  'plan_id',
  'max_time',
  'cooldown',
  'max_concurrents',
  'max_daily_attacks',
  'created_by',
  'created_at',
  'last_request_time',
  'expiry_unix',
  'bypass_slots',
  'suspended',
  'suspend_reason',
  'suspended_by',
  'last_ip',
  'whitelisted_ip',
  'warning_count',
  'warning_reset_at',
  'bypass_anti_spam',
  'bypass_blacklist',
  'raw_access',
  'star_access',
  'botnet_access',
  'private_access',
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
  TABLES: ['users', 'ongoing_attacks', 'blacklist', 'discord_links', 'methods', 'plans']
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
