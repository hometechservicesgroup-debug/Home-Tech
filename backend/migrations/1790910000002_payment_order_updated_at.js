exports.up = pgm => {
  pgm.addColumns('payment_orders', {
    updated_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('NOW()')
    }
  });
};

exports.down = pgm => {
  pgm.dropColumns('payment_orders', ['updated_at']);
};
