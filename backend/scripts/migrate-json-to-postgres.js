const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const baseDir = path.join(__dirname, '..');
const files = [
  ['accounts', 'accounts.json'],
  ['partners', 'partners.json'],
  ['bookings', 'bookings.json'],
  ['admins', 'admins.json'],
  ['otpLimits', 'otp-limits.json'],
  ['gallery', 'gallery.json'],
  ['reviews', 'reviews.json'],
  ['settings', 'settings.json']
];

function loadJsonSafe(fileName) {
  const filePath = path.join(baseDir, fileName);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn(`Could not read ${fileName}:`, err.message);
    return null;
  }
}

async function importAccounts(data) {
  if (!data || typeof data !== 'object') return { migrated: 0, failed: 0 };
  let migrated = 0;
  let failed = 0;
  for (const [key, row] of Object.entries(data)) {
    if (!row || !row.email) continue;
    try {
      const email = String(row.email || key).trim().toLowerCase();
      const name = row.name || 'Customer';
      const normalizedRole = ['customer', 'partner', 'admin'].includes((row.role || '').toLowerCase()) ? (row.role || '').toLowerCase() : 'customer';
      const phone = row.phone || '';
      const passwordHash = row.passwordHash || row.password_hash || null;
      const inserted = await pool.query(
        `INSERT INTO users (name, email, phone, password_hash, role, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, NOW()), NOW())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [name, email, phone, passwordHash, normalizedRole, row.createdAt || null]
      );
      migrated += inserted.rowCount;
    } catch (err) {
      failed += 1;
      console.warn('Unable to import account:', key, err.message);
    }
  }
  return { migrated, failed };
}

async function importPartners(data) {
  if (!data || typeof data !== 'object') return { migrated: 0, failed: 0 };
  let migrated = 0;
  let failed = 0;
  for (const [key, row] of Object.entries(data)) {
    if (!row || !row.email) continue;
    try {
      const user = await pool.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND role = 'partner'", [String(row.email || key).trim().toLowerCase()]);
      if (!user.rows[0]) {
        failed += 1;
        continue;
      }
      const inserted = await pool.query(
        `INSERT INTO partners (user_id, city, area, expertise, years, address, aadhar_last4, photo_url, status, wallet_balance, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::numeric,0),COALESCE($11::timestamptz, NOW()), NOW())
         ON CONFLICT (user_id) DO NOTHING
         RETURNING id`,
        [user.rows[0].id, row.city || null, row.area || null, row.expertise || null, row.years || null, row.address || null, row.aadharNumber ? String(row.aadharNumber).slice(-4) : null, row.photo || row.photo_url || null, row.status || 'pending', row.walletBalance || 0, row.createdAt || null]
      );
      migrated += inserted.rowCount;
    } catch (err) {
      failed += 1;
      console.warn('Unable to import partner:', key, err.message);
    }
  }
  return { migrated, failed };
}

async function importAdmins(data) {
  if (!data || typeof data !== 'object') return { migrated: 0, failed: 0 };
  let migrated = 0;
  let failed = 0;
  for (const [key, row] of Object.entries(data)) {
    const username = String(row && (row.username || key) || '').trim();
    const passwordHash = row && (row.passwordHash || row.password_hash);
    if (!username || !passwordHash || !/^\$2[aby]\$/.test(passwordHash)) {
      failed += 1;
      console.warn('Skipping admin without a valid password hash:', key);
      continue;
    }
    try {
      const duplicateName = await pool.query("SELECT 1 FROM users WHERE role = 'admin' AND LOWER(name) = LOWER($1)", [username]);
      if (duplicateName.rowCount) continue;
      const emailLocal = username.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'admin';
      const inserted = await pool.query(
        `INSERT INTO users (name, email, phone, password_hash, role, created_at, updated_at)
         VALUES ($1, $2, '', $3, 'admin', COALESCE($4::timestamptz, NOW()), NOW())
         ON CONFLICT DO NOTHING RETURNING id`,
        [username, `${emailLocal}@internal.local`, passwordHash, row.createdAt || null]
      );
      migrated += inserted.rowCount;
    } catch (err) {
      failed += 1;
      console.warn('Unable to import admin:', key, err.message);
    }
  }
  return { migrated, failed };
}

async function importBookings(data) {
  if (!data || typeof data !== 'object') return { migrated: 0, failed: 0 };
  let migrated = 0;
  let failed = 0;
  for (const [key, row] of Object.entries(data)) {
    if (!row || !row.id) continue;
    try {
      const bookingId = String(row.id || key);
      const customer = await pool.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND role = 'customer'", [String(row.email || row.customerEmail || '').trim().toLowerCase() || 'unknown@not-found.invalid']);
      if (!customer.rows[0]) {
        failed += 1;
        continue;
      }
      const partnerUser = row.assignedPartner ? await pool.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND role = 'partner'", [String(row.assignedPartner).trim().toLowerCase()]) : { rows: [] };
      const partnerId = partnerUser.rows[0] ? partnerUser.rows[0].id : null;
      const inserted = await pool.query(
        `INSERT INTO bookings (
          id, customer_id, partner_id, status, payment_status, payment_method, total, coupon, coupon_discount, visit_charge,
          customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot, house, street, area, city, pin,
          customer_latitude, customer_longitude, customer_location_updated_at, preferred_date, preferred_time, metadata, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
        ON CONFLICT (id) DO NOTHING
        RETURNING id`,
        [bookingId, customer.rows[0].id, partnerId, row.status || 'Requested', row.paymentStatus || 'pending', row.paymentMethod || null, Number(row.total || 0), row.coupon || null, Number(row.couponDiscount || 0), Number(row.visitCharge || 0), row.name || null, row.phone || null, row.email || null, row.house || row.address ? (row.house || row.address || '').split(',')[0] || null : null, row.street || null, row.area || null, row.city || null, row.pin || null, row.customerLocation && row.customerLocation.lat != null ? Number(row.customerLocation.lat) : null, row.customerLocation && row.customerLocation.lng != null ? Number(row.customerLocation.lng) : null, row.customerLocation && row.customerLocation.updatedAt ? new Date(row.customerLocation.updatedAt) : null, row.date || null, row.time || null, JSON.stringify({ original: row }), row.createdAt || new Date().toISOString(), row.updatedAt || row.createdAt || new Date().toISOString()]
      );
      if (!inserted.rowCount) continue;
      if (Array.isArray(row.items)) {
        for (const item of row.items) {
          await pool.query(
            `INSERT INTO booking_items (booking_id, service_id, service_name_snapshot, option, quantity, unit_price, total_price)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [bookingId, item.id || item.serviceId || null, item.name || item.serviceName || 'Service', item.opt || item.option || null, Number(item.qty || item.quantity || 1), Number(item.price || item.unitPrice || 0), Number((item.price || item.unitPrice || 0) * (item.qty || item.quantity || 1))]
          );
        }
      }
      migrated += 1;
    } catch (err) {
      failed += 1;
      console.warn('Unable to import booking:', key, err.message);
    }
  }
  return { migrated, failed };
}

async function importGallery(data) {
  if (!data || typeof data !== 'object') return { migrated: 0, failed: 0 };
  let migrated = 0;
  for (const [key, row] of Object.entries(data)) {
    if (!row || !row.src) continue;
    try {
      const inserted = await pool.query(
        `INSERT INTO gallery_items (title, category, type, src, created_at)
         SELECT $1,$2,$3,$4,COALESCE($5::timestamptz, NOW())
         WHERE NOT EXISTS (SELECT 1 FROM gallery_items WHERE title = $1 AND src = $4)
         RETURNING id`,
        [row.title || key, row.category || '', row.type || 'image', row.src || '', row.createdAt || null]
      );
      migrated += inserted.rowCount;
    } catch (err) {
      console.warn('Unable to import gallery item:', key, err.message);
    }
  }
  return { migrated, failed: 0 };
}

async function importReviews(data) {
  if (!data || typeof data !== 'object') return { migrated: 0, failed: 0 };
  let migrated = 0;
  for (const [key, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      try {
        if (!row) continue;
        const bookingId = row.bookingId || null;
        const name = row.name || 'Customer';
        const stars = Math.max(1, Math.min(5, Number(row.stars || 5)));
        const comment = row.comment || '';
        const owner = bookingId ? await pool.query('SELECT customer_id FROM bookings WHERE id = $1', [bookingId]) : { rows: [] };
        const userId = owner.rows[0] ? owner.rows[0].customer_id : null;
        const duplicate = await pool.query(
          `SELECT 1 FROM reviews
           WHERE service_id = $1 AND booking_id IS NOT DISTINCT FROM $2
             AND user_id IS NOT DISTINCT FROM $3 AND name = $4 AND stars = $5 AND comment = $6`,
          [key, bookingId, userId, name, stars, comment]
        );
        if (!duplicate.rowCount) {
          await pool.query(
            `INSERT INTO reviews (service_id, booking_id, user_id, name, stars, comment, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, NOW()))`,
            [key, bookingId, userId, name, stars, comment, row.createdAt || null]
          );
          migrated += 1;
        }
      } catch (err) {
        console.warn('Unable to import review:', key, err.message);
      }
    }
  }
  return { migrated, failed: 0 };
}

async function importSettings(data) {
  if (!data || typeof data !== 'object') return { migrated: 0, failed: 0 };
  let migrated = 0;
  for (const [key, value] of Object.entries(data)) {
    await pool.query(
      `INSERT INTO site_settings (key, value, created_at, updated_at)
       VALUES ($1,$2, NOW(), NOW())
        ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
    migrated += 1;
  }
  return { migrated, failed: 0 };
}

async function importOtpLimits(data) {
  if (!data || typeof data !== 'object') return { migrated: 0, failed: 0 };
  let migrated = 0;
  let failed = 0;
  for (const [identifier, row] of Object.entries(data)) {
    if (!row || !row.date || !Number.isInteger(Number(row.count)) || Number(row.count) < 0) {
      failed += 1;
      continue;
    }
    try {
      const inserted = await pool.query(
        `INSERT INTO otp_limits (identifier, date, count, created_at, updated_at)
         VALUES ($1, $2::date, $3, NOW(), NOW())
         ON CONFLICT (identifier) DO NOTHING RETURNING identifier`,
        [identifier.trim().toLowerCase(), row.date, Number(row.count)]
      );
      migrated += inserted.rowCount;
    } catch (err) {
      failed += 1;
      console.warn('Unable to import OTP limit:', err.message);
    }
  }
  return { migrated, failed };
}

async function main() {
  const summary = { migrated: {}, failed: {} };
  for (const [label, fileName] of files) {
    const payload = loadJsonSafe(fileName);
    if (!payload) {
      summary.migrated[label] = 0;
      summary.failed[label] = 0;
      continue;
    }
    let result;
    if (label === 'accounts') result = await importAccounts(payload);
    else if (label === 'partners') result = await importPartners(payload);
    else if (label === 'bookings') result = await importBookings(payload);
    else if (label === 'admins') result = await importAdmins(payload);
    else if (label === 'otpLimits') result = await importOtpLimits(payload);
    else if (label === 'gallery') result = await importGallery(payload);
    else if (label === 'reviews') result = await importReviews(payload);
    else if (label === 'settings') result = await importSettings(payload);
    else result = { migrated: 0, failed: 0 };
    summary.migrated[label] = result.migrated || 0;
    summary.failed[label] = result.failed || 0;
  }

  console.log('Migration summary:');
  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
