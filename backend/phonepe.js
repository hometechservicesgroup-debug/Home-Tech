const crypto = require('crypto');

const TOKEN_PATH = '/v1/oauth/token';
const CACHE = new Map();

function getPhonePeConfig(environment = process.env) {
  const mode = String(environment.PHONEPE_ENV || 'sandbox').trim().toLowerCase();
  if (!['sandbox', 'production'].includes(mode)) return null;
  const clientId = String(environment.PHONEPE_CLIENT_ID || '').trim();
  const clientSecret = String(environment.PHONEPE_CLIENT_SECRET || '').trim();
  const clientVersion = String(environment.PHONEPE_CLIENT_VERSION || '').trim();
  const placeholder = /YOUR|CHANGE|PLACEHOLDER|X{4,}|REPLACE/i;
  if (![clientId, clientSecret, clientVersion].every(value => value && !placeholder.test(value))) return null;
  const baseUrl = mode === 'production' ? 'https://api.phonepe.com/apis/pg' : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
  const tokenUrl = mode === 'production' ? 'https://api.phonepe.com/apis/identity-manager' : baseUrl;
  return { mode, clientId, clientSecret, clientVersion, baseUrl, tokenUrl };
}

async function phonePeRequest(config, url, options, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const error = new Error(`PhonePe request failed (${response.status}).`);
    error.status = response.status;
    error.providerCode = typeof payload.code === 'string' ? payload.code.slice(0, 80) : 'PHONEPE_ERROR';
    throw error;
  }
  return payload;
}

async function getPhonePeAccessToken(config, fetchImpl = fetch, now = Date.now()) {
  if (!config) throw new Error('PhonePe PG credentials are not configured.');
  const cacheKey = crypto.createHash('sha256').update(`${config.clientId}:${config.clientVersion}:${config.clientSecret}`).digest('hex');
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now + 60_000) return cached.token;
  const body = new URLSearchParams({ client_id: config.clientId, client_version: config.clientVersion, client_secret: config.clientSecret, grant_type: 'client_credentials' });
  const tokenResponse = await phonePeRequest(config, `${config.tokenUrl}${TOKEN_PATH}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  }, fetchImpl);
  const token = tokenResponse.access_token;
  const expiresAt = Number(tokenResponse.expires_at) * 1000;
  if (typeof token !== 'string' || !token || !Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('PhonePe returned an invalid or expired access token.');
  CACHE.set(cacheKey, { token, expiresAt });
  return token;
}

async function createPhonePePayment(config, { merchantOrderId, amountPaise, redirectUrl, message }, fetchImpl = fetch) {
  if (!config || !merchantOrderId || !Number.isSafeInteger(amountPaise) || amountPaise < 100 || !redirectUrl) throw new Error('PhonePe payment request is incomplete.');
  const token = await getPhonePeAccessToken(config, fetchImpl);
  return phonePeRequest(config, `${config.baseUrl}/checkout/v2/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${token}` },
    body: JSON.stringify({
      merchantOrderId,
      amount: amountPaise,
      expireAfter: 1200,
      paymentFlow: { type: 'PG_CHECKOUT', message: String(message || 'Home-Tech payment').slice(0, 100), merchantUrls: { redirectUrl } }
    })
  }, fetchImpl);
}

async function getPhonePeOrderStatus(config, merchantOrderId, fetchImpl = fetch) {
  if (!config || !/^[A-Za-z0-9_-]{1,63}$/.test(String(merchantOrderId || ''))) throw new Error('PhonePe order ID is invalid.');
  const token = await getPhonePeAccessToken(config, fetchImpl);
  return phonePeRequest(config, `${config.baseUrl}/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=false`, {
    method: 'GET', headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${token}` }
  }, fetchImpl);
}

function newPhonePeOrderId() {
  return `HTP-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

module.exports = { getPhonePeConfig, getPhonePeAccessToken, createPhonePePayment, getPhonePeOrderStatus, newPhonePeOrderId };
