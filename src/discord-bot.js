import 'dotenv/config';
import { exec } from 'node:child_process';
import { Client, GatewayIntentBits, ActivityType, Partials, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, TextDisplayBuilder, ThumbnailBuilder, PermissionsBitField } from 'discord.js';
import * as Vault from './vault-db.js';
import { buildDiscordRoleNames, userPlanRole } from './discord.js';
import { formatSlotBar } from './helpers.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const apiBaseUrl = process.env.API_BASE_URL || 'https://capi.insideproxy.me';
const apiSecondary = process.env.API_BASE_URL_SECONDARY || 'https://capi.capysploit.workers.dev';
const ATTACK_CARD_IMAGE_URL = process.env.ATTACK_CARD_IMAGE_URL || 'https://discord-webhook.com/uploads/5ab0b46dde847b81e431d78bf9c9757d.webp';
const BOTTOM_BANNER_IMAGE_URL = process.env.BOTTOM_BANNER_IMAGE_URL || ATTACK_CARD_IMAGE_URL;
const API_CANDIDATES = [apiBaseUrl, apiSecondary].filter(Boolean);

function appendCommandBanner(container) {
  if (!BOTTOM_BANNER_IMAGE_URL) return container;
  return container.addMediaGalleryComponents({
    type: 12,
    items: [{ media: { type: 3, url: BOTTOM_BANNER_IMAGE_URL } }]
  });
}

function isDiscordAdmin(interaction) {
  const member = interaction.member;
  return Boolean(member && (
    member.roles?.cache?.some((role) => role.name?.toLowerCase() === 'admin') ||
    Boolean(member.permissions?.has?.(PermissionsBitField.Flags.Administrator))
  ));
}

function isDiscordOwner(interaction) {
  return interaction.user.id === process.env.DISCORD_OWNER_ID || interaction.user.id === interaction.guild?.ownerId;
}

function buildInfoContainer(title, summary, lines = [], buttons = []) {
  const container = new ContainerBuilder()
    .setAccentColor(0x3498DB)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(title))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(summary))
    .addSeparatorComponents(new SeparatorBuilder());

  for (const line of lines) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(line));
  }

  if (buttons.length) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));
  }

  appendCommandBanner(container);
  return container;
}

function buildStatsContainer(body) {
  const summary = `**Users:** ${body.total_users_count || 0} • **Active:** ${body.active_users_count || 0} • **Suspended:** ${body.suspended_users_count || 0}`;
  const lines = [
    `**Ongoing attacks:** ${body.total_ongoing_attacks || 0} • **Today:** ${body.total_attacks_today || 0}`,
    `**VIP:** ${body.vip_users_count || 0} • **Holder:** ${body.holder_users_count || 0} • **Reseller:** ${body.reseller_users_count || 0}`,
    `**Verified:** ${body.verified_discord_users_count || 0} • **Pending links:** ${body.pending_discord_links_count || 0}`,
    `**Health:** ${body.health_status || 'unknown'} • **Slots:** ${body.max_attack_api_slots || 'N/A'}`
  ];
  return buildInfoContainer('## 📈 Network Statistics', summary, lines, [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('View API').setURL(apiBaseUrl)]);
}

function buildOngoingContainer(body) {
  const summary = `**Ongoing attacks:** ${body.total_ongoing_attacks || 0} • **Today:** ${body.total_attacks_today || 0}`;
  const lines = [
    `**Active users:** ${body.active_users_count || 0} • **VIP users:** ${body.vip_users_count || 0}`,
    `**Suspended:** ${body.suspended_users_count || 0} • **Verified:** ${body.verified_discord_users_count || 0}`,
    `**Pending links:** ${body.pending_discord_links_count || 0} • **Health:** ${body.health_status || 'unknown'}`
  ];
  return buildInfoContainer('## 🔥 Ongoing Attacks', summary, lines, [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('View API Stats').setURL(`${apiBaseUrl}/api/network_statistics`)]);
}

function buildRecentContainer(username, list = []) {
  const summary = `Showing ${Math.min(list.length, 8)} of ${list.length} recent attacks for **${username}**`;
  const lines = list.slice(0, 8).map((item, index) => {
    const target = item.target || item.Target || item.host || 'unknown';
    const method = (item.method || item.Method_Used || 'N/A').toUpperCase();
    const duration = item.duration || item.Time_Used || item.time || 'N/A';
    return `**${index + 1}.** ${target} • ${method} • ${duration}s`;
  });
  if (!lines.length) lines.push('No recent attacks found.');
  const container = buildInfoContainer(`## 🕒 Recent Attacks for ${username}`, summary, lines, [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('View Profile').setURL(`${apiBaseUrl}/api/view_profile?username=${encodeURIComponent(username)}`)]);
  return container;
}

function buildAdminActionContainer(title, message, details = []) {
  const lines = [`**Result:** ${message}`];
  for (const detail of details) {
    lines.push(detail);
  }
  return buildInfoContainer(title, `Admin action completed.`, lines);
}

async function apiFetch(pathWithQuery, options) {
  // pathWithQuery may be a full path like '/api/xyz?foo=bar' or a full URL
  let lastErr = null;
  for (const base of API_CANDIDATES) {
    try {
      const baseClean = base.replace(/\/$/, '');
      const url = pathWithQuery.startsWith('http') ? pathWithQuery : `${baseClean}${pathWithQuery}`;
      // Inject bot API key into headers if available and not explicitly provided
      const opt = Object.assign({}, options || {});
      opt.headers = Object.assign({}, opt.headers || {});
      if (!opt.headers.Authorization && process.env.BOT_API_KEY) {
        opt.headers.Authorization = `Bearer ${process.env.BOT_API_KEY}`;
      }
      const res = await fetch(url, opt);
      // If server responded with a client error, return it (it's a valid response)
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      // For 5xx or network errors, try next candidate
      if (res.status >= 500) continue;
      // otherwise return what we got
      return res;
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('All API endpoints failed');
}

console.log('Discord bot config loaded:', {
  hasToken: Boolean(token),
  hasClientId: Boolean(clientId),
  hasGuildId: Boolean(guildId),
  apiBaseUrl
});

if (!token) {
  throw new Error('DISCORD_TOKEN environment variable is required for the bot.');
}
if (!clientId) {
  throw new Error('DISCORD_CLIENT_ID environment variable is required for the bot.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction]
});

client.on('error', (error) => console.error('Discord client error:', error));
client.on('shardError', (error) => console.error('Discord shard error:', error));
client.on('invalidated', () => console.error('Discord client invalidated'));
client.on('disconnect', (event) => console.warn('Discord client disconnected:', event));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

const DEFAULT_METHOD_NAMES = ['udp', 'tcp', 'http', 'https', 'cf-bypass', 'http-raw', 'https-raw', 'slowloris', 'tcp-flood', 'udp-flood'];

let statusIndex = 0;
let cachedMethodNames = null;
let methodCacheExpires = 0;
const attackMessageState = new Map();
let graphStatusMessageId = null;
let attackUpdaterInterval = null;

async function fetchNetworkStats() {
  try {
    const response = await apiFetch('/api/network_statistics');
    const payload = await response.json();
    if (!payload || payload.error) {
      return { total_attacks_today: 0, vip_users_count: 0, holder_users_count: 0, reseller_users_count: 0, verified_discord_users_count: 0 };
    }
    return {
      total_attacks_today: Number(payload.total_attacks_today || 0),
      vip_users_count: Number(payload.vip_users_count || 0),
      holder_users_count: Number(payload.holder_users_count || 0),
      reseller_users_count: Number(payload.reseller_users_count || 0),
      verified_discord_users_count: Number(payload.verified_discord_users_count || 0)
    };
  } catch (error) {
    console.error('Failed to fetch network stats:', error);
    return { total_attacks_today: 0, vip_users_count: 0, holder_users_count: 0, reseller_users_count: 0, verified_discord_users_count: 0 };
  }
}

const statusRotations = [
  async () => {
    const stats = await fetchNetworkStats();
    return `Watching ${stats.total_attacks_today} attacks today`;
  },
  async () => {
    const stats = await fetchNetworkStats();
    return `Watching ${stats.vip_users_count} VIP users`;
  },
  async () => {
    const stats = await fetchNetworkStats();
    return `Watching ${stats.holder_users_count} holders`;
  },
  async () => {
    const stats = await fetchNetworkStats();
    return `Watching ${stats.reseller_users_count} resellers`;
  },
  async () => {
    const stats = await fetchNetworkStats();
    return `Watching ${stats.verified_discord_users_count} verified users`;
  }
];

async function fetchMethodNames() {
  const now = Date.now();
  if (cachedMethodNames && methodCacheExpires > now) {
    return cachedMethodNames;
  }

  try {
    const response = await apiFetch('/admin/list_methods');
    const payload = await response.json();
    const list = (payload && !payload.error && Array.isArray(payload.data?.methods))
      ? payload.data.methods.map((item) => (item.name || '').toLowerCase()).filter(Boolean)
      : DEFAULT_METHOD_NAMES;
    cachedMethodNames = list.length ? list : DEFAULT_METHOD_NAMES;
  } catch (error) {
    console.error('Failed to fetch method names:', error);
    cachedMethodNames = DEFAULT_METHOD_NAMES;
  }

  methodCacheExpires = now + 60_000;
  return cachedMethodNames;
}

async function updateStatus() {
  try {
    if (!client.user) return;
    const text = await statusRotations[statusIndex % statusRotations.length]();
    await client.user.setActivity(text, { type: ActivityType.Watching });
    statusIndex += 1;
  } catch (error) {
    console.error('Failed to update bot status:', error);
  }
}

async function fetchGraphStats() {
  try {
    const response = await apiFetch('/api/graph');
    const payload = await response.json();
    if (!payload || payload.error) {
      return { apiSlotsTotal: 30, apiSlotsUsed: 0, apiSlotsAvailable: 30, apiPercent: '0.00', c2SlotsActive: 0, maintenance: false, lastMaintenance: 'None', uptime: '0s', updatedAt: new Date().toISOString() };
    }
    const data = payload.data || {};
    return {
      apiSlotsTotal: Number(data.api_slots?.total || 30),
      apiSlotsUsed: Number(data.api_slots?.used || 0),
      apiSlotsAvailable: Number(data.api_slots?.available || 0),
      apiPercent: String(data.api_slots?.percent || '0.00'),
      c2SlotsActive: Number(data.c2_slots?.active_attacks || 0),
      maintenance: Boolean(data.maintenance?.enabled || false),
      lastMaintenance: data.maintenance?.last_maintenance || 'None',
      uptime: data.uptime || '0s',
      updatedAt: data.updated_at || new Date().toISOString()
    };
  } catch (error) {
    console.error('Failed to fetch graph stats:', error);
    return { apiSlotsTotal: 30, apiSlotsUsed: 0, apiSlotsAvailable: 30, apiPercent: '0.00', c2SlotsActive: 0, maintenance: false, lastMaintenance: 'None', uptime: '0s', updatedAt: new Date().toISOString() };
  }
}

function buildGraphContainer(stats) {
  const statusLabel = stats.maintenance ? 'Maintenance' : 'Live';
  const updatedAt = new Date(stats.updatedAt || Date.now()).getTime();
  const container = new ContainerBuilder()
    .setAccentColor(0x3498DB)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## 📊 Graph - Real-time Statistics')
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Status:** ${statusLabel}`)
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**API Slots**\n` +
        `Total: ${stats.apiSlotsTotal}\n` +
        `Used: ${stats.apiSlotsUsed}\n` +
        `${formatSlotBar(stats.apiSlotsUsed, stats.apiSlotsTotal)}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**C2 Slots**\n` +
        `Active: ${stats.c2SlotsActive}\n` +
        `**Uptime:** ${stats.uptime}\n` +
        `**Last Maintenance:** ${stats.lastMaintenance}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Updated:** <t:${Math.floor(updatedAt / 1000)}:R>`)
    )
  appendCommandBanner(container);
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Refresh')
        .setCustomId('graph_refresh')
    )
  );
  return container;
}

function buildAttackContainer(state, now = Date.now()) {
  const elapsedSeconds = Math.max(0, Math.floor((now - state.startTime) / 1000));
  const remainingSeconds = Math.max(0, Number(state.durationSeconds || 0) - elapsedSeconds);
  const total = Number(state.durationSeconds || 0) || 1;
  const pct = Math.max(0, Math.min(1, elapsedSeconds / total));
  const barWidth = 20;
  const filled = Math.round(pct * barWidth);
  const progressBar = `${'▰'.repeat(filled)}${'▱'.repeat(Math.max(0, barWidth - filled))}`;
  const pctLabel = Math.round(pct * 100);

  let accent = 0x3498DB;

  const targetLabel = state.targetLabel || `${state.host || 'N/A'}:${state.port || 'N/A'}`;
  const methodLabel = (state.methodLabel || state.method || 'N/A').toUpperCase();
  const attackId = state.attackId || state.id || state.attackid || null;
  const attackIdDisplay = attackId || state.localId || null;
  const topTimestamp = state.startTime ? new Date(state.startTime).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : '—';
  const bottomTimestamp = state.startTime ? new Date(state.startTime).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '—';
  const targetOrg = state.targetOrg || state.targetCountry || state.target_country || 'Unknown';
  const thumbnailUrl = ATTACK_CARD_IMAGE_URL;

  const container = new ContainerBuilder().setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Attack Launched | www.capysploit.wtf**\n__Timestamp:__ ${topTimestamp}   *ID:* ${attackIdDisplay || '—'}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`*Progress:* ${progressBar} *${pctLabel}%*`));

  const targetInfo =
    `**TARGET:** **\`[${targetLabel}]\`**\n` +
    `**TIME:** **\`[${total}s]\`**\n` +
    `**PORT:** **\`[${state.port || 'N/A'}]\`**\n` +
    `**METHOD:** **\`[${methodLabel}]\`**\n` +
    `**ORG:** **\`[${targetOrg}]\`**` +
    (state.targetIsp ? `\n**ISP:** **\`[${state.targetIsp}]\`**` : '');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(targetInfo));

  container.addSeparatorComponents(new SeparatorBuilder());

  const vipLabel = state.vip ? 'TRUE' : 'FALSE';
  const stLabel = state.admin ? 'TRUE' : 'FALSE';
  const rwLabel = state.holder ? 'TRUE' : 'FALSE';
  const cooldown = typeof state.cooldown === 'number' ? state.cooldown.toFixed(2) : (state.cooldown ?? '0.00');
  const sentBy = state.owner || 'Unknown';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**THREADS:** __${state.methodActiveSlots || 0}/${state.methodMaxSlots || 0}__ \n` +
      `**VIP:** __*[${vipLabel}]*__     **ST:** __*[${stLabel}]*__       **RW:** __*[${rwLabel}]*__ \n` +
      `**Cooldown:** __*[${cooldown}]*__\n` +
      `**TIMESTAMP:** __*[${bottomTimestamp}]*__\n` +
      `**SENT BY:** __*[${sentBy}]*__`
    )
  );

  appendCommandBanner(container);

  const actions = new ActionRowBuilder();
  const stopButton = new ButtonBuilder()
    .setStyle(ButtonStyle.Danger)
    .setLabel('Stop Attack')
    .setCustomId(`attack_stop:${attackId || ''}`)
    .setEmoji({ name: '👻' });
  actions.addComponents(stopButton);
  actions.addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Delete Message')
      .setCustomId('delete_attack_message')
      .setEmoji({ name: '🗑️' })
  );
  container.addActionRowComponents(actions);

  return container;
}

function startAttackUpdater() {
  if (attackUpdaterInterval) return;
  attackUpdaterInterval = setInterval(async () => {
    for (const [msgId, state] of Array.from(attackMessageState.entries())) {
      try {
        const channelId = state.channelId;
        if (!channelId) continue;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || typeof channel.messages?.fetch !== 'function') continue;
        const message = await channel.messages.fetch(msgId).catch(() => null);
        if (!message) {
          attackMessageState.delete(msgId);
          continue;
        }
        // Update state progress locally
        const container = buildAttackContainer(state);
        await message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      } catch (e) {
        console.error('Attack updater error for message', msgId, e?.message || e);
      }
    }
  }, 5000);
}

function buildLookupContainer(type, hostname, payload, path) {
  const server = payload.server || {};
  const ipinfo = payload.ip_info || payload.ipinfo || payload.ip_info_v4 || {};
  const accent = 0x3498DB;
  const title = type === 'mc' ? 'Minecraft Lookup' : type === 'cfx' ? 'FiveM Lookup' : type === 'domain' ? 'Domain Lookup' : 'IP Lookup';

  const countryCode = (ipinfo.countryCode || ipinfo.country_code || ipinfo.country || '').toUpperCase();
  const countryFlag = (code => {
    if (!code || code.length !== 2) return '';
    return String.fromCodePoint(...[...code].map(c => 0x1f1e6 - 65 + c.charCodeAt(0)));
  })(countryCode);

  const fetchedAt = new Date().toISOString();

  const container = new ContainerBuilder()
    .setAccentColor(0x3498DB)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🔎 ${title} • ${hostname}`))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Status:** ${payload.online ? 'Online ✅' : payload.online === false ? 'Offline ⛔' : 'Unknown'}${payload.ping ? ` • ${payload.ping}ms` : ''}${payload.version ? ` • v${payload.version}` : ''}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Query:** ${hostname} • **Checked:** ${fetchedAt}`));

  // Server info blocks
  // Determine thumbnail/icon to use. If favicon is a data URL, return it as an attachment.
  let iconUrl = null;
  let attachment = null; // { name, buffer }
  try {
  const fav = payload.favicon || payload.icon || server.favicon || server.icon;
    if (type === 'mc') {
      if (fav && String(fav).startsWith('http')) iconUrl = fav;
      else if (fav && String(fav).startsWith('data:image')) {
        // Convert data URL to buffer and attach as file
        const m = String(fav).match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/i);
        if (m) {
          const mime = m[1];
          const b64 = m[3];
          const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'bin';
          const name = `favicon_${type}.${ext}`;
          attachment = { name, buffer: Buffer.from(b64, 'base64') };
          iconUrl = `attachment://${name}`;
        }
      } else {
        iconUrl = 'https://static.wikia.nocookie.net/minecraft_gamepedia/images/6/6b/Minecraft.png';
      }
    } else if (type === 'cfx') {
      if (fav && String(fav).startsWith('http')) iconUrl = fav;
      else iconUrl = server.icon || payload.icon || 'https://wiki.fivem.net/images/f/f8/FiveM_icon.png';
    } else if (type === 'domain') {
      iconUrl = 'https://www.gstatic.com/images/branding/product/1x/domains_48dp.png';
    } else if (type === 'ip' && countryCode) {
      iconUrl = `https://flagcdn.com/w80/${countryCode.toLowerCase()}.png`;
    }
  } catch (e) {
    iconUrl = null;
    attachment = null;
  }

  if (type === 'cfx') {
    const endpoint = server.endpoint || server.connectEndPoints || server.connectEndPoints?.[0] || 'N/A';
    const name = server.hostname || server.name || server.serverName || 'N/A';
    const playersCount = server?.Data?.players?.length ?? server.players ?? 'N/A';
    const maxPlayers = server?.Data?.vars?.sv_maxclients ?? server.maxplayers ?? 'N/A';
    {
      const content = `**Name:** ${name}  \n**Endpoint:** ${endpoint}  \n**Players:** ${playersCount}/${maxPlayers}${server.ping ? `  \n**Ping:** ${server.ping}ms` : ''}`;
      if (iconUrl) {
        const section = new SectionBuilder().setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl));
        section.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        container.addSectionComponents(section);
      } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
      }
    }
    if (Array.isArray(server?.Data?.players) && server.Data.players.length) {
      const list = server.Data.players.slice(0, 10).map(p => `• ${p?.name || p}`).join('\n');
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Top Players:**\n${list}`));
    }
  } else if (type === 'mc') {
    const online = server.online ? 'Yes' : 'No';
    const ip = server.ip || server.ip_address || server.hostname || hostname;
    const port = server.port || 25565;
    const players = server.players?.online ?? server.players?.length ?? 'N/A';
    const maxPlayers = server.players?.max ?? server.players?.max_players ?? 'N/A';
    // Fix version display if it's an object
    let versionStr = 'N/A';
    try {
      if (server.version) {
        if (typeof server.version === 'string') versionStr = server.version;
        else if (typeof server.version === 'object') versionStr = server.version.name || server.version.protocol || JSON.stringify(server.version);
        else versionStr = String(server.version);
      } else if (payload.version) {
        const v = payload.version;
        versionStr = typeof v === 'string' ? v : (v?.name || JSON.stringify(v));
      }
    } catch (e) {
      versionStr = 'N/A';
    }

    {
      const content = `**Online:** ${online}  \n**IP:** ${ip}:${port}  \n**Players:** ${players}/${maxPlayers}${server.roundtrip ? `  \n**Ping:** ${server.roundtrip}ms` : ''}  \n**Version:** ${versionStr}`;
      if (iconUrl) {
        const section = new SectionBuilder().setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl));
        section.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        container.addSectionComponents(section);
      } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
      }
    }
    if (server?.players?.sample && Array.isArray(server.players.sample)) {
      const list = server.players.sample.slice(0, 10).map(p => `• ${p.name || p}`).join('\n');
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Player Sample:**\n${list}`));
    }
  } else {
    const ip = ipinfo.query || ipinfo.ip || hostname;
    const country = ipinfo.country || ipinfo.countryCode || 'N/A';
    const isp = ipinfo.isp || ipinfo.org || 'N/A';
    const asn = ipinfo.as || ipinfo.asn || 'N/A';
    const city = ipinfo.city || ipinfo.regionName || ipinfo.region || 'N/A';
    const reverse = ipinfo.reverse || payload.reverse_dns || 'N/A';
    {
        const content = `**IP:** ${ip} ${countryFlag ? countryFlag + ' ' + countryCode : ''}  \n**City/Region:** ${city}  \n**ISP / Org:** ${isp}  \n**ASN:** ${asn}  \n**Reverse DNS:** ${reverse}`;
        if (iconUrl) {
          const section = new SectionBuilder().setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl));
          section.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
          container.addSectionComponents(section);
        } else {
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        }
    }
  }

  // Action buttons: primary API link + secondary if available (links) and controls (copy, refresh, delete)
  const primary = API_CANDIDATES[0]?.replace(/\/$/, '') + path;
  const secondary = API_CANDIDATES[1] ? API_CANDIDATES[1].replace(/\/$/, '') + path : null;

  const linksRow = new ActionRowBuilder();
  linksRow.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open (Primary API)').setURL(primary));
  if (secondary) linksRow.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open (Secondary)').setURL(secondary));
  // WHOIS / Details link for domains
  if (type === 'domain') linksRow.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('WHOIS').setURL(`https://whois.domaintools.com/${encodeURIComponent(hostname)}`));

  // Add a compact 'At a glance' text display for quick metadata
  const glanceParts = [];
  if (countryFlag) glanceParts.push(`${countryFlag}`);
  if (ipinfo.city) glanceParts.push(`${ipinfo.city}`);
  if (ipinfo.region) glanceParts.push(`${ipinfo.region}`);
  if (ipinfo.as || ipinfo.asn) glanceParts.push(`ASN:${ipinfo.as || ipinfo.asn}`);
  if (payload.ping) glanceParts.push(`Ping:${payload.ping}ms`);

  const glance = glanceParts.length ? glanceParts.join(' • ') : '';

  // Single Refresh control row (keep interactions focused)
  const refreshRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel('Refresh').setCustomId(`lookup_refresh:${type}:${hostname}`)
  );

  if (glance) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**At a glance:** ${glance}`));
  container.addSeparatorComponents(new SeparatorBuilder());
  appendCommandBanner(container);
  container.addActionRowComponents(linksRow).addActionRowComponents(refreshRow);
  return { container, attachment };
}

const linkCommand = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Verify your Discord account with CAPI using a verification code')
  .addStringOption(option => option.setName('code').setDescription('Verification code from the API').setRequired(true));

const unlinkCommand = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Request a Discord unlink for your CAPI account');

const planCommand = new SlashCommandBuilder()
  .setName('plan')
  .setDescription('Show your CAPI account profile and linked status');

// methods command removed — use in-API catalog or admin tools instead

const graphCommand = new SlashCommandBuilder()
  .setName('graph')
  .setDescription('Show live API and C2 slot statistics')
  .setDMPermission(true);

const statsCommand = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show network statistics summary');

const ongoingCommand = new SlashCommandBuilder()
  .setName('ongoing')
  .setDescription('Show global ongoing attacks summary');

const recentCommand = new SlashCommandBuilder()
  .setName('recent')
  .setDescription('Show your recent attacks (private)')
  .setDMPermission(true);

const adminCommand = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Admin user management commands')
  .addSubcommandGroup(group => group
    .setName('user')
    .setDescription('Manage users')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a new user')
      .addStringOption(option => option.setName('username').setDescription('Username').setRequired(true))
      .addStringOption(option => option.setName('password').setDescription('Password').setRequired(true))
      .addStringOption(option => option.setName('preset_option').setDescription('Preset option').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete an existing user')
      .addStringOption(option => option.setName('username_option').setDescription('Username').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Edit a user field')
      .addStringOption(option => option.setName('username_option').setDescription('Username').setRequired(true))
      .addStringOption(option => option.setName('field_option').setDescription('Field name').setRequired(true))
      .addStringOption(option => option.setName('newvalue_option').setDescription('New value for the field').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View details for a user')
      .addStringOption(option => option.setName('username_option').setDescription('Username').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('logs')
      .setDescription('Show logs for a user')
      .addStringOption(option => option.setName('username_option').setDescription('Username').setRequired(true))));

const ownerCommand = new SlashCommandBuilder()
  .setName('owner')
  .setDescription('Owner-level maintenance commands')
  .addSubcommandGroup(group => group
    .setName('logs')
    .setDescription('Owner log actions')
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete owner logs'))
    .addSubcommand(sub => sub
      .setName('search')
      .setDescription('Search owner logs by username')
      .addStringOption(option => option.setName('username_option').setDescription('Username to search').setRequired(true))))
  .addSubcommand(sub => sub
    .setName('reboot')
    .setDescription('Redeploy Wrangler and restart the bot'));

const attackCommand = new SlashCommandBuilder()
  .setName('attack')
  .setDescription('Launch an attack through CAPI')
  .setDMPermission(true)
  .addStringOption(option => option.setName('hostname').setDescription('Target host or IP').setRequired(true))
  .addStringOption(option => option.setName('port').setDescription('Target port').setRequired(true))
  .addStringOption(option => option.setName('time').setDescription('Attack duration in seconds').setRequired(true))
  .addStringOption(option => option.setName('method').setDescription('Attack method').setRequired(true).setAutocomplete(true));

const lookupCommand = new SlashCommandBuilder()
  .setName('lookup')
  .setDescription('Lookup server or host information')
  .addStringOption(option => option.setName('type').setDescription('Type of lookup').setRequired(true)
    .addChoices(
      { name: 'Minecraft (MC)', value: 'mc' },
      { name: 'FiveM (CFX)', value: 'cfx' },
      { name: 'Domain (DNS)', value: 'domain' },
      { name: 'IP', value: 'ip' }
    ))
  .addStringOption(option => option.setName('hostname').setDescription('Hostname, IP or identifier to lookup').setRequired(true));

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  const commands = [
    linkCommand.toJSON(),
    planCommand.toJSON(),
    unlinkCommand.toJSON(),
    lookupCommand.toJSON(),
    graphCommand.toJSON(),
    attackCommand.toJSON(),
    statsCommand.toJSON(),
    ongoingCommand.toJSON(),
    recentCommand.toJSON(),
    adminCommand.toJSON(),
    ownerCommand.toJSON()
  ];
  try {
    if (guildId) {
      // Clear any existing global commands to avoid duplicates (global + guild)
      try {
        await rest.put(Routes.applicationCommands(clientId), { body: [] });
        console.log('Cleared global slash commands.');
      } catch (e) {
        console.warn('Failed to clear global commands:', e?.message || e);
      }

      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log('Registered guild slash commands.');
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log('Registered global slash commands.');
    }
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
}

async function ensureRole(member, roleName) {
  const role = member.guild.roles.cache.find(r => r.name === roleName);
  if (!role) return null;
  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role);
  }
  return role;
}

async function postOrUpdateGraphStatusMessage() {
  const statusChannelId = process.env.DISCORD_STATUS_CHANNEL_ID;
  if (!statusChannelId) return;
  try {
    const channel = await client.channels.fetch(statusChannelId);
    if (!channel || typeof channel.send !== 'function') return;
    const stats = await fetchGraphStats();
    const container = buildGraphContainer(stats);
    if (graphStatusMessageId) {
      try {
        const existing = await channel.messages.fetch(graphStatusMessageId);
        await existing.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
      } catch (error) {
        graphStatusMessageId = null;
      }
    }
    const message = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
    graphStatusMessageId = message.id;
  } catch (error) {
    console.error('Failed to update graph status message:', error);
  }
}
client.once('ready', async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  await registerCommands();
  await updateStatus();
  await postOrUpdateGraphStatusMessage();
  startAttackUpdater();
  setInterval(updateStatus, 30_000);
  setInterval(postOrUpdateGraphStatusMessage, 60_000);
});

client.on('interactionCreate', async (interaction) => {
  try {
  if (interaction.isButton()) {
    if (interaction.customId === 'delete_plan_message' || interaction.customId === 'delete_attack_message') {
      try {
        await interaction.deferUpdate();
        if (interaction.message?.deletable) {
          await interaction.message.delete();
        }
      } catch (error) {
        console.error('Failed to delete message:', error);
      }
      return;
    }

    if (interaction.customId === 'plan_refresh') {
      try {
        await interaction.deferUpdate();
      } catch (error) {
        console.error('Failed to defer refresh interaction:', error);
      }
      return;
    }

    if (interaction.customId === 'attack_refresh') {
      const state = attackMessageState.get(interaction.message?.id);
      if (!state) {
        await interaction.update({ content: 'This attack card is no longer available.' });
        return;
      }

      const container = buildAttackContainer(state);
      attackMessageState.set(interaction.message.id, { ...state, lastRefreshedAt: Date.now(), channelId: interaction.message.channelId });
      await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    if (interaction.customId && interaction.customId.startsWith('attack_stop')) {
      // customId format: attack_stop:<attackId>
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch (e) {
        // ignore
      }
      const parts = interaction.customId.split(':');
      const attackId = parts[1] || null;
      const state = attackMessageState.get(interaction.message?.id) || null;
      const botKey = process.env.BOT_API_KEY;
      if (!botKey) {
        try { await interaction.editReply({ content: 'Server misconfigured: BOT_API_KEY is not set. Contact the server administrator.' }); } catch (e) {}
        return;
      }

      const member = interaction.member;
      const isAdmin = member?.roles?.cache?.some((role) => role.name?.toLowerCase() === 'admin') || Boolean(member?.permissions?.has?.(PermissionsBitField.Flags.Administrator));
      const isOwner = state?.discordUserId === interaction.user.id;
      if (!isAdmin && !isOwner) {
        try { await interaction.editReply({ content: 'Only the attack sender or an admin can stop this attack.' }); } catch (e) {}
        return;
      }

      if (!attackId && !state) {
        try { await interaction.editReply({ content: 'Unable to determine attack ID to stop.' }); } catch (e) {}
        return;
      }

      const idToStop = attackId || state.attackId || null;
      let stopUrl = `/api/stop?id=${encodeURIComponent(idToStop)}`;
      if (!idToStop && state?.targetLabel) {
        stopUrl = `/api/stop?host=${encodeURIComponent(state.targetLabel)}${state.owner ? `&username=${encodeURIComponent(state.owner)}` : ''}`;
      } else if (state?.owner) {
        stopUrl += `&username=${encodeURIComponent(state.owner)}`;
      }
      try {
        const res = await apiFetch(stopUrl, { method: 'GET', headers: { Authorization: `Bearer ${botKey}` } });
        const body = await res.json();
        if (body && body.error) {
          await interaction.editReply({ content: `Stop request failed: ${body.message || 'unknown error'}` });
          return;
        }

        // Update local state to mark as stopped
        if (state) {
          const elapsed = Math.max(0, Math.floor((Date.now() - (state.startTime || Date.now())) / 1000));
          state.durationSeconds = elapsed; // mark as finished
          state.stoppedBy = interaction.user.username;
          attackMessageState.set(interaction.message.id, { ...state, channelId: interaction.message.channelId });
          const container = buildAttackContainer(state);
          try {
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
          } catch (e) {
            try { await interaction.followUp({ content: 'Attack stopped. (UI update failed)', ephemeral: true }); } catch (e) {}
          }
        }

        await interaction.editReply({ content: `Stop requested for attack ${idToStop || state?.targetLabel || 'unknown target'}.` });
      } catch (err) {
        console.error('Attack stop failed:', err);
        try { await interaction.editReply({ content: `Stop request failed: ${err?.message || 'error'}` }); } catch (e) {}
      }
      return;
    }

    // attack_copy handler removed (ID and copy button no longer present)

    if (interaction.customId === 'graph_refresh') {
      const stats = await fetchGraphStats();
      const container = buildGraphContainer(stats);
      await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }

    if (interaction.customId && interaction.customId.startsWith('lookup_refresh')) {
      // customId format: lookup_refresh:<type>:<hostname>
      try {
        await interaction.deferUpdate();
      } catch (e) {
        // continue
      }
      const parts = interaction.customId.split(':');
      const type = parts[1] || 'ip';
      const hostname = parts.slice(2).join(':') || '';
      try {
        let path = '';
        if (type === 'cfx') path = `/lookup/lookup_cfx?cfx_code=${encodeURIComponent(hostname)}`;
        else if (type === 'mc') path = `/lookup/lookup_mc?server_address=${encodeURIComponent(hostname)}`;
        else path = `/lookup/lookup_ip?server_address=${encodeURIComponent(hostname)}`;

        const res = await apiFetch(path);
        const payload = await res.json();
        if (payload.error) {
          await interaction.editReply({ content: `Lookup failed: ${payload.message || 'unknown error'}`, flags: MessageFlags.Ephemeral });
          return;
        }

        const { container, attachment } = buildLookupContainer(type, hostname, payload, path);
        try {
          console.log('Lookup container (refresh) JSON:', JSON.stringify(container.toJSON()));
        } catch (err) {
          console.error('Failed to serialize lookup container (refresh):', err);
        }
        // Update the original message components; attach favicon if provided
        try {
          if (attachment) {
            await interaction.editReply({ components: [container], files: [{ attachment: attachment.buffer, name: attachment.name }], flags: MessageFlags.IsComponentsV2 });
          } else {
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }
        } catch (e) {
          // Fallback to update message if editReply not available
          if (attachment) {
            await interaction.update({ components: [container], files: [{ attachment: attachment.buffer, name: attachment.name }], flags: MessageFlags.IsComponentsV2 });
          } else {
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }
        }
      } catch (error) {
        console.error('Lookup refresh failed:', error);
        try {
          await interaction.editReply({ content: `Lookup failed: ${error.message || 'error'}` });
        } catch (e) {
          await interaction.update({ content: `Lookup failed: ${error.message || 'error'}` });
        }
      }
      return;
    }

    return;
  }

  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'attack') {
      const focused = interaction.options.getFocused();
      const methods = await fetchMethodNames();
      const choices = methods
        .filter((name) => name.toLowerCase().startsWith(String(focused || '').toLowerCase()))
        .slice(0, 25)
        .map((name) => ({ name, value: name }));
      await interaction.respond(choices);
      return;
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const discordUserId = interaction.user.id;
  const discordUsername = interaction.user.username;

  if (interaction.commandName === 'link') {
    const code = interaction.options.getString('code');
    const response = await apiFetch(`/api/link?code=${encodeURIComponent(code)}&discord_user_id=${encodeURIComponent(discordUserId)}&discord_username=${encodeURIComponent(discordUsername)}&client=discord`);
    const payload = await response.json();

    if (payload.error) {
      await interaction.reply({ content: `Verification failed: ${payload.message}`, ephemeral: true });
      return;
    }

    const guild = interaction.guild;
    if (guild) {
      try {
        const member = await guild.members.fetch(discordUserId);
        const rolesToAdd = payload.roles || [];
        const assigned = [];
        for (const roleName of rolesToAdd) {
          const role = await ensureRole(member, roleName);
          if (role) assigned.push(role.name);
        }
        await interaction.reply({ content: `Verified ${payload.username}! Roles assigned: ${assigned.join(', ') || 'none'}.`, ephemeral: true });
        return;
      } catch (err) {
        console.error('Role assign failed:', err);
      }
    }

    await interaction.reply({ content: `Verified ${payload.username}! Use the code on the API side if role assignment did not apply.`, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'plan') {
    const response = await apiFetch(`/api/discord_profile?discord_user_id=${encodeURIComponent(discordUserId)}`);
    const payload = await response.json();
    if (payload.error) {
      const message = payload.message || 'Unable to load profile. Use /link to verify first.';
      await interaction.reply({ content: message, ephemeral: true });
      return;
    }

    const profile = payload.data.profile;
    const expiry = profile.expiry_unix ? new Date(Number(profile.expiry_unix)).toLocaleString('en-GB', { timeZone: 'UTC' }) : 'Never';
    const boolLabel = (value) => (value ? 'Yes' : 'No');
    const statusColor = profile.is_banned ? 0xE74C3C : profile.account_status === 'at_limit' ? 0xF39C12 : 0x2ECC71;
    const linkedText = profile.discord_link.linked ? 'Yes' : 'No';

    const container = new ContainerBuilder()
      .setAccentColor(statusColor)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 📜 Your Plan Details')
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('> *Don\'t share your plan details with others!*')
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addSectionComponents(
        new SectionBuilder()
          .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**Username:** ${profile.username}\n` +
              `**Cooldown:** ${profile.cooldown}s\n` +
              `**Max Daily Attacks:** ${profile.max_daily_attacks}\n` +
              `**Max Concurrent Attacks:** ${profile.max_concurrents}`
            )
          )
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**VIP:** ${boolLabel(profile.vip)}\n` +
          `**Reseller:** ${boolLabel(profile.reseller)}\n` +
          `**Admin:** ${boolLabel(profile.admin)}\n\n` +
          `**Discord Link:** ${linkedText}\n` +
          `**Suspended:** ${boolLabel(profile.is_banned)}\n` +
          `**Expiry:** ${expiry}`
        )
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('CapySploit • Plan Panel • WIP • Stay Tuned')
      );
    appendCommandBanner(container);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel('View API')
          .setURL(`${apiBaseUrl}/api/view_profile?username=${encodeURIComponent(profile.username)}`),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Refresh')
          .setCustomId('plan_refresh'),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Danger)
          .setLabel('Delete Message')
          .setCustomId('delete_plan_message')
      )
    );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === 'lookup') {
    const type = interaction.options.getString('type');
    const hostname = interaction.options.getString('hostname');
    await interaction.deferReply({ ephemeral: true });
    try {
      let path = '';
      if (type === 'cfx') path = `/lookup/lookup_cfx?cfx_code=${encodeURIComponent(hostname)}`;
      else if (type === 'mc') path = `/lookup/lookup_mc?server_address=${encodeURIComponent(hostname)}`;
      else if (type === 'domain' || type === 'ip') path = `/lookup/lookup_ip?server_address=${encodeURIComponent(hostname)}`;
      else path = `/lookup/lookup_ip?server_address=${encodeURIComponent(hostname)}`;

      const apiLink = apiBaseUrl.replace(/\/$/, '') + path;
      const res = await apiFetch(path);
      const payload = await res.json();
      if (payload.error) {
        await interaction.editReply({ content: `Lookup failed: ${payload.message || 'unknown error'}` });
        return;
      }

      const { container, attachment } = buildLookupContainer(type, hostname, payload, path);
      try {
        console.log('Lookup container (initial) JSON:', JSON.stringify(container.toJSON()));
      } catch (err) {
        console.error('Failed to serialize lookup container (initial):', err);
      }
      if (attachment) {
        await interaction.editReply({ components: [container], files: [{ attachment: attachment.buffer, name: attachment.name }], flags: MessageFlags.IsComponentsV2 });
      } else {
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      }
      return;
    } catch (error) {
      console.error('Lookup command failed:', error);
      await interaction.editReply({ content: `Lookup failed: ${error.message || 'error'}` });
      return;
    }
  }

  if (interaction.commandName === 'graph') {
    const stats = await fetchGraphStats();
    const container = buildGraphContainer(stats);
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === 'stats') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const res = await apiFetch('/api/network_statistics');
      const body = await res.json();
      if (body.error) return await interaction.editReply({ content: `Failed to load stats: ${body.message || 'unknown'}` });
      const cont = buildStatsContainer(body);
      await interaction.editReply({ components: [cont], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    } catch (err) {
      console.error('Stats command failed:', err);
      await interaction.editReply({ content: `Failed to load stats: ${err?.message || 'error'}` });
    }
    return;
  }

  if (interaction.commandName === 'ongoing') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const res = await apiFetch('/api/network_statistics');
      const body = await res.json();
      if (body.error) return await interaction.editReply({ content: `Failed to load ongoing: ${body.message || 'unknown'}` });
      const cont = buildOngoingContainer(body);
      await interaction.editReply({ components: [cont], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    } catch (err) {
      console.error('Ongoing command failed:', err);
      await interaction.editReply({ content: `Failed to load ongoing attacks: ${err?.message || 'error'}` });
    }
    return;
  }

  if (interaction.commandName === 'recent') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const discordId = interaction.user.id;
      const botKey = process.env.BOT_API_KEY;
      const profileHeaders = botKey ? { Authorization: `Bearer ${botKey}` } : {};
      const profileRes = await apiFetch(`/api/discord_profile?discord_user_id=${encodeURIComponent(discordId)}`, { headers: profileHeaders });
      const profileBody = await profileRes.json();
      if (profileBody.error) return await interaction.editReply({ content: `No linked profile: ${profileBody.message || 'link your account with /link'}` });
      const username = profileBody.data?.profile?.username || 'unknown';
      const headers = botKey ? { Authorization: `Bearer ${botKey}` } : {};
      const ongoingRes = await apiFetch(`/api/view_ongoing?discord_user_id=${encodeURIComponent(discordId)}`, { headers });
      const ongoingBody = await ongoingRes.json();
      if (ongoingBody.error) return await interaction.editReply({ content: `Failed to fetch recent attacks: ${ongoingBody.message || 'unknown'}` });
      const list = ongoingBody.ongoing || ongoingBody.recent || [];
      const cont = buildRecentContainer(username, list);
      await interaction.editReply({ components: [cont], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    } catch (err) {
      console.error('Recent command failed:', err);
      await interaction.editReply({ content: `Failed to fetch recent attacks: ${err?.message || 'error'}` });
    }
    return;
  }

  if (interaction.commandName === 'admin') {
    await interaction.deferReply({ ephemeral: true });
    try {
      if (!isDiscordAdmin(interaction) && !isDiscordOwner(interaction)) {
        await interaction.editReply({ content: 'Admin commands are restricted to admins and owners.' });
        return;
      }
      const subGroup = interaction.options.getSubcommandGroup(false);
      const action = interaction.options.getSubcommand();
      const username = interaction.options.getString('username') || interaction.options.getString('username_option');
      const password = interaction.options.getString('password');
      const preset = interaction.options.getString('preset_option');
      const field = interaction.options.getString('field_option');
      const newValue = interaction.options.getString('newvalue_option');

      if (subGroup === 'user') {
        if (action === 'create') {
          const res = await apiFetch(`/api/admin/user_create?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&preset_option=${encodeURIComponent(preset)}`);
          const body = await res.json();
          if (body.error) return await interaction.editReply({ content: `Create failed: ${body.message || 'unknown'}` });
          const container = buildAdminActionContainer('## 🛠️ Admin User Create', `Created user **${username}** successfully.`, [`Preset: ${preset}`]);
          await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
          return;
        }
        if (action === 'delete') {
          const res = await apiFetch(`/api/admin/user_delete?username=${encodeURIComponent(username)}`);
          const body = await res.json();
          if (body.error) return await interaction.editReply({ content: `Delete failed: ${body.message || 'unknown'}` });
          const container = buildAdminActionContainer('## 🛠️ Admin User Delete', `Deleted user **${username}** successfully.`);
          await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
          return;
        }
        if (action === 'edit') {
          const res = await apiFetch(`/api/admin/user_edit?username=${encodeURIComponent(username)}&field=${encodeURIComponent(field)}&value=${encodeURIComponent(newValue)}`);
          const body = await res.json();
          if (body.error) return await interaction.editReply({ content: `Edit failed: ${body.message || 'unknown'}` });
          const container = buildAdminActionContainer('## 🛠️ Admin User Edit', `Updated **${field}** for **${username}**.`, [`New value: ${newValue}`]);
          await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
          return;
        }
        if (action === 'view') {
          const res = await apiFetch(`/api/admin/user_view?username=${encodeURIComponent(username)}`);
          const body = await res.json();
          if (body.error) return await interaction.editReply({ content: `View failed: ${body.message || 'unknown'}` });
          const infoLines = Object.entries(body.data || {}).map(([key, value]) => `**${key}:** ${value}`);
          const container = buildInfoContainer(`## 🛠️ Admin User View: ${username}`, `Details for user **${username}**`, infoLines);
          await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
          return;
        }
        if (action === 'logs') {
          const res = await apiFetch(`/api/admin/user_logs?username=${encodeURIComponent(username)}`);
          const body = await res.json();
          if (body.error) return await interaction.editReply({ content: `Logs failed: ${body.message || 'unknown'}` });
          const lines = (body.data?.logs || []).slice(0, 8).map((logEntry, index) => `**${index + 1}.** ${logEntry}`);
          if (!lines.length) lines.push('No logs available.');
          const container = buildInfoContainer(`## 🛠️ Admin User Logs: ${username}`, `Latest logs for **${username}**`, lines);
          await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
          return;
        }
      }
      await interaction.editReply({ content: 'Unknown admin command.' });
    } catch (err) {
      console.error('Admin command failed:', err);
      await interaction.editReply({ content: `Admin command failed: ${err?.message || 'error'}` });
    }
    return;
  }

  if (interaction.commandName === 'owner') {
    await interaction.deferReply({ ephemeral: true });
    try {
      if (!isDiscordOwner(interaction)) {
        await interaction.editReply({ content: 'Owner commands are restricted to the configured owner.' });
        return;
      }
      const action = interaction.options.getSubcommand();
      if (action === 'reboot') {
        await interaction.editReply({ content: 'Starting reboot: deploying and restarting the bot...' });
        try {
          exec('cd /var/www/CAPI && wrangler deploy', (error, stdout, stderr) => {
            if (error) {
              console.error('Reboot deploy failed:', error, stderr);
              return;
            }
            console.log('Reboot deploy output:', stdout, stderr);
            process.exit(0);
          });
        } catch (err) {
          console.error('Reboot command failed:', err);
        }
        return;
      }
      if (interaction.options.getSubcommandGroup() === 'logs') {
        const logAction = interaction.options.getSubcommand();
        const username = interaction.options.getString('username_option');
        if (logAction === 'delete') {
          const res = await apiFetch(`/api/owner/logs_delete`);
          const body = await res.json();
          if (body.error) return await interaction.editReply({ content: `Owner log delete failed: ${body.message || 'unknown'}` });
          const container = buildInfoContainer('## 🔐 Owner Logs Delete', 'Owner logs deleted successfully.', []);
          await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
          return;
        }
        if (logAction === 'search') {
          const res = await apiFetch(`/api/owner/logs_search?username=${encodeURIComponent(username)}`);
          const body = await res.json();
          if (body.error) return await interaction.editReply({ content: `Owner log search failed: ${body.message || 'unknown'}` });
          const lines = (body.data?.logs || []).slice(0, 8).map((logEntry, index) => `**${index + 1}.** ${logEntry}`);
          if (!lines.length) lines.push('No matching owner logs found.');
          const container = buildInfoContainer('## 🔐 Owner Log Search', `Search results for **${username}**`, lines);
          await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
          return;
        }
      }
      await interaction.editReply({ content: 'Unknown owner command.' });
    } catch (err) {
      console.error('Owner command failed:', err);
      await interaction.editReply({ content: `Owner command failed: ${err?.message || 'error'}` });
    }
    return;
  }

  // methods command removed

  if (interaction.commandName === 'attack') {
    const host = interaction.options.getString('hostname');
    const port = interaction.options.getString('port');
    const time = interaction.options.getString('time');
    const method = interaction.options.getString('method');

    console.log('Received /attack', { user: discordUserId, host, port, time, method });

    // Defer the reply to avoid interaction timeout while we call the API
    try {
      await interaction.deferReply();
      console.log('Deferred reply for /attack');
    } catch (e) {
      console.warn('deferReply failed (already deferred?):', e?.message || e);
    }

    // Add an AbortController timeout for profile fetch to avoid indefinite waiting
    const profileController = new AbortController();
    const profileTimeout = setTimeout(() => profileController.abort(), 8000);
    let profilePayload;
    try {
      console.log('Fetching profile for', discordUserId);
      const profileResponse = await apiFetch(`/api/discord_profile?discord_user_id=${encodeURIComponent(discordUserId)}`, { signal: profileController.signal });
      profilePayload = await profileResponse.json();
      console.log('Profile payload received', { ok: !profilePayload.error });
    } catch (err) {
      clearTimeout(profileTimeout);
      console.error('Profile fetch failed or timed out:', err?.message || err);
      try { await interaction.editReply({ content: 'Failed to verify profile: API request timed out or failed.' }); } catch (e) {}
      return;
    }
    clearTimeout(profileTimeout);
    if (profilePayload.error) {
      await interaction.editReply({ content: profilePayload.message || 'You must link your Discord account before launching an attack. Use /link first.' });
      return;
    }

    const profile = profilePayload.data.profile;
    if (!profile.api_access) {
      await interaction.editReply({ content: 'Your account does not have API access enabled.' });
      return;
    }

    const username = profile.username;
    const password = profile.password || '';
    // Timeout the attack request after 15s to avoid long 'thinking' states
    const attackController = new AbortController();
    const attackTimeout = setTimeout(() => attackController.abort(), 15000);
    let payload;
    try {
      console.log('Sending attack request to API for', username);
      const url = `/api/attack?discord_user_id=${encodeURIComponent(discordUserId)}&host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&time=${encodeURIComponent(time)}&method=${encodeURIComponent(method)}`;
      const botKey = process.env.BOT_API_KEY;
      if (!botKey) {
        await interaction.editReply({ content: 'Server misconfigured: BOT_API_KEY is not set. Please contact the server administrator to configure the bot.' });
        return;
      }
      const headers = { Authorization: `Bearer ${botKey}` };
      const response = await apiFetch(url, { signal: attackController.signal, headers });
      payload = await response.json();
      console.log('Attack API response received', { error: Boolean(payload?.error), payload });
    } catch (err) {
      clearTimeout(attackTimeout);
      console.error('Attack request failed or timed out:', err?.message || err);
      try { await interaction.editReply({ content: 'Attack request failed or timed out. Please try again later.' }); } catch (e) {}
      return;
    }
    clearTimeout(attackTimeout);
    if (payload.error) {
      const hint = payload.hint ? ` ${payload.hint}` : '';
      await interaction.editReply({ content: `Attack failed: ${payload.message || 'unknown error'}.${hint}` });
      return;
    }

    const attackDetails = payload.data || {};
    const methodLabel = attackDetails.Method_Used || method;
    const targetLabel = attackDetails.Target || host;
    const durationSeconds = Number(attackDetails.Time_Used || time || 0);
    const attackState = {
      host,
      port,
      time: String(durationSeconds),
      method,
      methodLabel,
      targetLabel,
      durationSeconds,
      startTime: Date.now(),
      maxConcurrents: profile.max_concurrents ?? 'N/A',
      apiSlots: attackDetails.Global_API_Slots ?? 'N/A',
      vip: Boolean(attackDetails.Vip_Status || attackDetails.Vip || profile.vip),
      holder: Boolean(attackDetails.Holder_Status || attackDetails.Holder || profile.holder),
      admin: Boolean(attackDetails.Admin_Status || attackDetails.Admin || profile.admin),
      attacksRemaining: Number(attackDetails.Attacks_Remaining || 0),
      methodMaxSlots: Number(attackDetails.Method_Max_Slots || 0),
      methodActiveSlots: Number(attackDetails.Method_Active_Slots || 0),
      cooldown: Number(attackDetails.Cooldown || attackDetails.cooldown || attackDetails.cooldown_seconds || attackDetails.CooldownSeconds || 0),
      targetCountry: attackDetails.target_country || attackDetails.target_country_code || null,
      targetCity: attackDetails.target_city || null,
      targetOrg: attackDetails.target_org || attackDetails.targetOrg || attackDetails.organisation || attackDetails.org || attackDetails.Organization || attackDetails.Organization_Name || attackDetails.ORG || attackDetails.Org || attackDetails.provider || null,
      targetIsp: attackDetails.target_isp || attackDetails.targetIsp || null,
      owner: profile.username || null,
      discordUserId: discordUserId,
      ownerAvatar: interaction.user?.displayAvatarURL ? interaction.user.displayAvatarURL({ extension: 'png', size: 256 }) : null,
      attackId: attackDetails.attack_id || attackDetails.id || attackDetails.attackID || attackDetails.attackId || attackDetails.request_id || attackDetails.requestId || attackDetails.uuid || attackDetails.hash || null,
      id: attackDetails.attack_id || attackDetails.id || attackDetails.attackID || attackDetails.attackId || attackDetails.request_id || attackDetails.requestId || attackDetails.uuid || attackDetails.hash || null,
      localId: (attackDetails.attack_id || attackDetails.id || attackDetails.attackID || attackDetails.attackId || attackDetails.request_id || attackDetails.requestId || attackDetails.uuid || attackDetails.hash) ? null : `tmp-${Math.floor(Date.now()/1000).toString(36)}`
    };

    let container = buildAttackContainer(attackState);
    let serializationFailed = false;
    try {
      console.log('Attack container JSON:', JSON.stringify(container.toJSON()));
    } catch (e) {
      serializationFailed = true;
      console.error('Failed to serialize attack container (will use minimal fallback):', e);
    }

      if (serializationFailed) {
        // Build a minimal container fallback to ensure we can send Components V2
        const minimal = new ContainerBuilder()
          .setAccentColor(0x3498DB)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ⚔️ Attack • ${attackState.targetLabel || host}`))
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Method:** ${attackState.methodLabel || method} • **Time:** ${attackState.durationSeconds || time}s`));
        appendCommandBanner(minimal);
        const actions = new ActionRowBuilder();
        if (attackState.attackId) actions.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('View (API)').setURL(`${API_CANDIDATES[0].replace(/\/$/, '')}/api/attack_status?id=${encodeURIComponent(attackState.attackId)}`));
        actions.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel('Refresh').setCustomId('attack_refresh'));
        const stopBtn = new ButtonBuilder().setStyle(ButtonStyle.Danger).setLabel('Stop').setCustomId(`attack_stop:${attackState.attackId || ''}`).setEmoji({ name: '👻' });
        actions.addComponents(stopBtn);
        minimal.addActionRowComponents(actions);
        container = minimal;
      }

    try {
      const sent = await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      console.log('Edited reply with attack container', { messageId: sent?.id });
      if (sent?.id) attackMessageState.set(sent.id, { ...attackState, channelId: sent.channelId, messageId: sent.id });
    } catch (err) {
      console.error('Failed to editReply for attack (final):', err?.message || err, err);
      // Fallback: send a minimal components V2 follow-up to avoid plain text
      try {
        const minimalFollow = new ContainerBuilder()
          .setAccentColor(0x3498DB)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Attack accepted: ${attackState.targetLabel || host} • ${attackState.methodLabel || method} • ${attackState.durationSeconds || time}s`));
        appendCommandBanner(minimalFollow);
        minimalFollow.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel('Refresh').setCustomId('attack_refresh')));
        await interaction.followUp({ components: [minimalFollow], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      } catch (e) {
        console.error('Failed fallback followUp (components):', e);
        // Last resort: plain text follow-up
        try { await interaction.followUp({ content: `Attack accepted: ${attackState.targetLabel || host}:${port} • ${attackState.methodLabel || method} • ${attackState.durationSeconds || time}s`, ephemeral: true }); } catch (e) { console.error('Failed final text followUp:', e); }
      }
    }
    return;
  }

  if (interaction.commandName === 'unlink') {
    const response = await apiFetch(`/api/unlink?discord_user_id=${encodeURIComponent(discordUserId)}`);
    const payload = await response.json();
    if (payload.error) {
      await interaction.reply({ content: payload.message || 'Unable to unlink your Discord account.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: `Your Discord account has been unlinked from CAPI. You can now run /link again with a new verification code.`, ephemeral: true });
    return;
  }

  return;
  } catch (err) {
    console.error('Unhandled interaction handler error:', err);
    try {
      if (!interaction) return;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Internal error handling your command. Please try again later.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'Internal error handling your command. Please try again later.', ephemeral: true });
      }
    } catch (replyErr) {
      console.error('Failed to send error response for interaction:', replyErr);
      try {
        if (interaction.channel && typeof interaction.channel.send === 'function') {
          await interaction.channel.send('Bot encountered an error. Please try again later.');
        }
      } catch (e) {
        console.error('Failed to fallback send message after interaction error:', e);
      }
    }
  }
});

console.log('Starting Discord bot...');
client.login(token).catch((error) => {
  console.error('Failed to login Discord bot:', error);
  process.exit(1);
});
