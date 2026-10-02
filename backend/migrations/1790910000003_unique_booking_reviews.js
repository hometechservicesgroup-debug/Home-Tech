exports.up = pgm => {
  pgm.createIndex('reviews', ['booking_id', 'service_id', 'user_id'], {
    name: 'reviews_booking_service_user_unique_idx',
    unique: true,
    where: 'booking_id IS NOT NULL AND user_id IS NOT NULL'
  });
};

exports.down = pgm => {
  pgm.dropIndex('reviews', ['booking_id', 'service_id', 'user_id'], {
    name: 'reviews_booking_service_user_unique_idx'
  });
};
