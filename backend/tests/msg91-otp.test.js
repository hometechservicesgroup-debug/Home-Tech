const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeIdentifier, makeChallengeToken, readChallengeToken,
  sendOtp, verifyOtp
} = require('../msg91-otp');

const AUTH_KEY = 'test-auth-key';

test('normalizes Indian mobile numbers and email identifiers', () => {
  assert.equal(normalizeIdentifier('+91 98765-43210', 'sms'), '919876543210');
  assert.equal(normalizeIdentifier('9876543210', 'sms'), '919876543210');
  assert.equal(normalizeIdentifier(' Sunny@Example.COM ', 'email'), 'sunny@example.com');
  assert.throws(() => normalizeIdentifier('not-an-email', 'email'));
  assert.throws(() => normalizeIdentifier('12345', 'sms'));
});

test('challenge is bound to the identifier, signed, and expires', () => {
  const now = 1_800_000_000_000;
  const token = makeChallengeToken('919876543210', 'req-123', AUTH_KEY, now);
  assert.equal(readChallengeToken(token, '919876543210', AUTH_KEY, now).requestId, 'req-123');
  assert.equal(readChallengeToken(token, '919876543211', AUTH_KEY, now), null);
  assert.equal(readChallengeToken(`${token}x`, '919876543210', AUTH_KEY, now), null);
  assert.equal(readChallengeToken(token, '919876543210', AUTH_KEY, now + 10 * 60 * 1000), null);
});

test('send uses MSG91 widget endpoint with secret in header, not URL', async () => {
  let request;
  const result = await sendOtp({
    identifier: '+91 98765 43210', channel: 'sms', widgetId: 'widget-1', authKey: AUTH_KEY,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ type: 'success', message: 'request-1' }) };
    }
  });
  assert.equal(request.url, 'https://control.msg91.com/api/v5/widget/sendOtp');
  assert.equal(request.options.headers.authkey, AUTH_KEY);
  assert.equal(request.options.body, JSON.stringify({ widgetId: 'widget-1', identifier: '919876543210' }));
  assert.deepEqual(result, { identifier: '919876543210', requestId: 'request-1' });
});

test('widget failure is rejected even when HTTP status is successful', async () => {
  await assert.rejects(() => sendOtp({
    identifier: '9876543210', channel: 'sms', widgetId: 'widget-1', authKey: AUTH_KEY,
    fetchImpl: async () => ({ ok: true, json: async () => ({ type: 'error', code: 'invalid_widget' }) })
  }));
});

test('verify sends widget request ID and OTP', async () => {
  let body;
  const verified = await verifyOtp({
    requestId: 'request-1', code: '123456', widgetId: 'widget-1', authKey: AUTH_KEY,
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ type: 'success' }) };
    }
  });
  assert.deepEqual(body, { widgetId: 'widget-1', reqId: 'request-1', otp: '123456' });
  assert.equal(verified, true);
});
