const crypto = require('node:crypto');

const MSG91_API = 'https://control.msg91.com/api/v5/widget';

function normalizeIdentifier(identifier, channel) {
  const value = String(identifier || '').trim();
  if (channel === 'email') {
    const email = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    return email;
  }
  const digits = value.replace(/\D/g, '');
  const mobile = digits.length === 10 ? `91${digits}` : digits;
  if (!/^91\d{10}$/.test(mobile)) throw new Error('Enter a valid Indian mobile number.');
  return mobile;
}

function makeChallengeToken(identifier, requestId, authKey, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    identifier: String(identifier).trim().toLowerCase(),
    requestId: String(requestId),
    expiresAt: now + 10 * 60 * 1000
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', authKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readChallengeToken(token, identifier, authKey, now = Date.now()) {
  if (typeof token !== 'string' || !authKey) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', authKey).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const challenge = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (challenge.expiresAt <= now || challenge.identifier !== String(identifier).trim().toLowerCase() || !challenge.requestId) return null;
    return challenge;
  } catch { return null; }
}

async function msg91Request(path, body, authKey, fetchImpl = globalThis.fetch) {
  let response;
  let data;
  try {
    response = await fetchImpl(`${MSG91_API}/${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authkey: authKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    data = await response.json();
  } catch (error) {
    const wrapped = new Error('MSG91 request failed or timed out.');
    wrapped.cause = error;
    throw wrapped;
  }
  if (!response.ok || !data || data.type !== 'success' || data.code === 201 || data.code === '201') {
    const error = new Error('MSG91 rejected the OTP request.');
    error.providerCode = data && (data.code || data.status) || response.status;
    throw error;
  }
  return data;
}

async function sendOtp({ identifier, channel, widgetId, authKey, fetchImpl }) {
  const normalized = normalizeIdentifier(identifier, channel);
  const data = await msg91Request('sendOtp', { widgetId, identifier: normalized }, authKey, fetchImpl);
  const requestId = data.reqId || data.requestId || data.message;
  if (typeof requestId !== 'string' || !requestId.trim()) {
    const error = new Error('MSG91 did not return an OTP request ID.');
    error.providerCode = data.code || 'missing_req_id';
    throw error;
  }
  return { identifier: normalized, requestId: requestId.trim() };
}

async function verifyOtp({ requestId, code, widgetId, authKey, fetchImpl }) {
  const data = await msg91Request('verifyOtp', { widgetId, reqId: requestId, otp: String(code) }, authKey, fetchImpl);
  return data.type === 'success';
}

module.exports = { normalizeIdentifier, makeChallengeToken, readChallengeToken, msg91Request, sendOtp, verifyOtp };
