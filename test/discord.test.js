import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscordRoleNames, generateVerificationCode } from '../src/discord.js';
import { FAILED_AUTH_CONFIG } from '../src/config.js';
import { trackFailedAuthAttempt, getFailedAuthAttempts, clearFailedAuthAttempts, checkUserCooldown } from '../src/helpers.js';

test('builds the expected role list for verified users and plan access', () => {
  const roles = buildDiscordRoleNames({ vip: 1, holder: 1, reseller: 1, admin: 0, service_name: 'Neon' }, {
    DISCORD_VERIFIED_ROLE_NAME: 'Verified',
    DISCORD_CUSTOMER_ROLE_NAME: 'Customer'
  });

  assert.deepEqual(roles, ['Verified', 'Customer', 'VIP', 'Holder', 'Reseller']);
});

test('generates a verification code in a friendly format', () => {
  const code = generateVerificationCode();

  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test('keeps failed-auth lockout active until the lockout window has expired', () => {
  const originalNow = Date.now;
  let fakeNow = 0;
  Date.now = () => fakeNow;

  clearFailedAuthAttempts('lockout-test');

  try {
    for (let i = 0; i < FAILED_AUTH_CONFIG.MAX_ATTEMPTS; i += 1) {
      fakeNow = i * 60000;
      trackFailedAuthAttempt('lockout-test');
    }

    fakeNow = FAILED_AUTH_CONFIG.LOCKOUT_WINDOW_MS - 1000;
    const status = getFailedAuthAttempts('lockout-test');

    assert.equal(status.isLocked, true, 'lockout should remain active until the lock window expires');
    assert.ok(status.nextAttemptAvailable > 0, 'remaining lockout time should be reported');
  } finally {
    Date.now = originalNow;
    clearFailedAuthAttempts('lockout-test');
  }
});

test('enforces per-user cooldown when a last request timestamp is still within the cooldown window', () => {
  const now = Date.now();
  const status = checkUserCooldown(new Date(now - 4000).toISOString(), 10, false);

  assert.equal(status.allowed, false);
  assert.equal(status.secondsUntilAvailable, 6);
});
