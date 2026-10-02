const crypto = require('crypto');

function isRazorpayConfigured(environment = process.env) {
  const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret, NODE_ENV: nodeEnv } = environment;
  const allowTestKeys = String(environment.RAZORPAY_ALLOW_TEST_KEYS || '').toLowerCase() === 'true';
  const keyPattern = nodeEnv === 'production' && !allowTestKeys
    ? /^rzp_live_[A-Za-z0-9]+$/
    : /^rzp_(test|live)_[A-Za-z0-9]+$/;
  const placeholderPattern = /YOUR|CHANGE|PLACEHOLDER|X{4,}/i;

  return Boolean(
    keyId && keySecret &&
    keyPattern.test(keyId) &&
    !placeholderPattern.test(keyId) &&
    !placeholderPattern.test(keySecret)
  );
}

function getRazorpayMode(environment = process.env) {
  if (!isRazorpayConfigured(environment)) return 'off';
  return environment.RAZORPAY_KEY_ID.startsWith('rzp_test_') ? 'test' : 'live';
}

function verifyRazorpaySignature(orderId, paymentId, signature, keySecret) {
  if (!orderId || !paymentId || !keySecret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = { isRazorpayConfigured, getRazorpayMode, verifyRazorpaySignature };
