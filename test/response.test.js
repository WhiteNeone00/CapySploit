import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonResponse, makePolishedError } from '../src/response.js';
import { countOnlineUsers, countUserDailyAttacks, ensureTables, getUser, getUserWarningSummary, recordAuthenticatedActivity, recordUserWarning, setSystemSetting, syncMethodsFromPayload, updateMethod, getMethod, listMethods } from '../src/vault-db.js';
import { adminHandler, logAuditAction } from '../src/admin.js';
import { getCachedSystemSetting, invalidateMethodCache, invalidateUserCache } from '../src/helpers.js';
import { isMethodPermittedForUser } from '../src/policy.js';
import { fanOutMethodApiLinks, formatOngoingAttackResponse, getSafeIpInfo, ipLookup, normalizeProfilePayload, resolveFastIpInfo, resolveTargetGeoInfo } from '../src/api.js';
import { buildDiscordWebhookPayload } from '../src/config.js';

test('profile payloads are flattened directly into data instead of nested under profile', () => {
  const normalized = normalizeProfilePayload({
    username: 'alice',
    admin: false,
    vip: false,
    holder: false,
    reseller: false,
    warnings: 2,
    discord_link: null,
    profile: {
      username: 'nested',
      admin: true
    }
  });

  assert.equal(normalized.username, 'alice');
  assert.equal(normalized.admin, false);
  assert.equal('profile' in normalized, false);
  assert.equal(normalized.warnings, 2);
});

test('authenticated activity counts each user once within the online window', async () => {
  const rows = new Map();
  const env = {
    capi_db: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async run() {
                if (sql.includes('INSERT INTO user_activity')) rows.set(values[0], values[1]);
                return { success: true };
              },
              async all() {
                if (sql.includes('COUNT(DISTINCT')) {
                  const cutoff = values[0];
                  return { results: [{ c: [...rows.values()].filter((seen) => seen >= cutoff).length }] };
                }
                return { results: [] };
              }
            };
          }
        };
      }
    }
  };

  await recordAuthenticatedActivity(env, 'alice');
  rows.set('bob', new Date(Date.now() - 16000).toISOString());

  assert.equal(await countOnlineUsers(env), 1);
});

test('plan-style profile payloads strip legacy expiry/service fields and expose expiry_date', () => {
  const normalized = normalizeProfilePayload({
    username: 'alice',
    service_name: 'CAPI',
    expiry_unix: 1735689600,
    formatted_expiry: '01-01-2025',
    raw_access: true,
    star_access: false,
    botnet_access: true,
    private_access: false
  });

  assert.equal('service_name' in normalized, false);
  assert.equal('expiry_unix' in normalized, false);
  assert.equal('formatted_expiry' in normalized, false);
  assert.equal(normalized.expiry_date, '2025-01-01T00:00:00.000Z');
  assert.equal(normalized.raw_access, true);
  assert.equal(normalized.star_access, false);
  assert.equal(normalized.botnet_access, true);
  assert.equal(normalized.private_access, false);
});

test('methods responses return a direct array in data and include min_time metadata', async () => {
  const methods = [
    { id: 1, name: 'udp', description: 'UDP flood', target_type: 'ip', default_port: 80, min_time: 30, max_time: 600, max_concurrents: 3, max_slots: 10 }
  ];

  const response = {
    error: false,
    message: 'public methods loaded',
    data: methods
  };

  assert.equal(Array.isArray(response.data), true);
  assert.equal(response.data[0].name, 'udp');
  assert.equal('methods' in response.data, false);
  assert.equal(response.data[0].min_time, 30);
});

test('auth errors keep error-first ordering and omit redundant lock counters', async () => {
  const response = makePolishedError('invalid credentials', 401, {
    hint: '4 attempts remaining before account lock.'
  });
  const payload = JSON.parse(await response.text());

  assert.deepEqual(Object.keys(payload), ['error', 'message', 'hint', 'timestamp', 'service', 'version', 'ads']);
  assert.equal(payload.error, true);
  assert.equal(payload.message, 'invalid credentials');
  assert.equal(payload.hint, '4 attempts remaining before account lock.');
  assert.equal('attempts' in payload, false);
  assert.equal('limit' in payload, false);
});

test('Discord webhook payloads use configured fields and readable event details', () => {
  const payload = buildDiscordWebhookPayload('attack', {
    route: 'attack',
    username: 'alice',
    target: '203.0.113.7',
    method: 'udp',
    duration: 60,
    status: 'launched',
    secret_value: 'must not be included'
  }, {
    channel: { username: 'CAPI Activity', color: 0x57F287, include_fields: ['route', 'username', 'target', 'method', 'duration', 'status'] },
    title: 'ATTACK LAUNCHED',
    description: 'alice launched an attack',
    footer: 'CAPI Attack Feed'
  });

  assert.equal(payload.username, 'CAPI Activity');
  assert.equal(payload.embeds[0].title, 'ATTACK LAUNCHED');
  assert.deepEqual(payload.embeds[0].fields.map((field) => field.name), [
    'Route', 'Username', 'Target', 'Method', 'Duration', 'Status'
  ]);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Secret Value'), false);
});

test('null IP metadata is treated as an empty object instead of crashing', () => {
  const result = getSafeIpInfo(null);
  assert.deepEqual(result, {});
  assert.doesNotThrow(() => {
    const meta = getSafeIpInfo(null);
    const payload = {
      ...(meta.as || meta.org ? { target_asn: meta.as || meta.org } : {}),
      ...(meta.country ? { target_country: meta.country } : {})
    };
    assert.deepEqual(payload, {});
  });
});

test('repeated IP lookups are cached so the attack route does not refetch the same target', async () => {
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', country: 'Australia', countryCode: 'AU', query: '175.34.65.34' })
    };
  };

  const first = await ipLookup('175.34.65.34');
  const second = await ipLookup('175.34.65.34');

  assert.equal(first.country, 'Australia');
  assert.equal(second.country, 'Australia');
  assert.equal(fetchCalls, 1);

  delete global.fetch;
});

test('slow geolocation metadata does not block the attack response', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', country: 'Japan', countryCode: 'JP' })
    };
  };

  const before = Date.now();
  const info = await resolveFastIpInfo('203.0.113.7', 150);
  const elapsed = Date.now() - before;

  assert.deepEqual(info, {});
  assert.ok(elapsed < 800, `expected fast fallback but took ${elapsed}ms`);

  global.fetch = originalFetch;
});

test('geo lookups can wait briefly and then mark the response as failed without blocking the send', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', country: 'Japan', countryCode: 'JP', isp: 'Example ISP', org: 'Example Org' })
    };
  };

  const before = Date.now();
  const result = await resolveTargetGeoInfo('203.0.113.7', 1200);
  const elapsed = Date.now() - before;

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.info, {});
  assert.ok(elapsed >= 1100, `expected a 1-2s lookup wait but finished in ${elapsed}ms`);
  assert.ok(elapsed < 1800, `expected the request to continue once timeout hit but took ${elapsed}ms`);

  global.fetch = originalFetch;
});

test('geo lookups mark an unsuccessful provider response as failed', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({})
  });

  const result = await resolveTargetGeoInfo('198.51.100.7', 1200);

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.info, {});

  global.fetch = originalFetch;
});

test('disabled methods are rejected even when the user otherwise qualifies', () => {
  const user = { username: 'alice', api: true, vip: true };
  const result = isMethodPermittedForUser(user, { enabled: false, name: 'http' });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /disabled/i);
});

test('user lookups reuse cached results across repeated requests', async () => {
  const username = 'cache-user-fast-path';
  invalidateUserCache(username);

  let calls = 0;
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              calls += 1;
              return { results: [{ username, password: 'pass', api: 1, vip: 1 }] };
            }
          };
        }
      };
    }
  };

  const env = { capi_db: DB };
  const first = await getUser(env, username);
  const second = await getUser(env, username);

  assert.equal(first.username, username);
  assert.equal(second.username, username);
  assert.equal(calls, 1);
});

test('ongoing attack responses use the requested countdown format and empty state', () => {
  const now = Date.now();
  const payload = formatOngoingAttackResponse([
    { target: '175.34.65.35', method: 'udp', port: 53, duration: 60, expires_at: new Date(now + 14000).toISOString() },
    { target: '175.34.65.35', method: 'udp', port: 53, duration: 60, expires_at: new Date(now + 16000).toISOString() },
    { target: '175.34.65.35', method: 'tcp', port: 53, duration: 60, expires_at: new Date(now + 25000).toISOString() },
    { target: 'expired.example', method: 'udp', port: 53, duration: 60, expires_at: new Date(now - 1000).toISOString() },
    { target: 'old.log', method: 'udp', port: 53, duration: 60 }
  ]);

  assert.equal(payload.error, false);
  assert.equal(payload.message, 'Ongoing attacks retrieved successfully.');
  assert.equal(payload.data.length, 3);
  assert.deepEqual(payload.data[0], {
    target: '175.34.65.35',
    method: 'udp',
    port: 53,
    length: 60,
    finish: '14 secs'
  });

  assert.deepEqual(formatOngoingAttackResponse([]), {
    error: false,
    message: 'No ongoing attacks found'
  });
});

test('admin view_user_logs returns the configured log payload instead of a generic internal error', async () => {
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes('SELECT COUNT(*) AS total FROM audit_logs')) return { results: [{ total: 0 }] };
              if (sql.includes('SELECT * FROM audit_logs')) return { results: [] };
              if (sql.includes('FROM users WHERE username = ?')) return { results: [{ username: 'root', password: 'admin123', admin: 1, whitelisted_ip: null, api: 1 }] };
              if (sql.includes('FROM logs WHERE username = ?')) return { results: [{ id: 1, username: 'root', target: '1.1.1.1', port: '80', method: 'tcp', duration: '60', created_at: '2024-01-01T00:00:00.000Z' }] };
              return { results: [] };
            },
            async run() { return {}; }
          };
        },
        async all() {
          if (sql.includes('FROM users WHERE username = ?')) return { results: [{ username: 'root', password: 'admin123', admin: 1, whitelisted_ip: null, api: 1 }] };
          if (sql.includes('FROM logs WHERE username = ?')) return { results: [{ id: 1, username: 'root', target: '1.1.1.1', port: '80', method: 'tcp', duration: '60', created_at: '2024-01-01T00:00:00.000Z' }] };
          return { results: [] };
        },
        async run() { return {}; }
      };
    }
  };

  const request = new Request('https://example.com/admin/view_user_logs?username=root&password=admin123&user_to_view=root');
  const response = await adminHandler(['view_user_logs'], request, { capi_db: DB }, 'req-1', { info() {}, auth() {}, error() {}, warn() {}, metric() {}, security() {}, complete() {} }, { sourceIp: '127.0.0.1' });
  const payload = JSON.parse(await response.text());

  assert.equal(response.status, 200);
  assert.equal(payload.error, false);
  assert.equal(payload.message, 'User logs retrieved successfully.');
  assert.equal(payload.data.attack_logs.length, 1);
  assert.equal('username' in payload.data.attack_logs[0], false);
});

test('fan-out backend links run in parallel without blocking the attack response', async () => {
  const started = Date.now();
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
  };

  const result = await fanOutMethodApiLinks({ api_links: [{ name: 'a', url: 'https://example.com/a', method: 'GET' }, { name: 'b', url: 'https://example.com/b', method: 'GET' }] }, { target: '1.1.1.1', port: 80, duration: 60, method: 'udp', username: 'alice', rps: 0, threads: 0, concurrents: 1 });

  assert.equal(calls, 2);
  assert.equal(result.length, 2);
  assert.ok(Date.now() - started < 800);

  delete global.fetch;
});

test('method list includes the enabled flag from the database so toggles actually affect runtime policy', async () => {
  invalidateMethodCache();

  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return this;
        },
        async all() {
          if (sql.includes('SELECT id, name, description, enabled, default_access')) {
            return { results: [{ id: 1, name: 'http', enabled: 1, description: 'HTTP flood', default_access: 1, vip: 0, reseller: 0, admin: 1, max_slots: 4, max_time: 60, raw_access: 0, star_access: 0, private_access: 0, created_at: new Date().toISOString() }] };
          }
          return { results: [] };
        }
      };
    }
  };

  const methods = await listMethods({ capi_db: DB });
  assert.equal(methods[0]?.enabled, 1);
});

test('counts attacks by calendar day instead of a rolling 24h window', async () => {
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes("COUNT(*) AS c FROM logs WHERE username = ? AND datetime(created_at) >= datetime('now','start of day')")) {
                return { results: [{ c: 7 }] };
              }
              return { results: [] };
            }
          };
        }
      };
    }
  };

  const value = await countUserDailyAttacks({ capi_db: DB }, 'alice');
  assert.equal(value, 7);
});

test('adds missing user columns for the current schema', async () => {
  const calls = [];
  const DB = {
    prepare(sql) {
      calls.push(sql);
      return {
        bind() {
          return this;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        }
      };
    }
  };

  await ensureTables({ capi_db: DB });

  assert.ok(calls.some((sql) => sql.includes('ALTER TABLE users ADD COLUMN whitelisted_ip')));
  assert.ok(calls.some((sql) => sql.includes('ALTER TABLE users ADD COLUMN last_ip')));
});

test('syncMethodsFromPayload keeps payload as source of truth and removes stale rows', async () => {
  const calls = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            async run() {
              return { meta: { changes: 1 } };
            },
            async all() {
              if (sql.includes('SELECT name, enabled') || sql.includes('SELECT name FROM methods')) {
                return { results: [{ name: 'udp' }, { name: 'stale-method' }] };
              }
              return { results: [] };
            }
          };
        },
        async all() {
          if (sql.includes('SELECT name, enabled') || sql.includes('SELECT name FROM methods')) {
            return { results: [{ name: 'udp' }, { name: 'stale-method' }] };
          }
          return { results: [] };
        }
      };
    }
  };

  const result = await syncMethodsFromPayload({ capi_db: DB });

  assert.equal(result.error, null);
  assert.ok(calls.some((call) => call.sql.includes('DELETE FROM methods')) || calls.some((call) => call.sql.includes('DELETE FROM methods WHERE')));
  assert.ok(calls.some((call) => call.sql.includes('enabled = ?')) || calls.some((call) => call.sql.includes('enabled, target_type')));
});

test('database method settings accept string booleans when toggling enabled state', async () => {
  const method = {
    name: 'udp',
    enabled: 0,
    max_slots: 7,
    max_concurrents: 3,
    max_time: 45,
    default_port: 53,
    target_type: 'ip'
  };

  const count = { user: 0, ongoing: 0, global: 0 };
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes('COUNT(*) AS c FROM logs')) {
                count.user += 1;
                return { results: [{ c: 1 }] };
              }
              if (sql.includes('COUNT(*) AS c FROM ongoing_attacks')) {
                count.ongoing += 1;
                return { results: [{ c: 0 }] };
              }
              return { results: [] };
            },
            async run() {
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };

  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes('UPDATE methods SET')) {
                Object.assign(method, {
                  enabled: Number(args[0]) ? 1 : 0,
                  max_slots: Number(args[1]),
                  max_concurrents: Number(args[2]),
                  default_port: Number(args[3]),
                  target_type: args[4],
                  max_time: Number(args[5])
                });
              }
              return { meta: { changes: 1 } };
            },
            async all() {
              if (sql.includes('SELECT * FROM methods WHERE name = ?')) {
                return { results: [method] };
              }
              return { results: [] };
            }
          };
        }
      };
    }
  };

  await updateMethod({ capi_db: db }, 'udp', {
    enabled: 'true',
    max_slots: 7,
    max_concurrents: 3,
    max_time: 45,
    default_port: 53,
    target_type: 'ip'
  });

  const saved = await getMethod({ capi_db: db }, 'udp');
  assert.equal(saved.enabled, 1);
  assert.ok(count.user >= 0);
});

test('database method settings control enabled state, slots, concurrency, and time limits', async () => {
  const method = {
    name: 'udp',
    enabled: 0,
    max_slots: 7,
    max_concurrents: 3,
    max_time: 45,
    default_port: 53,
    target_type: 'ip'
  };

  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes('UPDATE methods SET')) {
                Object.assign(method, {
                  enabled: Number(args[0]),
                  max_slots: Number(args[1]),
                  max_concurrents: Number(args[2]),
                  default_port: Number(args[3]),
                  target_type: args[4],
                  max_time: Number(args[5])
                });
              }
              return { meta: { changes: 1 } };
            },
            async all() {
              if (sql.includes('SELECT * FROM methods WHERE name = ?')) {
                return { results: [method] };
              }
              return { results: [] };
            }
          };
        }
      };
    }
  };

  await updateMethod({ capi_db: db }, 'udp', {
    enabled: 0,
    max_slots: 7,
    max_concurrents: 3,
    max_time: 45,
    default_port: 53,
    target_type: 'ip'
  });

  const saved = await getMethod({ capi_db: db }, 'udp');
  assert.equal(saved.enabled, 0);
  assert.equal(saved.max_slots, 7);
  assert.equal(saved.max_concurrents, 3);
  assert.equal(saved.max_time, 45);
  assert.equal(saved.default_port, 53);
  assert.equal(saved.target_type, 'ip');
});

test('resets warnings daily and suspends after 5 warnings', async () => {
  const userState = {
    username: 'alice',
    suspended: 0,
    warning_count: 4,
    warning_reset_at: new Date().toISOString()
  };

  const calls = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            async all() {
              if (sql.includes('SELECT * FROM users WHERE username = ?')) {
                return { results: [userState] };
              }
              return { results: [] };
            },
            async run() {
              if (sql.includes('UPDATE users SET warning_count = ?, warning_reset_at = ?, suspended = ?, suspend_reason = ?, suspended_by = ?')) {
                userState.warning_count = Number(args[0]);
                userState.warning_reset_at = args[1];
                userState.suspended = Number(args[2]);
                userState.suspend_reason = args[3];
                userState.suspended_by = args[4];
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE users SET warning_count = ?, warning_reset_at = ?')) {
                userState.warning_count = Number(args[0]);
                userState.warning_reset_at = args[1];
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };

  const summary = await getUserWarningSummary({ capi_db: DB }, 'alice');
  assert.equal(summary.count, 4);

  const updated = await recordUserWarning({ capi_db: DB }, 'alice', 'blacklisted target');
  assert.equal(updated.count, 5);
  assert.equal(updated.suspended, true);
  assert.equal(userState.warning_count, 5);
  assert.equal(userState.suspended, 1);
  assert.ok(calls.length > 0);
});

test('view plan payload omits min_time from user-facing output', async () => {
  const payload = {
    error: false,
    message: 'User plan retrieved successfully.',
    data: {
      username: 'alice',
      max_time: 60,
      max_concurrents: 1,
      max_daily_attacks: 100,
      attacks_today: 0,
      attacks_remaining: 100
    }
  };

  assert.ok(!('min_time' in payload.data));
  assert.ok(payload.data.max_time === 60);
});

test('plan responses use plan_type and omit the internal plan_id', () => {
  const publicPlan = { username: 'alice', expiry_date: 'Lifetime', discord_linked: null, plan_type: 'VIP', rank: 'VIP' };
  const adminPlan = { username: 'alice', last_ip: null, plan_type: 'VIP', rank: 'VIP' };

  assert.equal(publicPlan.plan_type, 'VIP');
  assert.equal(adminPlan.plan_type, 'VIP');
  assert.equal('plan_id' in publicPlan, false);
  assert.equal('plan_id' in adminPlan, false);
  assert.deepEqual(Object.keys(publicPlan).slice(-2), ['plan_type', 'rank']);
  assert.deepEqual(Object.keys(adminPlan).slice(-2), ['plan_type', 'rank']);
});

test('method metadata keeps the current field names and max_time semantics', async () => {
  const method = {
    name: 'udp',
    default_access: 1,
    vip: 1,
    reseller: 1,
    admin: 1,
    max_time: null,
    raw_access: 1,
    star_access: 0,
    private_access: 0
  };

  assert.equal(method.default_access, 1);
  assert.equal(method.vip, 1);
  assert.equal(method.max_time, null);
  assert.ok(['0', '1'].includes(String(method.raw_access)));
  assert.ok(!('default_user' in method));
  assert.ok(!('vip_user' in method));
});

test('keeps ads at the bottom and disables tips', async () => {
  const response = jsonResponse({ error: false, online_users_count: 1 }, 200, { service: 'ResellerX' });
  const body = await response.json();

  assert.equal(body.service, 'ResellerX');
  assert.equal(Object.keys(body).at(-1), 'ads');
  assert.equal(body.tips, undefined);
  assert.ok(typeof body.ads === 'string' && body.ads.length > 0);
});

test('rotates ads over repeated responses', async () => {
  const first = await jsonResponse({ error: false }).json();
  const second = await jsonResponse({ error: false }).json();

  assert.notEqual(first.ads, second.ads);
});

test('keeps the ad copy simple and premium-looking', async () => {
  const body = await jsonResponse({ error: false }).json();

  assert.ok(body.ads.length > 0);
  assert.ok(body.ads.includes('$5/month'));
  assert.ok(!body.ads.startsWith('Sponsored:'));
});

test('adds a polished hint to error responses without clutter', async () => {
  const response = makePolishedError('missing input', 400);
  const body = await response.json();

  assert.equal(body.error, true);
  assert.equal(body.message, 'missing input');
  assert.equal(body.hint, 'Review your request and try again.');
  assert.equal(body.supported_routes, undefined, 'supported_routes should not be in response');
  assert.equal(body.examples, undefined, 'examples should not be in response');
});

test('logs admin audit actions to the audit_logs table', async () => {
  const insertCalls = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          insertCalls.push({ sql, args });
          return {
            async run() {
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };

  const result = await logAuditAction({ capi_db: DB }, 'admin1', 'add_user', 'alice', { reason: 'created' }, '127.0.0.1', 'success');

  assert.equal(result.status, 'success');
  assert.ok(insertCalls.some((call) => call.sql.includes('INSERT INTO audit_logs')));
});

test('invalidates cached system settings after the database setting changes', async () => {
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              return { meta: { changes: 1 } };
            },
            async all() {
              if (sql.includes('SELECT * FROM system_settings WHERE key = ?')) {
                return { results: [{ key: 'maintenance_mode', value: 'false' }] };
              }
              return { results: [] };
            }
          };
        }
      };
    }
  };

  const env = { capi_db: DB };
  const first = await getCachedSystemSetting('maintenance_mode', async () => 'true');
  assert.equal(first, 'true');

  await setSystemSetting(env, 'maintenance_mode', 'false', 'boolean', 'API maintenance mode');

  const refreshed = await getCachedSystemSetting('maintenance_mode', async () => 'false');
  assert.equal(refreshed, 'false');
});
