const E164_PHONE = /^\+[1-9]\d{7,14}$/;

function getFirebaseClientConfig(environment = process.env) {
  const { FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID } = environment;
  if (![FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID].every(value => typeof value === 'string' && value.trim())) return null;
  return { apiKey: FIREBASE_API_KEY.trim(), authDomain: FIREBASE_AUTH_DOMAIN.trim(), projectId: FIREBASE_PROJECT_ID.trim(), appId: FIREBASE_APP_ID.trim() };
}

function parseFirebaseServiceAccount(environment = process.env) {
  const projectId = String(environment.FIREBASE_PROJECT_ID || '').trim();
  const encoded = String(environment.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || '').trim();
  const raw = String(environment.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!projectId || (!encoded && !raw)) return null;
  let source = raw;
  if (encoded) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must be a valid Base64 value.');
    source = Buffer.from(encoded, 'base64').toString('utf8');
  }
  let serviceAccount;
  try { serviceAccount = JSON.parse(source); if (typeof serviceAccount === 'string') serviceAccount = JSON.parse(serviceAccount); }
  catch { throw new Error(`${encoded ? 'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64' : 'FIREBASE_SERVICE_ACCOUNT_JSON'} must contain valid Firebase service account JSON${encoded ? ' encoded as Base64' : ''}.`); }
  if (!serviceAccount || typeof serviceAccount !== 'object' || Array.isArray(serviceAccount)) throw new Error('Firebase service account must be a JSON object.');
  if (serviceAccount.project_id !== projectId || !serviceAccount.client_email || !serviceAccount.private_key) throw new Error('Firebase service account project or credentials do not match FIREBASE_PROJECT_ID.');
  serviceAccount.private_key = String(serviceAccount.private_key).replace(/\\n/g, '\n');
  return { projectId, serviceAccount };
}

function initializeFirebaseAdmin(environment = process.env, adminSdk = require('firebase-admin')) {
  const credentials = parseFirebaseServiceAccount(environment);
  if (!credentials) return null;
  const { projectId, serviceAccount } = credentials;
  const existing = adminSdk.apps.find(app => app.name === 'hometake-auth');
  const app = existing || adminSdk.initializeApp({ credential: adminSdk.credential.cert(serviceAccount), projectId, storageBucket: String(environment.FIREBASE_STORAGE_BUCKET || '').trim() || undefined }, 'hometake-auth');
  return app.auth();
}

function initializeFirebaseAdminApp(environment = process.env, adminSdk = require('firebase-admin')) {
  const credentials = parseFirebaseServiceAccount(environment);
  const bucketName = String(environment.FIREBASE_STORAGE_BUCKET || '').trim();
  if (!credentials || !bucketName) return null;
  const { projectId, serviceAccount } = credentials;
  return adminSdk.apps.find(app => app.name === 'hometake-auth') || adminSdk.initializeApp({ credential: adminSdk.credential.cert(serviceAccount), projectId, storageBucket: bucketName }, 'hometake-auth');
}
async function verifyFirebasePhoneToken(idToken, firebaseAuth, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 10000 || !firebaseAuth) throw new Error('Firebase phone verification is not configured or token is invalid.');
  const decoded = await firebaseAuth.verifyIdToken(idToken, true);
  const phoneNumber = decoded.phone_number;
  const provider = decoded.firebase && decoded.firebase.sign_in_provider;
  const authTime = Number(decoded.auth_time);
  if (provider !== 'phone' || typeof phoneNumber !== 'string' || !E164_PHONE.test(phoneNumber)) throw new Error('A Firebase-verified phone sign-in is required.');
  if (!Number.isFinite(authTime) || authTime > nowSeconds || nowSeconds - authTime > 15 * 60) throw new Error('Phone verification has expired. Request a new OTP.');
  return phoneNumber;
}

async function verifyFirebaseGoogleToken(idToken, firebaseAuth, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 10000 || !firebaseAuth) throw new Error('Firebase Google sign-in is not configured or token is invalid.');
  const decoded = await firebaseAuth.verifyIdToken(idToken, true);
  const provider = decoded.firebase && decoded.firebase.sign_in_provider;
  const authTime = Number(decoded.auth_time);
  if (provider !== 'google.com' || typeof decoded.email !== 'string' || decoded.email_verified !== true) throw new Error('A verified Firebase Google sign-in is required.');
  if (!Number.isFinite(authTime) || authTime > nowSeconds || nowSeconds - authTime > 15 * 60) throw new Error('Google sign-in has expired. Please sign in again.');
  return { email: decoded.email.trim().toLowerCase(), name: String(decoded.name || '').trim().slice(0, 160) };
}

module.exports = { E164_PHONE, getFirebaseClientConfig, parseFirebaseServiceAccount, initializeFirebaseAdmin, initializeFirebaseAdminApp, verifyFirebasePhoneToken, verifyFirebaseGoogleToken };
