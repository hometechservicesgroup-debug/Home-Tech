exports.up = pgm => {
  pgm.addColumns('services', {
    is_custom: { type: 'BOOLEAN', notNull: true, default: false }
  });

  pgm.createIndex('users', 'LOWER(email)', {
    name: 'users_email_lower_unique_idx',
    unique: true
  });

  pgm.createTable('verification_tickets', {
    token: { type: 'TEXT', primaryKey: true },
    identifier: { type: 'VARCHAR(255)', notNull: true },
    expires_at: { type: 'TIMESTAMPTZ', notNull: true },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });
  pgm.createIndex('verification_tickets', 'expires_at');

  pgm.createTable('payment_orders', {
    order_id: { type: 'VARCHAR(180)', primaryKey: true },
    user_id: { type: 'BIGINT', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    booking_id: { type: 'VARCHAR(64)' },
    purpose: { type: 'VARCHAR(20)', notNull: true },
    amount: { type: 'NUMERIC(12,2)', notNull: true },
    status: { type: 'VARCHAR(20)', notNull: true, default: 'created' },
    payment_id: { type: 'VARCHAR(180)', unique: true },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') },
    verified_at: { type: 'TIMESTAMPTZ' }
  });
  pgm.addConstraint('payment_orders', 'payment_orders_purpose_check', {
    check: "purpose IN ('booking', 'wallet')"
  });
  pgm.addConstraint('payment_orders', 'payment_orders_status_check', {
    check: "status IN ('created', 'verified', 'consumed', 'failed')"
  });

  pgm.sql("UPDATE sessions SET expires_at = created_at + INTERVAL '30 days' WHERE expires_at IS NULL");
  pgm.sql("UPDATE admin_sessions SET expires_at = created_at + INTERVAL '30 days' WHERE expires_at IS NULL");
};

exports.down = pgm => {
  pgm.dropTable('payment_orders');
  pgm.dropTable('verification_tickets');
  pgm.dropIndex('users', 'LOWER(email)', { name: 'users_email_lower_unique_idx' });
  pgm.dropColumns('services', ['is_custom']);
};
