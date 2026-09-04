import { jsonResponse } from './response.js';
import { handleRequest } from './orchestrator.js';
import * as Vault from './vault-db.js';
import { resolveApiMessage } from './config.js';

export default {
  async fetch(request, env, ctx) {
    try {
      const pathname = new URL(request.url).pathname;
      const isBackendRoute = pathname === '/health'
        || pathname.startsWith('/api/')
        || pathname.startsWith('/admin/')
        || pathname.startsWith('/lookup/')
        || pathname.startsWith('/discord/')
        || pathname.startsWith('/interactions/');
      if (!isBackendRoute && env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return await handleRequest(request, env, ctx);
    } catch (e) {
      console.error('Worker request failed:', e);
      return jsonResponse({
        error: true,
        message: resolveApiMessage('generic_error', 'request failed'),
        hint: 'An unexpected error occurred. If this persists, contact support.'
      }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      const cleanupSetting = await Vault.getSystemSetting(env, 'auto_cleanup_enabled');
      if (cleanupSetting?.value === 'false') return;
      await Vault.cleanupOngoing(env);
    })());
  }
};
