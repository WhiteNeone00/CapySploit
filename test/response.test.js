import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonResponse, makePolishedError } from '../src/response.js';

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

test('adds a polished hint and route suggestions for error responses', async () => {
  const response = makePolishedError('missing input', 400);
  const body = await response.json();

  assert.equal(body.error, true);
  assert.equal(body.message, 'missing input');
  assert.equal(body.hint, 'Review your request and try again.');
  assert.deepEqual(body.supported_routes, { api: '/api/<action>', admin: '/admin/<action>', lookup: '/lookup/<type>' });
  assert.ok(body.examples.profile);
});
