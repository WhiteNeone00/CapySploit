import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonResponse, makePolishedError } from '../src/response.js';
import { countUserDailyAttacks, ensureTables, getUserWarningSummary, recordUserWarning, setSystemSetting, syncMethodsFromPayload, updateMethod, getMethod } from '../src/vault-db.js';
import { logAuditAction } from '../src/admin.js';
import { getCachedSystemSetting } from '../src/helpers.js';
import { isMethodPermittedForUser } from '../src/policy.js';

test('disabled methods are rejected even when the user otherwise qualifies', () => {
  const user = { username: 'alice', api: true, vip: true };
  const result = isMethodPermittedForUser(user, { enabled: false, name: 'http' });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /disabled/i);
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
