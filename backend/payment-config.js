const crypto = require('crypto');

function isRazorpayConfigured(environment = process.env) {
  const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret, NODE_ENV: nodeEnv } = environment;
  const keyPattern = nodeEnv === 'production' ? /^rzp_live_[A-Za-z0-9]+$/ : /^rzp_(test|live)_[A-Za-z0-9]+$/;
  const placeholderPattern = /YOUR|CHANGE|PLACEHOLDER|X{4,}/i;

  return Boolean(
    keyId && keySecret &&
    keyPattern.test(keyId) &&
    !placeholderPattern.test(keyId) &&
    !placeholderPattern.test(keySecret)
  );
}

function verifyRazorpaySignature(orderId, paymentId, signature, keySecret) {
  if (!orderId || !paymentId || !keySecret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = { isRazorpayConfigured, verifyRazorpaySignature };
