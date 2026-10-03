const test = require('node:test');
const assert = require('node:assert/strict');
const { getPhonePeConfig, getPhonePeAccessToken, createPhonePePayment, getPhonePeOrderStatus } = require('../phonepe');

const secrets = { PHONEPE_CLIENT_ID: 'pg-client-id', PHONEPE_CLIENT_SECRET: 'pg-client-secret', PHONEPE_CLIENT_VERSION: '1', PHONEPE_ENV: 'sandbox' };

test('PhonePe is disabled until credentials are configured and uses explicit sandbox/live hosts', () => {
  assert.equal(getPhonePeConfig({ PHONEPE_ENV: 'production' }), null);
  const sandbox = getPhonePeConfig(secrets);
  assert.equal(sandbox.baseUrl, 'https://api-preprod.phonepe.com/apis/pg-sandbox');
  const live = getPhonePeConfig({ ...secrets, PHONEPE_ENV: 'production' });
  assert.equal(live.baseUrl, 'https://api.phonepe.com/apis/pg');
  assert.equal(live.tokenUrl, 'https://api.phonepe.com/apis/identity-manager');
  assert.equal(getPhonePeConfig({ ...secrets, PHONEPE_ENV: 'prod' }), null);
});

test('PhonePe OAuth token and payment initiation use server credentials and paise amount', async () => {
  const config = getPhonePeConfig({ ...secrets, PHONEPE_CLIENT_ID: 'unique-client-for-create-test' });
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/oauth/token')) return { ok: true, json: async () => ({ access_token: 'server-token', expires_at: Math.floor(Date.now() / 1000) + 3600 }) };
    return { ok: true, json: async () => ({ orderId: 'internal', state: 'PENDING', redirectUrl: 'https://checkout.phonepe.test/pay' }) };
  };
  const order = await createPhonePePayment(config, { merchantOrderId: 'HTP-123-abcd', amountPaise: 12500, redirectUrl: 'https://site.test/?payment=phonepe-return', message: 'Booking 123' }, mockFetch);
  assert.equal(order.state, 'PENDING');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /pg-sandbox\/v1\/oauth\/token$/);
  assert.match(String(calls[0].options.body), /client_secret=pg-client-secret/);
  assert.equal(calls[1].options.headers.Authorization, 'O-Bearer server-token');
  assert.equal(JSON.parse(calls[1].options.body).amount, 12500);
  assert.equal(JSON.parse(calls[1].options.body).paymentFlow.merchantUrls.redirectUrl, 'https://site.test/?payment=phonepe-return');
});

test('PhonePe status requires valid order IDs and reads gateway status from server API', async () => {
  const config = getPhonePeConfig({ ...secrets, PHONEPE_CLIENT_ID: 'unique-client-for-status-test' });
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/oauth/token')) return { ok: true, json: async () => ({ access_token: 'server-token', expires_at: Math.floor(Date.now() / 1000) + 3600 }) };
    return { ok: true, json: async () => ({ state: 'COMPLETED', amount: 12500, paymentDetails: [{ state: 'COMPLETED', amount: 12500, transactionId: 'phonepe-txn' }] }) };
  };
  const status = await getPhonePeOrderStatus(config, 'HTP-123-abcd', mockFetch);
  assert.equal(status.state, 'COMPLETED');
  assert.match(calls[1].url, /checkout\/v2\/order\/HTP-123-abcd\/status\?details=false$/);
  assert.equal(calls[1].options.headers.Authorization, 'O-Bearer server-token');
  await assert.rejects(getPhonePeOrderStatus(config, 'bad order id', mockFetch), /invalid/);
});
