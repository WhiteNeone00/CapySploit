import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscordRoleNames, generateVerificationCode } from '../src/discord.js';

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
