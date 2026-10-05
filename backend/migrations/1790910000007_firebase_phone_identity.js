exports.up = pgm => {
  pgm.addColumns('users', {
    firebase_uid: { type: 'VARCHAR(128)' },
    firebase_phone_verified_at: { type: 'TIMESTAMPTZ' }
  });
  pgm.createIndex('users', 'firebase_uid', {
    name: 'users_firebase_uid_unique_idx',
    unique: true,
    where: 'firebase_uid IS NOT NULL'
  });
  pgm.addColumns('verification_tickets', {
    firebase_uid: { type: 'VARCHAR(128)' }
  });
};

exports.down = pgm => {
  pgm.dropColumns('verification_tickets', ['firebase_uid']);
  pgm.dropIndex('users', 'firebase_uid', { name: 'users_firebase_uid_unique_idx' });
  pgm.dropColumns('users', ['firebase_uid', 'firebase_phone_verified_at']);
};
