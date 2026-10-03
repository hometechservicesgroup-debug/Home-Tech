exports.up = pgm => {
  pgm.addColumns('payment_orders', {
    provider: { type: 'VARCHAR(40)', notNull: true, default: 'legacy' }
  });
  pgm.addConstraint('payment_orders', 'payment_orders_provider_check', {
    check: "provider IN ('phonepe', 'legacy')"
  });
};

exports.down = pgm => {
  pgm.dropConstraint('payment_orders', 'payment_orders_provider_check');
  pgm.dropColumns('payment_orders', ['provider']);
};
