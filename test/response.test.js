import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonResponse, makePolishedError } from '../src/response.js';
import { countUserDailyAttacks, ensureTables, getUserWarningSummary, recordUserWarning } from '../src/vault-db.js';

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
