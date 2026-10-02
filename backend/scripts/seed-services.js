const { Pool } = require('pg');
const serviceOptions = require('../data/service-options');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const services = [
  { slug: 'single-door-fridge', name: 'Single Door Fridge', description: 'Single door fridge service', category: 'Home Appliances', base_price: 399 },
  { slug: 'double-door-fridge', name: 'Double Door Fridge', description: 'Double door fridge service', category: 'Home Appliances', base_price: 499 },
  { slug: 'deep-freezer', name: 'Deep Freezer', description: 'Deep freezer service', category: 'Home Appliances', base_price: 449 },
  { slug: 'commercial-fridge', name: 'Commercial Fridge', description: 'Commercial fridge service', category: 'Home Appliances', base_price: 599 },
  { slug: 'water-cooler', name: 'Water Cooler', description: 'Water cooler service', category: 'Home Appliances', base_price: 349 },
  { slug: 'window-ac', name: 'Window AC', description: 'Window AC service', category: 'Cooling', base_price: 449 },
  { slug: 'split-ac', name: 'Split AC', description: 'Split AC service', category: 'Cooling', base_price: 499 },
  { slug: 'portable-ac', name: 'Portable AC', description: 'Portable AC service', category: 'Cooling', base_price: 429 },
  { slug: 'semi-automatic-wm', name: 'Semi Automatic Washing Machine', description: 'Washing machine service', category: 'Laundry', base_price: 349 },
  { slug: 'top-load-wm', name: 'Automatic Top Load Washing Machine', description: 'Top load washer service', category: 'Laundry', base_price: 449 },
  { slug: 'front-load-wm', name: 'Automatic Front Load Washing Machine', description: 'Front load washer service', category: 'Laundry', base_price: 499 },
  { slug: 'geyser', name: 'Geyser', description: 'Geyser service', category: 'Water Heating', base_price: 349 },
  { slug: 'oven', name: 'Oven', description: 'Oven service', category: 'Kitchen Appliances', base_price: 399 },
  { slug: 'ro-purifier', name: 'RO / Water Purifier', description: 'Purifier service', category: 'Water Purification', base_price: 299 },
  { slug: 'chimney', name: 'Chimney', description: 'Chimney service', category: 'Kitchen Appliances', base_price: 399 },
  { slug: 'room-heater', name: 'Room Heater', description: 'Heater service', category: 'Heating', base_price: 299 },
  { slug: 'vacuum-cleaner', name: 'Vacuum Cleaner', description: 'Vacuum cleaner service', category: 'Cleaning', base_price: 299 },
  { slug: 'led-tv', name: 'LED TV', description: 'TV service', category: 'Electronics', base_price: 449 },
  { slug: 'dishwasher', name: 'Dishwasher', description: 'Dishwasher service', category: 'Kitchen Appliances', base_price: 449 },
  { slug: 'house-wiring', name: 'House Wiring', description: 'Wiring service', category: 'Electrical', base_price: 349 },
  { slug: 'air-cooler', name: 'Air Cooler', description: 'Air cooler service', category: 'Cooling', base_price: 299 },
  { slug: 'sweet-cold-counter', name: 'Sweet Cold Counter', description: 'Sweet counter service', category: 'Commercial', base_price: 499 },
  { slug: 'dd-free-dish', name: 'DTH / Dish Antenna', description: 'DTH service', category: 'Entertainment', base_price: 249 },
  { slug: 'induction-chulha', name: 'Induction Cooktop', description: 'Induction cooktop service', category: 'Kitchen Appliances', base_price: 299 },
  { slug: 'mixer-grinder', name: 'Mixer Grinder', description: 'Mixer grinder service', category: 'Kitchen Appliances', base_price: 249 },
  { slug: 'ceiling-fan', name: 'Ceiling Fan', description: 'Ceiling fan service', category: 'Electrical', base_price: 199 },
  { slug: 'exhaust-fan', name: 'Exhaust Fan', description: 'Exhaust fan service', category: 'Electrical', base_price: 199 },
  { slug: 'electric-iron', name: 'Electric Iron', description: 'Iron service', category: 'Home Appliances', base_price: 199 }
];

async function seedServices() {
  for (const service of services) {
    await pool.query(
      `INSERT INTO services (slug, name, description, category, base_price, options, active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,true,NOW(),NOW())
       ON CONFLICT (slug) DO NOTHING`,
      [service.slug, service.name, service.description, service.category, service.base_price, JSON.stringify(serviceOptions[service.slug] || ['General Service'])]
    );
  }

  console.log(`Seeded ${services.length} services.`);
}

seedServices()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Service seed failed:', err.message);
    process.exit(1);
  });
