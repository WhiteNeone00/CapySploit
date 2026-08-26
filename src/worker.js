import { jsonResponse } from './response.js';
import { handleRequest } from './orchestrator.js';

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (e) {
      console.error('Worker request failed:', e);
      return jsonResponse({ error: true, message: 'internal error' }, 500);
    }
  }
};
