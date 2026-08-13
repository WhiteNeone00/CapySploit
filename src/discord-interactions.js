import { jsonResponse } from './response.js';
import * as Vault from './vault-db.js';
import { buildDiscordRoleNames } from './discord.js';
import { APP_DEFAULTS } from './config.js';

function hexToUint8Array(hex) {
  const clean = String(hex).trim();
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

async function importDiscordPublicKey(publicKey) {
  const keyData = hexToUint8Array(publicKey);
  const algorithms = [
    { name: 'NODE-ED25519' },
    { name: 'ED25519' }
  ];

  for (const alg of algorithms) {
    try {
      return await crypto.subtle.importKey('raw', keyData, alg, false, ['verify']);
    } catch (error) {
      // try next algorithm
    }
  }
  throw new Error('Unable to import Discord public key for Ed25519 verification');
}

async function verifyDiscordRequest(body, signature, timestamp, publicKey) {
  try {
    const sigData = hexToUint8Array(signature);
    const key = await importDiscordPublicKey(publicKey);
    const verifyData = new TextEncoder().encode(timestamp + body);
    return await crypto.subtle.verify(key.algorithm, key, sigData, verifyData);
  } catch (err) {
    console.error('Discord request verification failed:', err);
    return false;
  }
}

async function fetchGuildRoles(guildId, botToken) {
  const res = await fetch(`${APP_DEFAULTS.DISCORD_API_BASE_URL}/guilds/${guildId}/roles`, {
    method: 'GET',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch guild roles: ${res.status} ${text}`);
  }
  return await res.json();
}

async function assignRoleToMember(guildId, memberId, roleId, botToken) {
  const res = await fetch(`${APP_DEFAULTS.DISCORD_API_BASE_URL}/guilds/${guildId}/members/${memberId}/roles/${roleId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to assign role ${roleId}: ${res.status} ${text}`);
  }
  return true;
}

function buildInteractionResponse(content, ephemeral = false, embed = null) {
  const data = { flags: ephemeral ? 64 : 0 };
  if (content !== null && content !== undefined) data.content = content;
  if (embed) data.embeds = [embed];
  return new Response(JSON.stringify({
    type: 4,
    data
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function registerDiscordCommand(request, env) {
  const botToken = env.DISCORD_BOT_TOKEN;
  const clientId = env.DISCORD_CLIENT_ID;
  const guildId = env.DISCORD_GUILD_ID;

  if (!botToken || !clientId || !guildId) {
    return jsonResponse({ error: true, message: 'Discord registration is not configured. Set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID.' }, 500);
  }

  const url = `${APP_DEFAULTS.DISCORD_API_BASE_URL}/applications/${clientId}/guilds/${guildId}/commands`;
  const body = JSON.stringify({
    name: 'link',
    type: 1,
    description: 'Verify your Discord account with a CAPI verification code',
    options: [
      {
        name: 'code',
        description: 'Verification code from the CAPI API',
        type: 3,
        required: true
      }
    ]
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    return jsonResponse({ error: true, message: 'Failed to register Discord command', status: res.status, detail: text }, res.status);
  }

  const payload = await res.json();
  return jsonResponse({ error: false, message: 'Discord command registered successfully', command: payload });
}

export async function handleDiscordInteraction(request, env) {
  const publicKey = env.DISCORD_PUBLIC_KEY;
  const botToken = env.DISCORD_BOT_TOKEN;
  const guildId = env.DISCORD_GUILD_ID;

  if (request.method === 'GET') {
    return jsonResponse({
      error: false,
      message: 'Discord interaction endpoint is reachable. POST Discord interactions with signature headers to this route.',
      require: ['x-signature-ed25519', 'x-signature-timestamp']
    }, 200);
  }

  if (!publicKey || !botToken || !guildId) {
    return jsonResponse({ error: true, message: 'Discord integration not configured properly' }, 500);
  }

  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  if (!signature || !timestamp) {
    return new Response('Missing Discord signature headers', { status: 401 });
  }

  const bodyText = await request.text();
  const valid = await verifyDiscordRequest(bodyText, signature, timestamp, publicKey);
  if (!valid) {
    return new Response('Invalid request signature', { status: 401 });
  }

  const payload = JSON.parse(bodyText);
  if (payload.type === 1) {
    return new Response(JSON.stringify({ type: 1 }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (payload.type === 2 && payload.data?.name === 'link') {
    const code = payload.data.options?.find((option) => option.name === 'code')?.value;
    const discordUserId = payload.member?.user?.id || payload.user?.id;

    if (!code || !discordUserId) {
      return buildInteractionResponse(null, false, {
        title: 'Verification failed',
        description: 'A verification code is required for this command.',
        color: 0xff0000
      });
    }

    const requestRow = await Vault.getDiscordLinkByCode(env, code);
    if (!requestRow || requestRow.client !== 'discord') {
      return buildInteractionResponse(null, false, {
        title: 'Verification failed',
        description: 'Invalid or expired verification code.',
        color: 0xff0000
      });
    }
    if (requestRow.status === 'verified') {
      return buildInteractionResponse(null, false, {
        title: 'Verification failed',
        description: 'This code has already been used.',
        color: 0xff0000
      });
    }
    if (new Date() > new Date(requestRow.expires_at)) {
      return buildInteractionResponse(null, false, {
        title: 'Verification failed',
        description: 'Verification code expired. Generate a new one and try again.',
        color: 0xff0000
      });
    }

    const discordUsername = payload.member?.user?.username || payload.user?.username || null;
    const verifiedRow = await Vault.verifyDiscordLinkCode(env, code, discordUserId, discordUsername);
    if (!verifiedRow) {
      return buildInteractionResponse(null, false, {
        title: 'Verification failed',
        description: 'Failed to verify the code.',
        color: 0xff0000
      });
    }

    const linkedUser = await Vault.getUser(env, verifiedRow.username);
    if (!linkedUser) {
      return buildInteractionResponse(null, false, {
        title: 'Verification failed',
        description: 'Linked user account no longer exists.',
        color: 0xff0000
      });
    }

    const roleNames = buildDiscordRoleNames(linkedUser, env);
    let rolesAssigned = [];
    let rolesMissing = [];
    try {
      const guildRoles = await fetchGuildRoles(guildId, botToken);
      for (const roleName of roleNames) {
        const role = guildRoles.find((item) => item.name === roleName);
        if (!role) {
          rolesMissing.push(roleName);
          continue;
        }
        await assignRoleToMember(guildId, discordUserId, role.id, botToken);
        rolesAssigned.push(role.name);
      }
    } catch (err) {
      console.error('Discord role assign error:', err);
      return buildInteractionResponse(null, false, {
        title: 'Verification succeeded',
        description: 'Verified your account, but failed to assign Discord roles.',
        color: 0xffff00
      });
    }

    const assignedText = rolesAssigned.length ? `Roles assigned: ${rolesAssigned.join(', ')}.` : 'No matching Discord roles were found to assign.';
    const missingText = rolesMissing.length ? ` Missing roles: ${rolesMissing.join(', ')}.` : '';
    return buildInteractionResponse(null, false, {
      title: 'Discord verification complete',
      description: `Verified **${linkedUser.username}** (${linkedUser.username}) with Discord user <@${discordUserId}>. ${assignedText}${missingText}`,
      color: 0x00ff00,
      fields: [
        { name: 'Discord ID', value: discordUserId, inline: true },
        { name: 'Discord user', value: linkedUser.username, inline: true },
        { name: 'Verified at', value: verifiedRow.verified_at || new Date().toISOString(), inline: false }
      ]
    });
  }

  return buildInteractionResponse(null, false, {
    title: 'Unsupported interaction',
    description: 'This Discord interaction is not supported by the current command handler.',
    color: 0xffcc00
  });
}
