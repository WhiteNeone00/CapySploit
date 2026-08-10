import { formatErrorDetails, jsonResponse } from './engine.js';
import { handleRequest } from './orchestrator.js';

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (e) {
      const details = formatErrorDetails(e);
      return jsonResponse({ error: true, message: e?.message || 'internal error', debug: details }, 500);
    }
  }
};
