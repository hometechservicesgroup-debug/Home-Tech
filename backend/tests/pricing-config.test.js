const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PRICING_CONFIG, validatePricingConfig, calculateCommission } = require('../pricing-config');

test('default commission tiers calculate the existing commission schedule', () => {
  assert.equal(calculateCommission(1999), 200);
  assert.equal(calculateCommission(2000), 300);
  assert.equal(calculateCommission(5000), 1000);
});

test('admin pricing config accepts valid editable fees, tiers and coupons', () => {
  const saved = validatePricingConfig({
    visitFee: 75,
    visitFeeFreeThreshold: 700,
    partnerWalletMinimum: 800,
    partnerWalletMaximumRecharge: 50000,
    commissionTiers: [
      { upTo: 1000, ratePercent: 5 },
      { upTo: 5000, ratePercent: 8 },
      { upTo: null, ratePercent: 12 }
    ],
    coupons: Object.fromEntries(Object.entries(DEFAULT_PRICING_CONFIG.coupons).map(([code, coupon]) => [code, { ...coupon }]))
  });
  assert.equal(saved.visitFee, 75);
  assert.equal(saved.partnerWalletMinimum, 800);
  assert.equal(saved.partnerWalletMaximumRecharge, 50000);
  assert.equal(calculateCommission(1001, saved), 80);
});

test('admin pricing config rejects unordered tiers and excessive percentage coupons', () => {
  const config = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
  config.commissionTiers[0].upTo = 6000;
  assert.throws(() => validatePricingConfig(config), /upper limits must increase/);
  const couponConfig = JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
  couponConfig.coupons.SAVE10.value = 101;
  assert.throws(() => validatePricingConfig(couponConfig), /discount value is invalid/);
});
