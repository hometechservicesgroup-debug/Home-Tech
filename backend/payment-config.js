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

module.exports = { isRazorpayConfigured };
