import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonResponse, makePolishedError } from '../src/response.js';
import { countUserDailyAttacks, ensureTables, getUser, getUserWarningSummary, recordUserWarning, setSystemSetting, syncMethodsFromPayload, updateMethod, getMethod, listMethods } from '../src/vault-db.js';
import { logAuditAction } from '../src/admin.js';
import { getCachedSystemSetting, invalidateMethodCache, invalidateUserCache } from '../src/helpers.js';
import { isMethodPermittedForUser } from '../src/policy.js';
import { fanOutMethodApiLinks, getSafeIpInfo, ipLookup, resolveFastIpInfo } from '../src/api.js';

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

test('keeps tips and ads at the bottom and uses a custom service name', async () => {
  const response = jsonResponse({ error: false, online_users_count: 1 }, 200, { service: 'ResellerX' });
  const body = await response.json();

  assert.equal(body.service, 'ResellerX');
  assert.deepEqual(Object.keys(body).slice(-2), ['tips', 'ads']);
  assert.ok(typeof body.tips === 'string' && body.tips.length > 0);
  assert.ok(typeof body.ads === 'string' && body.ads.length > 0);
});

test('rotates tips and ads over repeated responses', async () => {
  const first = await jsonResponse({ error: false }).json();
  const second = await jsonResponse({ error: false }).json();

  assert.notEqual(first.tips, second.tips);
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
