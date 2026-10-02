exports.up = pgm => {
  pgm.addColumns('bookings', {
    partner_latitude: { type: 'DOUBLE PRECISION' },
    partner_longitude: { type: 'DOUBLE PRECISION' },
    partner_location_updated_at: { type: 'TIMESTAMPTZ' }
  });
};

exports.down = pgm => {
  pgm.dropColumns('bookings', [
    'partner_latitude',
    'partner_longitude',
    'partner_location_updated_at'
  ]);
};
