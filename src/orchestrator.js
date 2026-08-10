// Main request router for API, admin, and lookup endpoints.
import { jsonResponse, routeNotFound } from './response.js';
import * as Vault from './vault-db.js';
import { apiHandler } from './api.js';
import { adminHandler } from './admin.js';
import { lookupHandler } from './lookup.js';

async function seedRootUser(env) {
  const DBref = Vault.getDB(env);
  const rootUser = env.ROOT_USER || env.CAPI_ROOT_USER || 'root';
  const rootPass = env.ROOT_PASS || env.CAPI_ROOT_PASS || 'admin123';
  if (!DBref) return;
  const users = await Vault.listUsers(env);
  if (!users || users.length === 0) {
    await Vault.saveUser(env, { username: rootUser, password: rootPass, admin: 1, reseller: 0, vip: 1, holder: 1, api_access: 1, max_time: 500, cooldown: 10, concurrents: 3, max_daily_attacks: 1000, created_by: rootUser, expiry_unix: 0 });
  }
}

export async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/+/g, '').replace(/\/+$/g, '');

  if (path === '' || path === 'health') {
    const serviceName = env.API_NAME || 'CAPI';
    return jsonResponse({
      name: serviceName,
      version: env.API_VERSION || '1.0.0',
      status: 'ok',
      uptime: 'online',
      timestamp: new Date().toISOString(),
      service: serviceName,
      description: 'CAPI / CapySploit control plane with attack routing, admin controls, and lookup helpers.',
      endpoints: {
        api: '/api/<action>',
        admin: '/admin/<action>',
        lookup: '/lookup/<type>'
      },
      available_actions: ['view_profile', 'view_plan', 'attack', 'view_ongoing', 'network_statistics', 'list_methods', 'syntax_check']
    }, 200, { service: serviceName });
  }

  const parts = path.split('/');

  await Vault.ensureTables(env);
  await seedRootUser(env);

  if (parts[0] === 'api') return apiHandler(parts.slice(1), request, env);
  if (parts[0] === 'admin') return adminHandler(parts.slice(1), request, env);
  if (parts[0] === 'lookup') return lookupHandler(parts.slice(1), request, env);
  if (parts[0] === 'discord' || parts[0] === 'interactions') {
    const { handleDiscordInteraction, registerDiscordCommand } = await import('./discord-interactions.js');
    if (parts[0] === 'discord' && parts[1] === 'register') {
      return await registerDiscordCommand(request, env);
    }
    return await handleDiscordInteraction(request, env);
  }

  return routeNotFound(path);
}

export {};
