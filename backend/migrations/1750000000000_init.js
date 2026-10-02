exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createTable('users', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    name: { type: 'VARCHAR(160)', notNull: true },
    email: { type: 'VARCHAR(255)', notNull: true, unique: true },
    phone: { type: 'VARCHAR(40)' },
    password_hash: { type: 'TEXT' },
    role: { type: 'VARCHAR(20)', notNull: true },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });

  pgm.createIndex('users', 'email');
  pgm.createIndex('users', 'phone');
  pgm.createIndex('users', 'role');

  pgm.createTable('sessions', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    token: { type: 'TEXT', notNull: true, unique: true },
    user_id: { type: 'BIGINT', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') },
    expires_at: { type: 'TIMESTAMPTZ' }
  });
  pgm.createIndex('sessions', 'user_id');

  pgm.createTable('admin_sessions', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    token: { type: 'TEXT', notNull: true, unique: true },
    user_id: { type: 'BIGINT', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') },
    expires_at: { type: 'TIMESTAMPTZ' }
  });
  pgm.createIndex('admin_sessions', 'user_id');

  pgm.createTable('partners', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    user_id: { type: 'BIGINT', notNull: true, unique: true, references: 'users(id)', onDelete: 'CASCADE' },
    city: { type: 'VARCHAR(120)' },
    area: { type: 'VARCHAR(120)' },
    expertise: { type: 'TEXT' },
    years: { type: 'VARCHAR(40)' },
    address: { type: 'TEXT' },
    aadhar_last4: { type: 'VARCHAR(4)' },
    photo_url: { type: 'TEXT' },
    status: { type: 'VARCHAR(20)', notNull: true, default: 'pending' },
    wallet_balance: { type: 'NUMERIC(12,2)', notNull: true, default: 0 },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });
  pgm.createIndex('partners', 'status');

  pgm.createTable('bookings', {
    id: { type: 'VARCHAR(64)', primaryKey: true },
    customer_id: { type: 'BIGINT', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    partner_id: { type: 'BIGINT', references: 'users(id)', onDelete: 'SET NULL' },
    status: { type: 'VARCHAR(50)', notNull: true, default: 'Requested' },
    payment_status: { type: 'VARCHAR(30)', default: 'pending' },
    payment_method: { type: 'VARCHAR(30)' },
    total: { type: 'NUMERIC(12,2)', notNull: true, default: 0 },
    coupon: { type: 'VARCHAR(80)' },
    coupon_discount: { type: 'NUMERIC(12,2)', default: 0 },
    visit_charge: { type: 'NUMERIC(12,2)', default: 0 },
    customer_name_snapshot: { type: 'VARCHAR(160)' },
    customer_phone_snapshot: { type: 'VARCHAR(40)' },
    customer_email_snapshot: { type: 'VARCHAR(255)' },
    house: { type: 'TEXT' },
    street: { type: 'TEXT' },
    area: { type: 'TEXT' },
    city: { type: 'VARCHAR(120)' },
    pin: { type: 'VARCHAR(20)' },
    customer_latitude: { type: 'DOUBLE PRECISION' },
    customer_longitude: { type: 'DOUBLE PRECISION' },
    customer_location_updated_at: { type: 'TIMESTAMPTZ' },
    preferred_date: { type: 'VARCHAR(30)' },
    preferred_time: { type: 'VARCHAR(30)' },
    metadata: { type: 'JSONB', default: '{}' },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });
  pgm.createIndex('bookings', ['customer_id', 'created_at']);
  pgm.createIndex('bookings', ['partner_id', 'created_at']);
  pgm.createIndex('bookings', 'status');

  pgm.createTable('booking_items', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    booking_id: { type: 'VARCHAR(64)', notNull: true, references: 'bookings(id)', onDelete: 'CASCADE' },
    service_id: { type: 'VARCHAR(120)' },
    service_name_snapshot: { type: 'VARCHAR(180)', notNull: true },
    option: { type: 'VARCHAR(160)' },
    quantity: { type: 'INTEGER', notNull: true, default: 1 },
    unit_price: { type: 'NUMERIC(12,2)', notNull: true, default: 0 },
    total_price: { type: 'NUMERIC(12,2)', notNull: true, default: 0 },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });
  pgm.createIndex('booking_items', 'booking_id');

  pgm.createTable('services', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    slug: { type: 'VARCHAR(120)', notNull: true, unique: true },
    name: { type: 'VARCHAR(180)', notNull: true },
    description: { type: 'TEXT' },
    category: { type: 'VARCHAR(120)' },
    base_price: { type: 'NUMERIC(12,2)', notNull: true, default: 0 },
    image_url: { type: 'TEXT' },
    active: { type: 'BOOLEAN', notNull: true, default: true },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });

  pgm.createTable('payments', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    booking_id: { type: 'VARCHAR(64)', notNull: true, references: 'bookings(id)', onDelete: 'CASCADE' },
    user_id: { type: 'BIGINT', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    provider: { type: 'VARCHAR(40)', notNull: true, default: 'razorpay' },
    order_id: { type: 'VARCHAR(180)' },
    payment_id: { type: 'VARCHAR(180)' },
    signature_verified: { type: 'BOOLEAN', notNull: true, default: false },
    amount: { type: 'NUMERIC(12,2)', notNull: true, default: 0 },
    status: { type: 'VARCHAR(30)', notNull: true, default: 'pending' },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });
  pgm.createIndex('payments', 'booking_id');

  pgm.createTable('partner_wallet_transactions', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    partner_id: { type: 'BIGINT', notNull: true, references: 'partners(id)', onDelete: 'CASCADE' },
    type: { type: 'VARCHAR(20)', notNull: true },
    amount: { type: 'NUMERIC(12,2)', notNull: true, default: 0 },
    reason: { type: 'TEXT' },
    booking_id: { type: 'VARCHAR(64)', references: 'bookings(id)', onDelete: 'SET NULL' },
    payment_id: { type: 'VARCHAR(180)' },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });
  pgm.createIndex('partner_wallet_transactions', 'partner_id');

  pgm.createTable('gallery_items', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    title: { type: 'VARCHAR(200)', notNull: true },
    category: { type: 'VARCHAR(120)' },
    type: { type: 'VARCHAR(20)', notNull: true, default: 'image' },
    src: { type: 'TEXT', notNull: true },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });

  pgm.createTable('site_settings', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    key: { type: 'VARCHAR(80)', notNull: true, unique: true },
    value: { type: 'TEXT' },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });

  pgm.createTable('reviews', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    service_id: { type: 'VARCHAR(120)' },
    booking_id: { type: 'VARCHAR(64)', references: 'bookings(id)', onDelete: 'SET NULL' },
    user_id: { type: 'BIGINT', references: 'users(id)', onDelete: 'SET NULL' },
    name: { type: 'VARCHAR(160)' },
    stars: { type: 'SMALLINT', notNull: true },
    comment: { type: 'TEXT' },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });
  pgm.createIndex('reviews', 'service_id');

  pgm.createTable('otp_limits', {
    id: { type: 'BIGSERIAL', primaryKey: true },
    identifier: { type: 'VARCHAR(255)', notNull: true, unique: true },
    date: { type: 'DATE', notNull: true },
    count: { type: 'INTEGER', notNull: true, default: 0 },
    created_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'TIMESTAMPTZ', notNull: true, default: pgm.func('NOW()') }
  });
};

exports.down = pgm => {
  pgm.dropTable('otp_limits');
  pgm.dropTable('reviews');
  pgm.dropTable('site_settings');
  pgm.dropTable('gallery_items');
  pgm.dropTable('partner_wallet_transactions');
  pgm.dropTable('payments');
  pgm.dropTable('services');
  pgm.dropTable('booking_items');
  pgm.dropTable('bookings');
  pgm.dropTable('partners');
  pgm.dropTable('admin_sessions');
  pgm.dropTable('sessions');
  pgm.dropTable('users');
};
