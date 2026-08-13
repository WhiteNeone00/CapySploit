// Lookup route handlers for external service lookups.
import { jsonResponse, parseQuery, routeNotFound } from './response.js';
import { LOOKUP_SERVICES, APP_DEFAULTS } from './config.js';

async function ipLookup(ipOrHost) {
  const target = String(ipOrHost || '').trim();
  if (!target) return null;

  const lookupUrls = (LOOKUP_SERVICES.IP_LOOKUP_URLS || []).map((template) => template.replace('{target}', encodeURIComponent(target)));

  for (const url of lookupUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.status === 'success') return data;
    } catch (e) {
      console.warn('ip lookup provider failed:', e.message);
    }
  }
  return null;
}

async function fetchMinecraftServer(addr) {
  const candidates = (LOOKUP_SERVICES.MINECRAFT_LOOKUP_URLS || []).map((template) => template.replace('{target}', encodeURIComponent(addr)));

  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (url.includes('mcstatus.io')) {
        if (data && data.online === true) return data;
      } else if (data && data.online === true && (data?.ip || data?.hostname || data?.port)) {
        return data;
      }
    } catch (e) {
      console.warn('mc provider failed:', url, e.message);
    }
  }

  return null;
}

export async function lookupHandler(parts, request, env, requestId, logger, requestContext = {}) {
  const endpoint = parts[0] || '';
  const q = parseQuery(request);

  if (endpoint === 'lookup_fivem' || endpoint === 'lookup_cfx') {
    const code = q.cfx_code || q.code || q.server || q.server_id || q.address;
    if (!code) return jsonResponse({ error: true, message: 'missing cfx_code' }, 400);
    try {
      const res = await fetch((LOOKUP_SERVICES.FIVEM_LOOKUP_URLS[0] || APP_DEFAULTS.FIVEM_LOOKUP_FALLBACK_URL).replace('{target}', encodeURIComponent(code)));
      if (!res.ok) {
        return jsonResponse({ error: true, message: 'cfx server not found' }, 404);
      }
      const data = await res.json();
      if (!data || data?.notFound || data?.error) {
        return jsonResponse({ error: true, message: 'cfx server not found' }, 404);
      }
      return jsonResponse({ error: false, server: data, ip_info: data?.endpoint ? await ipLookup(data.endpoint) : null });
    } catch (e) {
      return jsonResponse({ error: true, message: 'cfx lookup service unavailable' }, 502);
    }
  }

  if (endpoint === 'lookup_mc' || endpoint === 'lookup_minecraft') {
    const addr = q.server_address || q.address || q.host || q.server || q.ip || q.hostname;
    if (!addr) return jsonResponse({ error: true, message: 'missing server_address' }, 400);
    try {
      const data = await fetchMinecraftServer(addr);
      if (!data) {
        return jsonResponse({ error: true, message: 'mc lookup failed' }, 404);
      }
      const normalized = data.online === true
        ? {
          ...data,
          ip: data.ip_address || data.ip || data.hostname || addr,
          port: data.port || data?.srv_record?.port || 25565,
          hostname: data.host || data.hostname || addr
        }
        : data;
      return jsonResponse({ error: false, server: normalized, ip_info: normalized?.ip ? await ipLookup(normalized.ip) : null });
    } catch (e) {
      return jsonResponse({ error: true, message: 'mc lookup failed' }, 502);
    }
  }

  if (endpoint === 'lookup_ip' || endpoint === 'lookup_domain' || endpoint === 'lookup_host') {
    const target = q.server_address || q.address || q.host || q.ip || q.hostname || q.target || '';
    if (!target) return jsonResponse({ error: true, message: 'missing host or ip target' }, 400);
    const info = await ipLookup(target);
    if (!info) return jsonResponse({ error: true, message: 'ip lookup failed' }, 404);
    return jsonResponse({ error: false, server: { target }, ip_info: info });
  }

  return routeNotFound();
}
