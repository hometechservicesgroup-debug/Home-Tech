const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { isRazorpayConfigured, verifyRazorpaySignature } = require('../payment-config');

const validTestKeys = {
  RAZORPAY_KEY_ID: 'rzp_test_A1b2C3',
  RAZORPAY_KEY_SECRET: 'test-secret-value-0123456789',
  NODE_ENV: 'development'
};

test('development accepts explicitly configured test payment keys', () => {
  assert.equal(isRazorpayConfigured(validTestKeys), true);
});

test('production requires live Razorpay keys', () => {
  assert.equal(isRazorpayConfigured({ ...validTestKeys, NODE_ENV: 'production' }), false);
  assert.equal(isRazorpayConfigured({
    ...validTestKeys,
    RAZORPAY_KEY_ID: 'rzp_live_A1b2C3',
    NODE_ENV: 'production'
  }), true);
});

test('missing and placeholder payment values are disabled', () => {
  assert.equal(isRazorpayConfigured({ NODE_ENV: 'development' }), false);
  assert.equal(isRazorpayConfigured({ ...validTestKeys, RAZORPAY_KEY_ID: 'rzp_test_YOUR_KEY_ID' }), false);
  assert.equal(isRazorpayConfigured({ ...validTestKeys, RAZORPAY_KEY_SECRET: 'YOUR_RAZORPAY_TEST_SECRET' }), false);
});

test('Razorpay signature verification accepts a matching HMAC and rejects altered or malformed signatures', () => {
  const secret = 'local-test-secret';
  const orderId = 'order_test123';
  const paymentId = 'pay_test123';
  const signature = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  assert.equal(verifyRazorpaySignature(orderId, paymentId, signature, secret), true);
  assert.equal(verifyRazorpaySignature(orderId, 'pay_other', signature, secret), false);
  assert.equal(verifyRazorpaySignature(orderId, paymentId, `${signature}zz`, secret), false);
  assert.equal(verifyRazorpaySignature(orderId, paymentId, 'not-a-signature', secret), false);
});
