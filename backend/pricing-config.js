const DEFAULT_PRICING_CONFIG = {
  visitFee: 49,
  visitFeeFreeThreshold: 499,
  partnerWalletMinimum: 500,
  partnerWalletMaximumRecharge: 100000,
  commissionTiers: [
    { upTo: 1999, ratePercent: 10 },
    { upTo: 4999, ratePercent: 15 },
    { upTo: null, ratePercent: 20 }
  ],
  coupons: {
    WELCOME50: { enabled: true, type: 'flat', value: 50, minOrder: 399, maxDiscount: 0 },
    SAVE10: { enabled: true, type: 'percent', value: 10, minOrder: 499, maxDiscount: 150 },
    REF50: { enabled: true, type: 'flat', value: 50, minOrder: 399, maxDiscount: 0 }
  }
};

function validatePricingConfig(input) {
  const fail = message => { const error = new Error(message); error.statusCode = 400; throw error; };
  const integer = (value, name, min, max) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) fail(`${name} must be between ${min} and ${max}.`);
    return n;
  };
  if (!input || typeof input !== 'object') fail('Pricing settings are required.');
  const config = {
    visitFee: integer(input.visitFee, 'Visit fee', 0, 100000),
    visitFeeFreeThreshold: integer(input.visitFeeFreeThreshold, 'Visit fee waiver threshold', 0, 1000000),
    partnerWalletMinimum: integer(input.partnerWalletMinimum, 'Partner wallet minimum', 1, 100000),
    partnerWalletMaximumRecharge: integer(input.partnerWalletMaximumRecharge, 'Maximum partner recharge', 1, 1000000),
    commissionTiers: [],
    coupons: {}
  };
  if (config.partnerWalletMaximumRecharge < config.partnerWalletMinimum) fail('Maximum partner recharge must be at least the wallet minimum.');
  if (!Array.isArray(input.commissionTiers) || input.commissionTiers.length < 1 || input.commissionTiers.length > 10) fail('Add between 1 and 10 commission tiers.');
  let previous = 0;
  input.commissionTiers.forEach((tier, index) => {
    const last = index === input.commissionTiers.length - 1;
    const upTo = last && (tier.upTo === null || tier.upTo === '' || tier.upTo === undefined)
      ? null : integer(tier.upTo, `Commission tier ${index + 1} upper limit`, 1, 100000000);
    const ratePercent = Number(tier.ratePercent);
    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) fail(`Commission tier ${index + 1} rate must be from 0 to 100%.`);
    if (upTo !== null && upTo <= previous) fail('Commission tier upper limits must increase.');
    previous = upTo === null ? previous : upTo;
    config.commissionTiers.push({ upTo, ratePercent });
  });
  if (config.commissionTiers.at(-1).upTo !== null) fail('The final commission tier must cover all higher booking totals (leave its upper limit blank).');
  for (const code of ['WELCOME50', 'SAVE10', 'REF50']) {
    const coupon = input.coupons && input.coupons[code];
    if (!coupon || !['flat', 'percent'].includes(coupon.type)) fail(`Coupon ${code} settings are invalid.`);
    const value = Number(coupon.value);
    if (!Number.isFinite(value) || value < 0 || value > 100000 || (coupon.type === 'percent' && value > 100)) fail(`Coupon ${code} discount value is invalid.`);
    config.coupons[code] = {
      enabled: coupon.enabled === true,
      type: coupon.type,
      value,
      minOrder: integer(coupon.minOrder, `${code} minimum order`, 0, 1000000),
      maxDiscount: integer(coupon.maxDiscount ?? 0, `${code} maximum discount`, 0, 100000)
    };
  }
  return config;
}

function calculateCommission(total, config = DEFAULT_PRICING_CONFIG) {
  const amount = Number(total);
  const tiers = config.commissionTiers || DEFAULT_PRICING_CONFIG.commissionTiers;
  const tier = tiers.find(item => item.upTo === null || amount <= item.upTo) || tiers[tiers.length - 1];
  return Math.round(amount * tier.ratePercent / 100);
}

module.exports = { DEFAULT_PRICING_CONFIG, validatePricingConfig, calculateCommission };
