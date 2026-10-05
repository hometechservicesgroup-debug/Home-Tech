require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Pool } = require('pg');
const SERVICE_OPTIONS = require('./data/service-options');
const { getFirebaseClientConfig, initializeFirebaseAdmin, verifyFirebasePhoneIdentity, verifyFirebaseGoogleToken } = require('./firebase-auth');
const { getCloudinaryConfig, createCloudinaryStorage } = require('./cloudinary-storage');
const { getPhonePeConfig, isPhonePePaymentsEnabled, createPhonePePayment, getPhonePeOrderStatus, newPhonePeOrderId } = require('./phonepe');
const { DEFAULT_PRICING_CONFIG, validatePricingConfig, calculateCommission } = require('./pricing-config');

const {
  DATABASE_URL,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  ALLOWED_ORIGIN,
  UPLOADS_DIR,
  PORT,
  NODE_ENV
} = process.env;

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL in environment. Set it before starting the backend.');
  process.exit(1);
}

const firebaseClientConfig = getFirebaseClientConfig(process.env);
let firebaseAuth = null;
let mediaStorage = null;
let firebaseConfigStatus = 'missing';
try {
  firebaseAuth = initializeFirebaseAdmin(process.env);
  firebaseConfigStatus = firebaseAuth ? 'ready' : 'missing';
} catch (err) {
  firebaseAuth = null;
  firebaseConfigStatus = 'invalid';
  console.error('Firebase configuration error:', err.message);
}
const cloudinaryConfig = getCloudinaryConfig(process.env);
if (cloudinaryConfig) {
  try {
    mediaStorage = createCloudinaryStorage(cloudinaryConfig);
  } catch (err) {
    console.error('Cloud media storage configuration error:', err.message);
  }
}
const otpEnabled = Boolean(firebaseClientConfig && firebaseAuth);
const phonePeConfig = getPhonePeConfig(process.env);
const paymentProvider = 'phonepe';
const paymentsEnabled = isPhonePePaymentsEnabled(phonePeConfig, process.env);
const paymentMode = phonePeConfig ? phonePeConfig.mode : 'off';
if (!paymentsEnabled) {
  console.warn('PhonePe payment gateway is selected but its credentials are not configured.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

const app = express();
const allowedOrigins = (ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
if (NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error('ALLOWED_ORIGIN must contain the production website origin in production.');
}
if (NODE_ENV === 'production' && allowedOrigins.includes('*')) {
  throw new Error('ALLOWED_ORIGIN cannot use * in production. Set the exact website origin.');
}
const allowAnyOrigin = NODE_ENV !== 'production' && allowedOrigins.includes('*');

app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowAnyOrigin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true
}));

const uploadDir = path.resolve(UPLOADS_DIR || path.join(__dirname, 'uploads'));
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', (_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
app.use('/uploads', express.static(uploadDir));

const uploadExtensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' };
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = file.fieldname === 'file'
      ? new Set([...imageMimeTypes, 'video/mp4', 'video/webm'])
      : imageMimeTypes;
    if (!allowed.has(file.mimetype)) {
      const error = new Error('Upload a JPG, PNG, or WebP image; gallery videos may be MP4 or WebM.');
      error.statusCode = 415;
      return cb(error);
    }
    return cb(null, true);
  }
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    role: user.role,
    firebaseUid: user.firebase_uid || null
  };
}

function stripMdash(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function getUserFromSessionToken(token, sessionTable = 'sessions') {
  const table = sessionTable === 'admin_sessions' ? 'admin_sessions' : 'sessions';
  const result = await query(`
    SELECT u.*
    FROM ${table} s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > NOW()
  `, [token]);
  return result.rows[0] || null;
}

async function createSessionToken(userId, sessionTable = 'sessions') {
  const token = makeToken();
  await query(`INSERT INTO ${sessionTable} (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`, [token, userId]);
  return token;
}

async function getPartnerProfile(userId) {
  const result = await query('SELECT * FROM partners WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

async function getFullBooking(bookingId) {
  const bookingResult = await query(`
            SELECT b.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
          p.name AS partner_name, p.email AS partner_email, p.phone AS partner_phone,
              p2.status AS partner_status,
              EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id AND r.user_id = b.customer_id) AS reviewed
    FROM bookings b
    LEFT JOIN users c ON c.id = b.customer_id
    LEFT JOIN users p ON p.id = b.partner_id
    LEFT JOIN partners p2 ON p2.user_id = b.partner_id
    WHERE b.id = $1
  `, [bookingId]);

  if (!bookingResult.rows[0]) return null;

  const items = await query(`
    SELECT * FROM booking_items
    WHERE booking_id = $1
    ORDER BY id ASC
  `, [bookingId]);

  const booking = bookingResult.rows[0];
  booking.items = items.rows.map((item) => ({
    id: item.service_id,
    serviceId: item.service_id,
    name: item.service_name_snapshot,
    opt: item.option,
    option: item.option,
    qty: item.quantity,
    quantity: item.quantity,
    price: Number(item.unit_price),
    unitPrice: Number(item.unit_price),
    totalPrice: Number(item.total_price)
  }));
  booking.name = booking.customer_name_snapshot || booking.customer_name;
  booking.phone = booking.customer_phone_snapshot || booking.customer_phone;
  booking.email = booking.customer_email_snapshot || booking.customer_email;
  booking.address = [booking.house, booking.street].filter(Boolean).join(', ');
  booking.date = booking.preferred_date;
  booking.time = booking.preferred_time;
  booking.paymentStatus = booking.payment_status;
  booking.assignedPartner = booking.partner_email || null;
  booking.location = booking.partner_latitude != null && booking.partner_longitude != null
    ? { lat: Number(booking.partner_latitude), lng: Number(booking.partner_longitude), updatedAt: booking.partner_location_updated_at }
    : null;
  booking.customerLocation = booking.customer_latitude != null && booking.customer_longitude != null
    ? { lat: Number(booking.customer_latitude), lng: Number(booking.customer_longitude), updatedAt: booking.customer_location_updated_at }
    : null;
  return booking;
}

async function requireSession(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) {
    return res.status(401).json({ error: 'Please log in again.' });
  }

  try {
    const user = await getUserFromSessionToken(token, 'sessions');
    if (!user) {
      return res.status(401).json({ error: 'Session expired or invalid.' });
    }
    req.user = user;
    return next();
  } catch (err) {
    console.error('requireSession error:', err.message);
    return res.status(500).json({ error: 'Authentication failed.' });
  }
}

async function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) {
    return res.status(401).json({ error: 'Admin login required.' });
  }

  try {
    const user = await getUserFromSessionToken(token, 'admin_sessions');
    if (!user || user.role !== 'admin') {
      return res.status(401).json({ error: 'Invalid admin session.' });
    }
    req.user = user;
    return next();
  } catch (err) {
    console.error('requireAdmin error:', err.message);
    return res.status(500).json({ error: 'Admin authentication failed.' });
  }
}

async function issueVerifyTicket(identifier, firebaseUid = null) {
  const token = crypto.randomBytes(24).toString('hex');
  await query(
    `INSERT INTO verification_tickets (token, identifier, firebase_uid, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')`,
    [token, identifier.trim().toLowerCase(), firebaseUid]
  );
  return token;
}
async function consumeVerifyTicket(token, identifier) {
  const result = await query(
    `DELETE FROM verification_tickets
     WHERE token = $1 AND identifier = $2 AND expires_at > NOW()
     RETURNING firebase_uid`,
    [token, identifier.trim().toLowerCase()]
  );
  return result.rows[0] ? result.rows[0].firebase_uid || '' : null;
}

const DAILY_LIMIT = 3;
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
async function checkAndIncrementOtpLimit(identifier) {
  const key = identifier.trim().toLowerCase();
  const result = await query(
    `INSERT INTO otp_limits (identifier, date, count, created_at, updated_at)
     VALUES ($1, CURRENT_DATE, 1, NOW(), NOW())
     ON CONFLICT (identifier) DO UPDATE SET
       date = CURRENT_DATE,
       count = CASE WHEN otp_limits.date = CURRENT_DATE THEN otp_limits.count + 1 ELSE 1 END,
       updated_at = NOW()
     WHERE otp_limits.date <> CURRENT_DATE OR otp_limits.count < $2
     RETURNING count`,
    [key, DAILY_LIMIT]
  );
  if (!result.rows[0]) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: DAILY_LIMIT - Number(result.rows[0].count) };
}

const DEFAULT_SERVICES = [
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
  for (const service of DEFAULT_SERVICES) {
    await query(
      `INSERT INTO services (slug, name, description, category, base_price, options, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, NOW(), NOW())
       ON CONFLICT (slug) DO NOTHING`,
      [service.slug, service.name, service.description, service.category, safeNumber(service.base_price), JSON.stringify(SERVICE_OPTIONS[service.slug] || ['General Service'])]
    );
  }
}

async function ensureAdminBootstrap() {
  const result = await query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
  const hasAdmin = Number(result.rows[0].count) > 0;
  if (hasAdmin || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return;
  }

  const username = ADMIN_USERNAME.trim();
  const existing = await query('SELECT id FROM users WHERE LOWER(name) = LOWER($1) AND role = $2', [username, 'admin']);
  if (existing.rows[0]) {
    return;
  }

  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const email = `${username.toLowerCase().replace(/[^a-z0-9]/g, '') || 'admin'}@internal.local`;
  await query(`INSERT INTO users (name, email, phone, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`, [username, email, '', passwordHash, 'admin']);
  console.log(`Created initial admin account: ${username}`);
}

async function initDatabase() {
  await query('SELECT 1');
  await seedServices();
  await query(
    `INSERT INTO site_settings (key, value, created_at, updated_at)
     VALUES ('pricingConfig', $1, NOW(), NOW()) ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(DEFAULT_PRICING_CONFIG)]
  );
  await ensureAdminBootstrap();
}

const STATUS_STAGES = ['Requested', 'Confirmed', 'Technician Assigned', 'On the Way', 'In Progress', 'Completed'];

async function getPricingConfig() {
  const result = await query("SELECT value FROM site_settings WHERE key = 'pricingConfig'");
  if (!result.rows[0]) return JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
  try {
    const saved = JSON.parse(result.rows[0].value);
    return { ...JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG)), ...saved };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));
  }
}

async function calculateBookingQuote(serviceEntries, couponValue) {
  if (!Array.isArray(serviceEntries) || serviceEntries.length < 1 || serviceEntries.length > 20) {
    const error = new Error('A booking must contain between 1 and 20 service items.');
    error.statusCode = 400;
    throw error;
  }

  const config = await getPricingConfig();
  const normalizedItems = [];
  let subtotal = 0;
  for (const item of serviceEntries) {
    const serviceId = String(item.serviceId || item.id || '').trim();
    const quantity = Number(item.quantity ?? item.qty ?? 1);
    const unitPrice = Number(item.unitPrice ?? item.price);
    const option = item.option || item.opt || null;
    if (!serviceId || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || !Number.isFinite(unitPrice) || unitPrice <= 0 || (option && String(option).length > 160)) {
      const error = new Error('One or more booking items are invalid.');
      error.statusCode = 400;
      throw error;
    }

    const serviceResult = await query('SELECT slug, name, base_price, options FROM services WHERE slug = $1 AND active = true', [serviceId]);
    const service = serviceResult.rows[0];
    if (!service) {
      const error = new Error('One or more selected services are unavailable. Refresh the service list and try again.');
      error.statusCode = 400;
      throw error;
    }

      const options = Array.isArray(service.options) ? service.options : [];
      const optionIndex = options.indexOf(String(option || ''));
      const optionPrices = service.option_prices && typeof service.option_prices === 'object' ? service.option_prices : {};
      const expectedUnitPrice = safeNumber(optionPrices[String(option || '')], Number(service.base_price) + optionIndex * 90);
      if (optionIndex < 0 || Math.abs(unitPrice - expectedUnitPrice) > 0.001) {
      const error = new Error(`Invalid price for ${service.name}. Refresh the service list and try again.`);
      error.statusCode = 400;
      throw error;
    }

    const totalPrice = Math.round(unitPrice * quantity * 100) / 100;
    subtotal += totalPrice;
    normalizedItems.push({ serviceId: service.slug, name: service.name, option, quantity, unitPrice, totalPrice });
  }

  subtotal = Math.round(subtotal * 100) / 100;
  const visitCharge = subtotal > 0 && subtotal < config.visitFeeFreeThreshold ? config.visitFee : 0;
  const couponCode = String(couponValue || '').trim().toUpperCase();
  const coupon = config.coupons[couponCode];
  let couponDiscount = 0;
  if (coupon && coupon.enabled && subtotal >= coupon.minOrder) {
    couponDiscount = coupon.type === 'flat' ? coupon.value : Math.round(subtotal * coupon.value / 100);
    if (coupon.maxDiscount) couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
    couponDiscount = Math.min(couponDiscount, subtotal);
  }

  return {
    items: normalizedItems,
    subtotal,
    visitCharge,
    coupon: coupon && coupon.enabled && subtotal >= coupon.minOrder ? couponCode : null,
    couponDiscount,
    total: Math.max(0, Math.round((subtotal + visitCharge - couponDiscount) * 100) / 100)
  };
}

app.get(['/', '/hometech-services.html'], (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'hometech-services.html'));
});
app.get('/admin.html', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/partner.html', (_req, res) => res.sendFile(path.join(__dirname, 'partner.html')));

app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    return res.json({ ok: true, paymentsEnabled, paymentProvider, paymentMode, otpEnabled, otpProvider: 'firebase', firebaseConfigStatus, mediaStorageProvider: 'cloudinary', cloudStorageEnabled: Boolean(mediaStorage), database: 'connected' });
  } catch (err) {
    console.error('/health error:', err.message);
    return res.status(503).json({ ok: false, paymentsEnabled, paymentProvider, paymentMode, otpEnabled, otpProvider: 'firebase', firebaseConfigStatus, mediaStorageProvider: 'cloudinary', cloudStorageEnabled: Boolean(mediaStorage), database: 'disconnected' });
  }
});

async function storeUploadedFile(file, folder) {
  if (!file) return null;
  if (!mediaStorage) {
    const error = new Error('Cloud uploads are not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Render.');
    error.statusCode = 503;
    throw error;
  }
  return mediaStorage.upload(file, folder);
}

app.get('/api/auth/firebase-config', (_req, res) => {
  if (!firebaseClientConfig) return res.status(503).json({ error: 'Firebase phone authentication is not configured on the backend.' });
  return res.json(firebaseClientConfig);
});

app.post('/api/auth/otp-attempt', async (req, res) => {
  try {
    if (!otpEnabled) return res.status(503).json({ error: 'Firebase phone OTP is not configured on the backend yet.' });
    const phone = String(req.body?.phone || '').trim();
    if (!/^\+91\d{10}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid Indian mobile number.' });
    const limit = await checkAndIncrementOtpLimit(phone);
    if (!limit.allowed) return res.status(429).json({ error: 'Daily OTP limit reached for this number. Please try again tomorrow.' });
    return res.json({ success: true, remaining: limit.remaining });
  } catch (err) {
    console.error('Firebase OTP limit error:', err.message);
    return res.status(500).json({ error: 'Could not start phone verification.' });
  }
});

app.post('/api/auth/verify-firebase-phone', async (req, res) => {
  try {
    if (!otpEnabled) return res.status(503).json({ error: 'Firebase phone OTP is not configured on the backend yet.' });
    const identity = await verifyFirebasePhoneIdentity(req.body?.idToken, firebaseAuth);
    const verifyToken = await issueVerifyTicket(identity.phoneNumber, identity.uid);
    return res.json({ success: true, verifyToken, identifier: identity.phoneNumber });
  } catch (err) {
    console.error('Firebase phone verification failed:', { code: err.code || 'invalid-token' });
    return res.status(401).json({ error: 'Phone OTP verification failed or expired. Please request a new OTP and try again.' });
  }
});

app.post('/api/auth/phone-login', async (req, res) => {
  let client;
  let identity = null;
  try {
    if (!otpEnabled) return res.status(503).json({ error: 'Firebase phone OTP is not configured on the backend yet.' });
    identity = await verifyFirebasePhoneIdentity(req.body?.idToken, firebaseAuth);
    const digits = identity.phoneNumber.replace(/\D/g, '');
    const possiblePhoneDigits = [digits, digits.slice(-10)];
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`firebase-phone:${digits}`]);
    const byUid = await client.query('SELECT * FROM users WHERE firebase_uid = $1 FOR UPDATE', [identity.uid]);
    let user = byUid.rows[0] || null;
    if (user && user.role !== 'customer') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This phone is linked to a non-customer account. Use its existing sign-in option.' });
    }
    if (user && String(user.phone || '').replace(/\D/g, '') !== digits) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Your verified phone number changed. Contact support to safely update this account.' });
    }
    if (!user) {
      const match = await client.query(
        `SELECT * FROM users
         WHERE REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = ANY($1::text[])
         ORDER BY id FOR UPDATE`,
        [possiblePhoneDigits]
      );
      if (match.rows.length > 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This phone matches multiple customer records. Contact support so the existing booking history stays linked correctly.' });
      }
      user = match.rows[0] || null;
      if (user && user.role !== 'customer') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'This phone is linked to a non-customer account. Use its existing sign-in option.' });
      }
      if (!user) {
        await client.query('COMMIT');
        const verifyToken = await issueVerifyTicket(identity.phoneNumber, identity.uid);
        return res.json({ success: true, needsProfile: true, verifyToken, identifier: identity.phoneNumber });
      }
      const linked = await client.query(
        `UPDATE users SET firebase_uid = $1, firebase_phone_verified_at = NOW(), phone = $2, updated_at = NOW()
         WHERE id = $3 AND (firebase_uid IS NULL OR firebase_uid = $1)
         RETURNING *`,
        [identity.uid, identity.phoneNumber, user.id]
      );
      if (!linked.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This customer account is already linked to another verified phone identity. Contact support.' });
      }
      user = linked.rows[0];
    }
    const token = makeToken();
    await client.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`, [token, user.id]);
    await client.query('COMMIT');
    return res.json({ success: true, needsProfile: false, token, user: publicUser(user) });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Firebase phone login failed:', { code: err.code || 'phone-login-error' });
    if (identity && !err.code) return res.status(500).json({ error: 'Could not open your customer session. Please try again.' });
    if (err.code === '23505') return res.status(409).json({ error: 'This verified phone identity is linked to another account. Contact support.' });
    if (identity) return res.status(500).json({ error: 'Could not link the verified phone to your customer account. Please try again.' });
    return res.status(401).json({ error: 'Phone sign-in could not be verified. Request a new code and try again.' });
  } finally {
    if (client) client.release();
  }
});

app.post('/api/auth/google-login', async (req, res) => {
  try {
    if (!firebaseAuth) return res.status(503).json({ error: 'Firebase sign-in is not configured on this server.' });
    const identity = await verifyFirebaseGoogleToken(req.body?.idToken, firebaseAuth);
    const result = await query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [identity.email]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'No Home-Tech account uses this Google email yet. Create an account with phone OTP first.' });
    const token = makeToken();
    await query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`, [token, user.id]);
    return res.json({ success: true, token, user: publicUser(user) });
  } catch (err) {
    console.error('Firebase Google sign-in failed:', { code: err.code || 'invalid-token' });
    return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
  }
});
app.post('/api/auth/register', async (req, res) => {
  try {
    const { verifyToken, identifier, name, email, password, role } = req.body || {};
    if (!verifyToken || !identifier || !/^\+91\d{10}$/.test(String(identifier)) || !name || !email || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    const firebaseUid = await consumeVerifyTicket(verifyToken, identifier);
    if (!firebaseUid) {
      return res.status(401).json({ error: 'Verification expired or invalid.' });
    }
    const normalizedEmail = stripMdash(email).toLowerCase();
    if (password.length < 6 || password.length > 200 || name.trim().length > 160 || normalizedEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Enter a valid name and email, and a password between 6 and 200 characters.' });
    }
    const normalizedRole = role === 'partner' ? 'partner' : 'customer';
    const passwordHash = bcrypt.hashSync(password, 10);
    const phoneValue = String(identifier);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`firebase-phone:${phoneValue.replace(/\D/g, '')}`]);
      const duplicatePhone = await client.query(`SELECT id FROM users WHERE REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = ANY($1::text[]) LIMIT 1`, [[phoneValue.replace(/\D/g, ''), phoneValue.replace(/\D/g, '').slice(-10)]]);
      if (duplicatePhone.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'An account with this phone number already exists. Please use Phone OTP login.' });
      }
      const userResult = await client.query(
        `INSERT INTO users (name, email, phone, password_hash, role, firebase_uid, firebase_phone_verified_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
         RETURNING *`,
        [name.trim(), normalizedEmail, phoneValue, passwordHash, normalizedRole, firebaseUid]
      );
      const user = userResult.rows[0];
      if (normalizedRole === 'partner') {
        await client.query(
          `INSERT INTO partners (user_id, status, wallet_balance, created_at, updated_at)
           VALUES ($1, 'pending', 0, NOW(), NOW())`,
          [user.id]
        );
      }
      const token = makeToken();
      await client.query(
        `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
        [token, user.id]
      );
      await client.query('COMMIT');
      return res.status(201).json({ success: true, token, user: publicUser(user) });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('register error:', err.message);
    return res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const result = await query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [String(email).trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const token = await createSessionToken(user.id, 'sessions');
    return res.json({ success: true, token, user: publicUser(user) });
  } catch (err) {
    console.error('login error:', err.message);
    return res.status(500).json({ error: 'Could not log in.' });
  }
});

app.get('/api/auth/me', requireSession, async (req, res) => {
  try {
    const partner = await getPartnerProfile(req.user.id);
    return res.json({
      user: publicUser(req.user),
      partnerStatus: partner ? partner.status : null
    });
  } catch (err) {
    console.error('auth/me error:', err.message);
    return res.status(500).json({ error: 'Could not fetch profile.' });
  }
});

app.post('/api/auth/logout', requireSession, async (req, res) => {
  try {
    await query('DELETE FROM sessions WHERE token = $1', [req.headers['x-session-token']]);
    return res.json({ success: true });
  } catch (err) {
    console.error('logout error:', err.message);
    return res.status(500).json({ error: 'Could not log out.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { verifyToken, identifier, newPassword } = req.body || {};
    if (!verifyToken || !identifier || !newPassword) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    if (!await consumeVerifyTicket(verifyToken, identifier)) {
      return res.status(401).json({ error: 'Verification expired or invalid.' });
    }

    const normalizedIdentifier = String(identifier).trim();
    if (!/^\+91\d{10}$/.test(normalizedIdentifier)) return res.status(400).json({ error: 'Reset password using the phone number verified through Firebase.' });
    const phoneDigits = normalizedIdentifier.replace(/\D/g, '');
    const matching = await query(
      `SELECT * FROM users WHERE REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') = $1`,
      [phoneDigits]
    );
    if (!matching.rows.length) {
      return res.status(404).json({ error: 'No account found for that phone/email.' });
    }
    if (matching.rows.length > 1) {
      return res.status(409).json({ error: 'This phone is linked to multiple accounts. Verify and reset using the account email instead.' });
    }
    const user = matching.rows[0];

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, user.id]);
    await query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    await query('DELETE FROM admin_sessions WHERE user_id = $1', [user.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('reset-password error:', err.message);
    return res.status(500).json({ error: 'Could not reset password.' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const result = await query("SELECT * FROM users WHERE role = 'admin' AND LOWER(name) = LOWER($1)", [String(username).trim()]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }

    const token = await createSessionToken(user.id, 'admin_sessions');
    return res.json({ success: true, token, username: user.name });
  } catch (err) {
    console.error('admin login error:', err.message);
    return res.status(500).json({ error: 'Admin login failed.' });
  }
});

app.post('/api/admin/logout', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM admin_sessions WHERE token = $1', [req.headers['x-admin-token']]);
    return res.json({ success: true });
  } catch (err) {
    console.error('admin logout error:', err.message);
    return res.status(500).json({ error: 'Could not log out.' });
  }
});

app.post('/api/admin/change-credentials', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body || {};
    const user = req.user;

    if (!currentPassword || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    let nextUsername = user.name;
    let nextPasswordHash = user.password_hash;

    if (newUsername && String(newUsername).trim()) {
      nextUsername = String(newUsername).trim();
    }
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
      }
      nextPasswordHash = bcrypt.hashSync(newPassword, 10);
    }

    const collision = await query("SELECT id FROM users WHERE role = 'admin' AND LOWER(name) = LOWER($1) AND id != $2", [nextUsername, user.id]);
    if (collision.rows[0]) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    await query(
      `UPDATE users SET name = $1, password_hash = $2, updated_at = NOW() WHERE id = $3`,
      [nextUsername, nextPasswordHash, user.id]
    );

    return res.json({ success: true, username: nextUsername });
  } catch (err) {
    console.error('change-credentials error:', err.message);
    return res.status(500).json({ error: 'Could not update admin credentials.' });
  }
});

app.get('/api/services', async (_req, res) => {
  try {
    const result = await query('SELECT * FROM services WHERE active = true ORDER BY name');
    return res.json(result.rows.map((service) => ({
      id: service.slug || String(service.id),
      name: service.name,
      description: service.description,
      category: service.category,
      options: Array.isArray(service.options) ? service.options : [],
      optionPrices: service.option_prices && typeof service.option_prices === 'object' ? service.option_prices : {},
      price: Number(service.base_price),
      image: service.image_url,
      custom: service.is_custom,
      basePrice: Number(service.base_price),
      active: service.active
    })));
  } catch (err) {
    console.error('services error:', err.message);
    return res.status(500).json({ error: 'Could not load services.' });
  }
});

app.get('/api/pricing-config', async (_req, res) => {
  try {
    const config = await getPricingConfig();
    return res.json({ visitFee: config.visitFee, visitFeeFreeThreshold: config.visitFeeFreeThreshold, partnerWalletMinimum: config.partnerWalletMinimum, partnerWalletMaximumRecharge: config.partnerWalletMaximumRecharge, commissionTiers: config.commissionTiers, coupons: config.coupons });
  } catch (err) {
    console.error('pricing config read error:', err.message);
    return res.status(500).json({ error: 'Could not load pricing settings.' });
  }
});

app.get('/api/admin/pricing-config', requireAdmin, async (_req, res) => {
  try { return res.json(await getPricingConfig()); }
  catch (err) {
    console.error('admin pricing config read error:', err.message);
    return res.status(500).json({ error: 'Could not load pricing settings.' });
  }
});

app.put('/api/admin/pricing-config', requireAdmin, async (req, res) => {
  try {
    const config = validatePricingConfig(req.body);
    await query(
      `INSERT INTO site_settings (key, value, created_at, updated_at)
       VALUES ('pricingConfig', $1, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(config)]
    );
    return res.json({ success: true, config });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('admin pricing config save error:', err.message);
    return res.status(500).json({ error: 'Could not save pricing settings.' });
  }
});

app.post('/api/admin/services', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { name, description, category, price } = req.body || {};
    const storedImage = await storeUploadedFile(req.file, 'service-images');
    if (!name || !price) {
      return res.status(400).json({ error: 'A service name and positive price are required.' });
    }

    const numericValue = safeNumber(price, 0);
    if (numericValue <= 0) {
      return res.status(400).json({ error: 'Price must be a positive number.' });
    }

    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `service-${Date.now()}`;
    const result = await query(
      `INSERT INTO services (slug, name, description, category, base_price, options, option_prices, image_url, active, is_custom, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, true, true, NOW(), NOW())
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         category = EXCLUDED.category,
         base_price = EXCLUDED.base_price,
         options = EXCLUDED.options,
         option_prices = EXCLUDED.option_prices,
         image_url = EXCLUDED.image_url,
         is_custom = true,
         updated_at = NOW()
       RETURNING *`,
      [slug, name, description || '', category || 'General', numericValue, JSON.stringify(['General Service']), JSON.stringify({ 'General Service': numericValue }), storedImage ? storedImage.url : null]
    );

    return res.json({ success: true, item: { id: result.rows[0].slug || String(result.rows[0].id), ...result.rows[0] } });
  } catch (err) {
    console.error('admin services error:', err.message);
    return res.status(500).json({ error: 'Could not save service.' });
  }
});

app.patch('/api/admin/services/:id/price', requireAdmin, async (req, res) => {
  try {
    const serviceId = req.params.id;
    const currentResult = await query('SELECT slug, base_price, options, option_prices FROM services WHERE id::text = $1 OR slug = $1', [serviceId]);
    const current = currentResult.rows[0];
    if (!current) return res.status(404).json({ error: 'Service not found.' });
    const options = Array.isArray(current.options) ? current.options : [];
    const optionPrices = { ...(current.option_prices || {}) };
    let numericValue = safeNumber(req.body && req.body.price, Number(current.base_price));
    if (req.body && req.body.optionPrices && typeof req.body.optionPrices === 'object') {
      for (const option of options) {
        const price = Number(req.body.optionPrices[option]);
        if (!Number.isFinite(price) || price <= 0 || price > 1000000) return res.status(400).json({ error: `Enter a valid price for ${option}.` });
        optionPrices[option] = Math.round(price * 100) / 100;
      }
      numericValue = Number(optionPrices[options[0]] ?? req.body.price);
    } else {
      if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > 1000000) return res.status(400).json({ error: 'Price must be between ₹0.01 and ₹1,000,000.' });
      if (options.length) optionPrices[options[0]] = numericValue;
    }
    const result = await query('UPDATE services SET base_price = $1, option_prices = $2::jsonb, updated_at = NOW() WHERE id::text = $3 OR slug = $3 RETURNING *', [numericValue, JSON.stringify(optionPrices), serviceId]);
    return res.json({ success: true, price: Number(result.rows[0].base_price), optionPrices: result.rows[0].option_prices });
  } catch (err) {
    console.error('service price update error:', err.message);
    return res.status(500).json({ error: 'Could not update price.' });
  }
});

app.post('/api/admin/services/:id/image', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image to upload.' });
  let storedImage;
  try {
    storedImage = await storeUploadedFile(req.file, 'service-images');
    const result = await query(
      'UPDATE services SET image_url = $1, updated_at = NOW() WHERE slug = $2 OR id::text = $2 RETURNING image_url',
      [storedImage.url, req.params.id]
    );
    if (!result.rows[0]) {
      await mediaStorage.removeUrl(storedImage.url);
      return res.status(404).json({ error: 'Service not found.' });
    }
    return res.json({ success: true, image: result.rows[0].image_url });
  } catch (err) {
    if (storedImage) await mediaStorage.removeUrl(storedImage.url);
    console.error('service image upload error:', err.message);
    return res.status(500).json({ error: 'Could not save service image.' });
  }
});

app.delete('/api/admin/services/:id/image', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      'UPDATE services SET image_url = NULL, updated_at = NOW() WHERE slug = $1 OR id::text = $1 RETURNING image_url',
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Service not found.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('service image removal error:', err.message);
    return res.status(500).json({ error: 'Could not remove service image.' });
  }
});

app.delete('/api/admin/services/:id', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `UPDATE services SET active = false, updated_at = NOW()
       WHERE (slug = $1 OR id::text = $1) AND is_custom = true
       RETURNING id`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Custom service not found.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('service removal error:', err.message);
    return res.status(500).json({ error: 'Could not remove service.' });
  }
});

app.get('/api/gallery', async (_req, res) => {
  try {
    const result = await query('SELECT * FROM gallery_items ORDER BY created_at DESC');
    return res.json(result.rows);
  } catch (err) {
    console.error('gallery read error:', err.message);
    return res.status(500).json({ error: 'Could not load gallery.' });
  }
});

app.post('/api/admin/gallery', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const { title, category, type } = req.body || {};
    const storedFile = await storeUploadedFile(req.file, 'gallery');
    const result = await query(
      `INSERT INTO gallery_items (title, category, type, src, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [title || 'Untitled', category || '', type === 'video' ? 'video' : 'image', storedFile.url]
    );

    return res.json({ success: true, item: result.rows[0] });
  } catch (err) {
    console.error('gallery upload error:', err.message);
    return res.status(500).json({ error: 'Could not upload gallery item.' });
  }
});

app.delete('/api/admin/gallery/:id', requireAdmin, async (req, res) => {
  try {
    const result = await query('DELETE FROM gallery_items WHERE id = $1 RETURNING src', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Gallery item not found.' });
    if (mediaStorage && await mediaStorage.removeUrl(result.rows[0].src)) return res.json({ success: true });
    const filename = path.basename(result.rows[0].src || '');
    if (filename && filename !== '.' && filename !== path.basename(uploadDir)) {
      fs.unlink(path.join(uploadDir, filename), () => {});
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('gallery removal error:', err.message);
    return res.status(500).json({ error: 'Could not delete gallery item.' });
  }
});

app.get('/api/settings', async (_req, res) => {
  try {
    const result = await query('SELECT key, value FROM site_settings');
    const settings = {};
    for (const row of result.rows) settings[row.key] = row.value;
    return res.json(settings);
  } catch (err) {
    console.error('settings read error:', err.message);
    return res.status(500).json({ error: 'Could not load settings.' });
  }
});

app.post('/api/admin/settings', requireAdmin, upload.single('logo'), async (req, res) => {
  try {
    const items = [];
    if (req.body && typeof req.body.siteName === 'string' && req.body.siteName.trim()) {
      items.push(['siteName', req.body.siteName.trim()]);
    }
    if (req.file) {
      const storedLogo = await storeUploadedFile(req.file, 'site');
      items.push(['logoUrl', storedLogo.url]);
    }

    for (const [key, value] of items) {
      await query(
        `INSERT INTO site_settings (key, value, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('settings save error:', err.message);
    return res.status(500).json({ error: 'Could not save settings.' });
  }
});

app.post('/api/partners/apply', requireSession, upload.single('photo'), async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({ error: 'Only partner accounts can apply.' });
    }

    const { city, area, expertise, years, address, aadharNumber } = req.body || {};
    const normalizedAadhar = aadharNumber ? String(aadharNumber).replace(/\s+/g, '').slice(-4) : null;
    const storedPhoto = await storeUploadedFile(req.file, 'partner-photos');

    await query(
      `INSERT INTO partners (user_id, city, area, expertise, years, address, aadhar_last4, photo_url, status, wallet_balance, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         city = EXCLUDED.city,
         area = EXCLUDED.area,
         expertise = EXCLUDED.expertise,
         years = EXCLUDED.years,
         address = EXCLUDED.address,
         aadhar_last4 = EXCLUDED.aadhar_last4,
         photo_url = EXCLUDED.photo_url,
         status = CASE WHEN partners.status = 'approved' THEN 'approved' ELSE 'pending' END,
         updated_at = NOW()`,
      [req.user.id, city || null, area || null, expertise || null, years || null, address || null, normalizedAadhar, storedPhoto ? storedPhoto.url : null]
    );

    const partner = await getPartnerProfile(req.user.id);
    return res.json({ success: true, status: partner ? partner.status : 'pending' });
  } catch (err) {
    console.error('partner apply error:', err.message);
    return res.status(500).json({ error: 'Could not save partner application.' });
  }
});

app.get('/api/partners', requireAdmin, async (_req, res) => {
  try {
    const result = await query(`
      SELECT p.*, u.name, u.email, u.phone, COUNT(t.id)::int AS transaction_count
      FROM partners p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN partner_wallet_transactions t ON t.partner_id = p.id
      GROUP BY p.id, u.id
      ORDER BY p.created_at DESC
    `);

    const rows = result.rows.map((partner) => ({
      ...partner,
      aadharNumber: partner.aadhar_last4 ? `••••••••${partner.aadhar_last4}` : null,
      email: partner.email,
      name: partner.name,
      phone: partner.phone,
      photo: partner.photo_url,
      walletBalance: Number(partner.wallet_balance),
      transactionCount: partner.transaction_count,
      status: partner.status
    }));
    return res.json(rows);
  } catch (err) {
    console.error('partners list error:', err.message);
    return res.status(500).json({ error: 'Could not load partners.' });
  }
});

app.get('/api/admin/customers', requireAdmin, async (_req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.name, u.email, u.phone, u.created_at,
             COUNT(b.id)::int AS booking_count,
             MAX(b.created_at) AS latest_booking_at
      FROM users u
      LEFT JOIN bookings b ON b.customer_id = u.id
      WHERE u.role = 'customer'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    const customers = [];
    for (const customer of result.rows) {
      const bookingIds = await query('SELECT id FROM bookings WHERE customer_id = $1 ORDER BY created_at DESC', [customer.id]);
      const bookings = await Promise.all(bookingIds.rows.map((booking) => getFullBooking(booking.id)));
      customers.push({
        ...customer,
        bookingCount: customer.booking_count,
        latestBookingAt: customer.latest_booking_at,
        bookings
      });
    }
    return res.json(customers);
  } catch (err) {
    console.error('admin customers error:', err.message);
    return res.status(500).json({ error: 'Could not load customers.' });
  }
});

app.patch('/api/partners/:email/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, approved, or rejected.' });
    }
    const email = String(req.params.email).trim().toLowerCase();
    const result = await query(
      `UPDATE partners p
       SET status = $1, updated_at = NOW()
       FROM users u
       WHERE u.id = p.user_id AND LOWER(u.email) = LOWER($2)
       RETURNING p.*`,
      [status, email]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Partner not found.' });
    }
    return res.json({ success: true, status });
  } catch (err) {
    console.error('partner status error:', err.message);
    return res.status(500).json({ error: 'Could not update partner status.' });
  }
});

app.post('/api/bookings', requireSession, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Customer account required.' });
    }

    const body = req.body || {};
    const bookingId = String(body.id || body.bookingId || `BK-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID.' });
    }
    const existingBooking = await query('SELECT customer_id FROM bookings WHERE id = $1', [bookingId]);
    if (existingBooking.rows[0]) {
      if (Number(existingBooking.rows[0].customer_id) !== Number(req.user.id)) return res.status(409).json({ error: 'That booking ID is already in use.' });
      return res.json({ success: true, booking: await getFullBooking(bookingId) });
    }
    const customerAddress = body.address || {};
    const serviceEntries = Array.isArray(body.serviceItems) ? body.serviceItems : (Array.isArray(body.items) ? body.items : []);
    const paymentMethod = body.paymentMethod === 'online' ? 'online' : body.paymentMethod === 'cod' ? 'cod' : null;
    if (!paymentMethod) {
      return res.status(400).json({ error: 'Choose a valid payment method.' });
    }
    const quote = await calculateBookingQuote(serviceEntries, body.coupon);
    const normalizedItems = quote.items;
    const visitCharge = quote.visitCharge;
    const couponDiscount = quote.couponDiscount;
    const bookingTotal = quote.total;

    const booking = {
      id: bookingId,
      customer_id: req.user.id,
      status: 'Requested',
      payment_status: paymentMethod === 'online' ? 'paid' : 'pending',
      payment_method: paymentMethod === 'online' ? 'online' : 'cod',
      total: bookingTotal,
      coupon: quote.coupon,
      coupon_discount: couponDiscount,
      visit_charge: visitCharge,
      customer_name_snapshot: body.name || req.user.name,
      customer_phone_snapshot: body.phone || req.user.phone,
      customer_email_snapshot: body.email || req.user.email,
      house: body.house || customerAddress.house || null,
      street: body.street || customerAddress.street || null,
      area: body.area || customerAddress.area || null,
      city: body.city || customerAddress.city || null,
      pin: body.pin || customerAddress.pin || null,
      customer_latitude: body.customerLocation && Number.isFinite(Number(body.customerLocation.lat)) ? Number(body.customerLocation.lat) : null,
      customer_longitude: body.customerLocation && Number.isFinite(Number(body.customerLocation.lng)) ? Number(body.customerLocation.lng) : null,
      customer_location_updated_at: body.customerLocation && body.customerLocation.updatedAt ? new Date(body.customerLocation.updatedAt) : null,
      preferred_date: body.preferredDate || body.date || null,
      preferred_time: body.preferredTime || body.time || null,
      metadata: JSON.stringify({ createdFrom: 'web' })
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let verifiedPaymentOrder = null;
      if (paymentMethod === 'online') {
        const paymentOrderId = String(body.paymentOrderId || '');
        const paymentId = String(body.paymentId || '');
        const paymentOrderResult = await client.query(
          `SELECT * FROM payment_orders
           WHERE order_id = $1 AND user_id = $2 AND booking_id = $3 AND purpose = 'booking' AND status = 'verified'
           FOR UPDATE`,
          [paymentOrderId, req.user.id, booking.id]
        );
        verifiedPaymentOrder = paymentOrderResult.rows[0];
        if (!verifiedPaymentOrder || Number(verifiedPaymentOrder.amount) !== bookingTotal || verifiedPaymentOrder.payment_id !== paymentId) {
          const error = new Error('A verified payment for this booking is required.');
          error.statusCode = 402;
          throw error;
        }
        booking.payment_method = verifiedPaymentOrder.provider;
      }

      await client.query(
        `INSERT INTO bookings (
          id, customer_id, status, payment_status, payment_method, total, coupon, coupon_discount, visit_charge,
          customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
          house, street, area, city, pin,
          customer_latitude, customer_longitude, customer_location_updated_at,
          preferred_date, preferred_time, metadata, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW(),NOW())`,
        [
          booking.id,
          booking.customer_id,
          booking.status,
          booking.payment_status,
          booking.payment_method,
          booking.total,
          booking.coupon,
          booking.coupon_discount,
          booking.visit_charge,
          booking.customer_name_snapshot,
          booking.customer_phone_snapshot,
          booking.customer_email_snapshot,
          booking.house,
          booking.street,
          booking.area,
          booking.city,
          booking.pin,
          booking.customer_latitude,
          booking.customer_longitude,
          booking.customer_location_updated_at,
          booking.preferred_date,
          booking.preferred_time,
          booking.metadata
        ]
      );
      for (const item of normalizedItems) {
        await client.query(
          `INSERT INTO booking_items (booking_id, service_id, service_name_snapshot, option, quantity, unit_price, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            booking.id,
            item.serviceId,
            item.name,
            item.option,
            item.quantity,
            item.unitPrice,
            item.totalPrice
          ]
        );
      }

      if (paymentMethod === 'online') {
        const paymentOrderId = String(body.paymentOrderId);
        const paymentId = String(body.paymentId);
        await client.query(
          `UPDATE payment_orders SET status = 'consumed', updated_at = NOW() WHERE order_id = $1`,
          [paymentOrderId]
        );
        await client.query(
          `INSERT INTO payments (booking_id, user_id, provider, order_id, payment_id, signature_verified, amount, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [booking.id, req.user.id, verifiedPaymentOrder.provider, paymentOrderId, paymentId, true, bookingTotal, 'paid']
        );
      }

      await client.query('COMMIT');
      const savedBooking = await getFullBooking(booking.id);
      return res.status(201).json({
        success: true,
        bookingId: booking.id,
        status: 'Requested',
        total: bookingTotal,
        paymentStatus: booking.payment_status,
        booking: savedBooking
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('booking create error:', err.message);
    return res.status(err.statusCode || (err.code === '23505' ? 409 : 500)).json({ error: err.statusCode ? err.message : err.code === '23505' ? 'Booking ID already exists.' : 'Booking could not be saved. Please try again.' });
  }
});

app.get('/api/bookings/my', requireSession, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Customer account required.' });
    }

    const result = await query('SELECT * FROM bookings WHERE customer_id = $1 ORDER BY created_at DESC', [req.user.id]);
    const bookings = [];
    for (const row of result.rows) {
      const booking = await getFullBooking(row.id);
      bookings.push({ ...booking, total: Number(row.total) });
    }
    return res.json(bookings);
  } catch (err) {
    console.error('customer bookings error:', err.message);
    return res.status(500).json({ error: 'Could not load your bookings.' });
  }
});

app.get('/api/bookings/:id', requireSession, async (req, res) => {
  try {
    const booking = await getFullBooking(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const isAdmin = req.user.role === 'admin';
    const isCustomer = req.user.role === 'customer' && Number(booking.customer_id) === Number(req.user.id);
    const isPartner = req.user.role === 'partner' && Number(booking.partner_id) === Number(req.user.id);

    if (!isAdmin && !isCustomer && !isPartner) {
      return res.status(403).json({ error: 'You do not have access to this booking.' });
    }

    return res.json({
      ...booking,
      items: booking.items || [],
      total: Number(booking.total),
      customer: isAdmin || isPartner || isCustomer ? {
        name: booking.customer_name,
        phone: booking.customer_phone,
        email: booking.customer_email,
        address: booking.address,
        city: booking.city,
        pin: booking.pin
      } : null,
      partner: booking.partner_name ? { name: booking.partner_name, email: booking.partner_email, phone: booking.partner_phone } : null,
      location: booking.location
    });
  } catch (err) {
    console.error('booking fetch error:', err.message);
    return res.status(500).json({ error: 'Could not fetch booking.' });
  }
});

app.get('/api/bookings', requireAdmin, async (_req, res) => {
  try {
    const result = await query(`
            SELECT b.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
              p.name AS partner_name, p.email AS partner_email, p.phone AS partner_phone,
             partner_profile.status AS partner_status
      FROM bookings b
      LEFT JOIN users c ON c.id = b.customer_id
      LEFT JOIN users p ON p.id = b.partner_id
      LEFT JOIN partners partner_profile ON partner_profile.user_id = b.partner_id
      ORDER BY b.created_at DESC
    `);

    const rows = [];
    for (const row of result.rows) {
      const booking = await getFullBooking(row.id);
      rows.push({
        ...booking,
        assignedPartner: booking.partner_email || null,
        customer: { name: booking.customer_name, phone: booking.customer_phone, email: booking.customer_email },
        partner: booking.partner_name ? { name: booking.partner_name, email: booking.partner_email, phone: booking.partner_phone, status: booking.partner_status } : null,
        total: Number(row.total)
      });
    }
    return res.json(rows);
  } catch (err) {
    console.error('admin bookings error:', err.message);
    return res.status(500).json({ error: 'Could not load bookings.' });
  }
});

app.patch('/api/bookings/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!STATUS_STAGES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const result = await query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [status, req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    return res.json({ success: true, status });
  } catch (err) {
    console.error('status update error:', err.message);
    return res.status(500).json({ error: 'Could not update status.' });
  }
});

app.patch('/api/bookings/:id/assign', requireAdmin, async (req, res) => {
  try {
    const { partnerEmail } = req.body || {};
    const normalizedEmail = String(partnerEmail || '').trim().toLowerCase();
    if (!normalizedEmail) {
      return res.status(400).json({ error: 'Partner email is required.' });
    }

    const partnerResult = await query(
      `SELECT p.id AS partner_record_id, p.status, u.id AS user_id, u.email, u.name
       FROM partners p
       JOIN users u ON u.id = p.user_id
       WHERE LOWER(u.email) = LOWER($1)`,
      [normalizedEmail]
    );
    const partner = partnerResult.rows[0];
    if (!partner || partner.status !== 'approved') {
      return res.status(400).json({ error: 'Select an approved partner.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const bookingResult = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [req.params.id]);
      const booking = bookingResult.rows[0];
      if (!booking) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Booking not found.' });
      }
      if (booking.partner_id) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This booking is already assigned. Unassign it before changing partners.' });
      }

      const pricingConfig = await getPricingConfig();
      const amount = calculateCommission(booking.total || 0, pricingConfig);
      const debit = await client.query(
        `UPDATE partners SET wallet_balance = wallet_balance - $1, updated_at = NOW()
         WHERE user_id = $2 AND status = 'approved' AND wallet_balance >= GREATEST($1, $3)
         RETURNING id`,
        [amount, partner.user_id, pricingConfig.partnerWalletMinimum]
      );
      if (!debit.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Partner needs at least ₹${pricingConfig.partnerWalletMinimum} in the wallet and enough balance for the ₹${amount} commission.` });
      }

      await client.query(
        `UPDATE bookings SET partner_id = $1, status = 'Confirmed', updated_at = NOW() WHERE id = $2 RETURNING *`,
        [partner.user_id, req.params.id]
      );
      await client.query(
        `INSERT INTO partner_wallet_transactions (partner_id, type, amount, reason, booking_id, created_at)
         VALUES ($1, 'debit', $2, $3, $4, NOW())`,
        [debit.rows[0].id, amount, `Commission for booking ${req.params.id}`, req.params.id]
      );
      await client.query('COMMIT');
      return res.json({ success: true, commission: amount });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('assign booking error:', err.message);
    return res.status(500).json({ error: 'Could not assign partner.' });
  }
});

app.get('/api/partner/bookings', requireSession, async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({ error: 'Partner account required.' });
    }

    const result = await query(
      `SELECT b.*
       FROM bookings b
       WHERE b.partner_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );

    const rows = [];
    for (const row of result.rows) {
      const booking = await getFullBooking(row.id);
      rows.push({
        ...booking,
        customer: { name: booking.customer_name, phone: booking.customer_phone, email: booking.customer_email },
        total: Number(row.total)
      });
    }
    return res.json(rows);
  } catch (err) {
    console.error('partner bookings error:', err.message);
    return res.status(500).json({ error: 'Could not load partner jobs.' });
  }
});

app.patch('/api/partner/bookings/:id/status', requireSession, async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({ error: 'Partner account required.' });
    }

    const { status } = req.body || {};
    if (!STATUS_STAGES.includes(status)) {
      return res.status(400).json({ error: 'Invalid booking status.' });
    }

    const booking = await getFullBooking(req.params.id);
    if (!booking || Number(booking.partner_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: 'Booking not found or not assigned to you.' });
    }

    await query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('partner status update error:', err.message);
    return res.status(500).json({ error: 'Could not update booking status.' });
  }
});

app.patch('/api/partner/bookings/:id/location', requireSession, async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({ error: 'Partner account required.' });
    }

    const { lat, lng } = req.body || {};
    const latitude = Number(lat);
    const longitude = Number(lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Coordinates out of range.' });
    }

    const booking = await getFullBooking(req.params.id);
    if (!booking || Number(booking.partner_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: 'Booking not found or not assigned to you.' });
    }

    await query(
      `UPDATE bookings SET partner_latitude = $1, partner_longitude = $2, partner_location_updated_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [latitude, longitude, req.params.id]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('partner location update error:', err.message);
    return res.status(500).json({ error: 'Could not update partner location.' });
  }
});

app.post('/api/reviews', requireSession, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Customer account required.' });
    }
    const { serviceId, bookingId, stars, comment } = req.body || {};
    const rating = Number(stars);
    if (!serviceId || !bookingId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'A booking, service, and 1–5 star rating are required.' });
    }
    if (String(comment || '').length > 2000) {
      return res.status(400).json({ error: 'Review comments must be 2,000 characters or fewer.' });
    }

    const booking = await getFullBooking(bookingId);
    if (!booking || Number(booking.customer_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'You can only review your own booking.' });
    }
    if (booking.status !== 'Completed') {
      return res.status(409).json({ error: 'A booking can only be reviewed after it is completed.' });
    }
    if (!booking.items.some((item) => item.serviceId === String(serviceId))) {
      return res.status(400).json({ error: 'That service is not part of this booking.' });
    }

    await query(
      `INSERT INTO reviews (service_id, booking_id, user_id, name, stars, comment, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [String(serviceId), bookingId, req.user.id, req.user.name, rating, String(comment || '').trim()]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('review error:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'You have already reviewed this service for the booking.' });
    return res.status(500).json({ error: 'Could not submit review.' });
  }
});

app.get('/api/reviews/:serviceId', async (req, res) => {
  try {
    const result = await query('SELECT * FROM reviews WHERE service_id = $1 ORDER BY created_at DESC', [req.params.serviceId]);
    return res.json(result.rows);
  } catch (err) {
    console.error('reviews read error:', err.message);
    return res.status(500).json({ error: 'Could not load reviews.' });
  }
});

app.post('/api/create-order', requireSession, async (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Customer account required.' });
  }
  if (!paymentsEnabled) {
    return res.status(503).json({ error: 'Online payments are not configured on this server.' });
  }

  try {
    const { bookingId, items, coupon } = req.body || {};
    if (!bookingId || !/^[A-Za-z0-9_-]{1,64}$/.test(String(bookingId))) {
      return res.status(400).json({ error: 'A valid booking ID is required.' });
    }
    const quote = await calculateBookingQuote(items, coupon);
    if (quote.total <= 0) return res.status(400).json({ error: 'A positive payment amount is required.' });

    const publicSiteUrl = String(process.env.PUBLIC_SITE_URL || allowedOrigins[0] || '').replace(/\/$/, '');
    if (!publicSiteUrl || (phonePeConfig.mode === 'production' && !publicSiteUrl.startsWith('https://'))) {
      return res.status(503).json({ error: 'Set the HTTPS PUBLIC_SITE_URL before using PhonePe checkout.' });
    }
    const merchantOrderId = newPhonePeOrderId();
    const returnUrl = new URL('/', publicSiteUrl);
    returnUrl.searchParams.set('payment', 'phonepe-return');
    returnUrl.searchParams.set('orderId', merchantOrderId);
    const phonePeOrder = await createPhonePePayment(phonePeConfig, {
      merchantOrderId,
      amountPaise: Math.round(quote.total * 100),
      redirectUrl: returnUrl.toString(),
      message: `Home-Tech booking ${bookingId}`
    });
    if (!phonePeOrder.redirectUrl || phonePeOrder.state !== 'PENDING') throw new Error('PhonePe did not return a pending checkout session.');
    await query(
      `INSERT INTO payment_orders (order_id, user_id, booking_id, purpose, amount, status, provider, created_at, updated_at)
       VALUES ($1, $2, $3, 'booking', $4, 'created', 'phonepe', NOW(), NOW())`,
      [merchantOrderId, req.user.id, String(bookingId), quote.total]
    );
    return res.json({ provider: 'phonepe', orderId: merchantOrderId, redirectUrl: phonePeOrder.redirectUrl, paymentMode, quote: { subtotal: quote.subtotal, visitCharge: quote.visitCharge, couponDiscount: quote.couponDiscount, total: quote.total } });
  } catch (err) {
    console.error('create-order error:', err.message);
    return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Could not create payment order.' });
  }
});

app.post('/api/verify-phonepe-payment', requireSession, async (req, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Customer account required.' });
  if (paymentProvider !== 'phonepe' || !phonePeConfig) return res.status(503).json({ error: 'PhonePe checkout is not configured.' });
  try {
    const orderId = String(req.body?.orderId || '');
    const orderResult = await query(
      `SELECT * FROM payment_orders WHERE order_id = $1 AND user_id = $2 AND purpose = 'booking' AND provider = 'phonepe'`,
      [orderId, req.user.id]
    );
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: 'PhonePe payment order was not found for this account.' });
    if (order.status === 'verified' || order.status === 'consumed') return res.json({ success: true, orderId, paymentId: order.payment_id });
    if (order.status !== 'created') return res.status(409).json({ error: 'This PhonePe payment order cannot be verified.' });

    const status = await getPhonePeOrderStatus(phonePeConfig, orderId);
    const successfulAttempt = Array.isArray(status.paymentDetails)
      ? status.paymentDetails.find(item => item && item.state === 'COMPLETED' && item.transactionId)
      : null;
    const expectedAmountPaise = Math.round(Number(order.amount) * 100);
    if (status.state !== 'COMPLETED' || Number(status.amount) !== expectedAmountPaise || !successfulAttempt || Number(successfulAttempt.amount) !== expectedAmountPaise) {
      return res.status(402).json({ error: 'PhonePe has not confirmed the full payment yet. Check the PhonePe app and retry.' });
    }
    const updated = await query(
      `UPDATE payment_orders SET status = 'verified', payment_id = $1, verified_at = NOW(), updated_at = NOW()
       WHERE order_id = $2 AND user_id = $3 AND status = 'created' RETURNING order_id`,
      [successfulAttempt.transactionId, orderId, req.user.id]
    );
    if (!updated.rowCount) return res.status(409).json({ error: 'PhonePe payment order was already processed.' });
    return res.json({ success: true, orderId, paymentId: successfulAttempt.transactionId });
  } catch (err) {
    console.error('verify-phonepe-payment error:', err.providerCode || err.message);
    return res.status(502).json({ error: 'Could not confirm the PhonePe payment status. Please retry shortly.' });
  }
});

app.post('/api/partner/wallet/create-order', requireSession, async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({ error: 'Partner account required.' });
    }
    if (!paymentsEnabled) {
      return res.status(503).json({ error: 'Online payments are not configured on this server.' });
    }

    const amount = safeNumber(req.body && req.body.amount, 0);
    const pricingConfig = await getPricingConfig();
    if (amount < pricingConfig.partnerWalletMinimum) {
      return res.status(400).json({ error: `Minimum recharge is ₹${pricingConfig.partnerWalletMinimum}.` });
    }

    if (amount > pricingConfig.partnerWalletMaximumRecharge) return res.status(400).json({ error: `Maximum single recharge is ₹${pricingConfig.partnerWalletMaximumRecharge}.` });
    const publicSiteUrl = String(process.env.PUBLIC_SITE_URL || allowedOrigins[0] || '').replace(/\/$/, '');
    if (!publicSiteUrl || (phonePeConfig.mode === 'production' && !publicSiteUrl.startsWith('https://'))) {
      return res.status(503).json({ error: 'Set the HTTPS PUBLIC_SITE_URL before using PhonePe checkout.' });
    }
    const merchantOrderId = newPhonePeOrderId();
    const returnUrl = new URL('/partner.html', publicSiteUrl);
    returnUrl.searchParams.set('payment', 'phonepe-wallet-return');
    returnUrl.searchParams.set('orderId', merchantOrderId);
    const phonePeOrder = await createPhonePePayment(phonePeConfig, {
      merchantOrderId, amountPaise: Math.round(amount * 100), redirectUrl: returnUrl.toString(), message: 'Home-Tech partner wallet recharge'
    });
    if (!phonePeOrder.redirectUrl || phonePeOrder.state !== 'PENDING') throw new Error('PhonePe did not return a pending checkout session.');
    await query(
      `INSERT INTO payment_orders (order_id, user_id, purpose, amount, status, provider, created_at, updated_at)
       VALUES ($1, $2, 'wallet', $3, 'created', 'phonepe', NOW(), NOW())`,
      [merchantOrderId, req.user.id, amount]
    );
    return res.json({ provider: 'phonepe', orderId: merchantOrderId, redirectUrl: phonePeOrder.redirectUrl, paymentMode });
  } catch (err) {
    console.error('wallet create-order error:', err.message);
    return res.status(500).json({ error: 'Could not create wallet order.' });
  }
});

app.post('/api/partner/wallet/verify-payment', requireSession, async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({ error: 'Partner account required.' });
    }
    if (!paymentsEnabled) {
      return res.status(503).json({ error: 'Online payments are not configured on this server.' });
    }

    const orderId = String(req.body?.orderId || '');
    if (!orderId) return res.status(400).json({ error: 'PhonePe order ID is required.' });
    const status = await getPhonePeOrderStatus(phonePeConfig, orderId);
    const successfulAttempt = Array.isArray(status.paymentDetails) ? status.paymentDetails.find(item => item && item.state === 'COMPLETED' && item.transactionId) : null;
    if (!successfulAttempt) return res.status(402).json({ error: 'PhonePe has not confirmed this recharge yet.' });

    const client = await pool.connect();
    let newBalance;
    try {
      await client.query('BEGIN');
      const orderResult = await client.query(
        `SELECT * FROM payment_orders
         WHERE order_id = $1 AND user_id = $2 AND purpose = 'wallet' AND provider = 'phonepe' AND status = 'created'
         FOR UPDATE`,
        [orderId, req.user.id]
      );
      const order = orderResult.rows[0];
      if (!order) {
        const alreadyCredited = await client.query(
          `SELECT p.wallet_balance FROM payment_orders o JOIN partners p ON p.user_id = o.user_id
           WHERE o.order_id = $1 AND o.user_id = $2 AND o.purpose = 'wallet' AND o.provider = 'phonepe' AND o.status = 'consumed' AND o.payment_id = $3`,
          [orderId, req.user.id, successfulAttempt.transactionId]
        );
        if (!alreadyCredited.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Wallet payment order not found or already used.' });
        }
        await client.query('COMMIT');
        return res.json({ success: true, balance: Number(alreadyCredited.rows[0].wallet_balance) });
      }

      if (status.state !== 'COMPLETED' || Number(status.amount) !== Math.round(Number(order.amount) * 100) || Number(successfulAttempt.amount) !== Math.round(Number(order.amount) * 100)) {
        await client.query('ROLLBACK');
        return res.status(402).json({ error: 'PhonePe has not confirmed the full wallet recharge amount.' });
      }
      const partnerResult = await client.query('SELECT * FROM partners WHERE user_id = $1 FOR UPDATE', [req.user.id]);
      const partner = partnerResult.rows[0];
      if (!partner) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Partner profile not found.' });
      }
      newBalance = Number(partner.wallet_balance) + Number(order.amount);
      await client.query('UPDATE partners SET wallet_balance = $1, updated_at = NOW() WHERE user_id = $2', [newBalance, req.user.id]);
      await client.query(
        `INSERT INTO partner_wallet_transactions (partner_id, type, amount, reason, payment_id, created_at)
         VALUES ($1, 'credit', $2, 'Wallet recharge', $3, NOW())`,
        [partner.id, order.amount, successfulAttempt.transactionId]
      );
      await client.query(
        `UPDATE payment_orders SET status = 'consumed', payment_id = $1, verified_at = NOW(), updated_at = NOW() WHERE order_id = $2`,
        [successfulAttempt.transactionId, orderId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return res.json({ success: true, balance: newBalance });
  } catch (err) {
    console.error('wallet verify-payment error:', err.providerCode || err.message);
    return res.status(502).json({ error: 'Could not verify wallet payment with PhonePe.' });
  }
});

app.get('/api/partner/wallet', requireSession, async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({ error: 'Partner account required.' });
    }

    const partner = await getPartnerProfile(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner record not found.' });
    }

    const [txns, pricingConfig] = await Promise.all([
      query('SELECT * FROM partner_wallet_transactions WHERE partner_id = $1 ORDER BY created_at DESC', [partner.id]),
      getPricingConfig()
    ]);
    return res.json({
      balance: Number(partner.wallet_balance),
      transactions: txns.rows.map((transaction) => ({ ...transaction, date: transaction.created_at })),
      minRecharge: pricingConfig.partnerWalletMinimum,
      maxRecharge: pricingConfig.partnerWalletMaximumRecharge,
      commissionTiers: pricingConfig.commissionTiers.map((tier, index) => {
        const lower = index === 0 ? 1 : pricingConfig.commissionTiers[index - 1].upTo + 1;
        const upper = tier.upTo === null ? 'and above' : `to ₹${tier.upTo}`;
        return `₹${lower} ${upper} → ${tier.ratePercent}% company commission`;
      })
    });
  } catch (err) {
    console.error('wallet read error:', err.message);
    return res.status(500).json({ error: 'Could not load wallet.' });
  }
});

app.get('/api/admin/bookings', requireAdmin, async (_req, res) => {
  try {
    const result = await query(`
      SELECT id, total FROM bookings ORDER BY created_at DESC
    `);

    const rows = [];
    for (const row of result.rows) {
      const booking = await getFullBooking(row.id);
      rows.push({
        ...booking,
        customer: { name: booking.customer_name, phone: booking.customer_phone, email: booking.customer_email },
        partner: booking.partner_name ? { name: booking.partner_name, phone: booking.partner_phone, status: booking.partner_status } : null,
        total: Number(row.total)
      });
    }
    return res.json(rows);
  } catch (err) {
    console.error('admin full bookings error:', err.message);
    return res.status(500).json({ error: 'Could not load booking details.' });
  }
});

app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? 'Uploads must be 50 MB or smaller.' : 'The upload could not be processed.' });
  }
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
  return next(err);
});

const port = Number(PORT || 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

(async function startServer() {
  try {
    await initDatabase();
    app.listen(port, '0.0.0.0', () => {
      console.log(`Hometake backend listening on 0.0.0.0:${port}`);
    });
  } catch (err) {
    console.error('Startup failed:', err.message);
    process.exit(1);
  }
})();
