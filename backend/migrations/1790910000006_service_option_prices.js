exports.up = pgm => {
  pgm.addColumns('services', {
    option_prices: { type: 'JSONB', notNull: true, default: pgm.func("'{}'::jsonb") }
  });
  pgm.sql(`
    UPDATE services s
    SET option_prices = COALESCE((
      SELECT jsonb_object_agg(option_row.value, to_jsonb(s.base_price + (option_row.ordinality - 1) * 90))
      FROM jsonb_array_elements_text(s.options) WITH ORDINALITY AS option_row(value, ordinality)
    ), '{}'::jsonb)
  `);
};

exports.down = pgm => {
  pgm.dropColumns('services', ['option_prices']);
};
