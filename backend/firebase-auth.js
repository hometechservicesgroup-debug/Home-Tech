const E164_PHONE = /^\+[1-9]\d{7,14}$/;

function getFirebaseClientConfig(environment = process.env) {
  const { FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID } = environment;
  if (![FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID].every(value => typeof value === 'string' && value.trim())) return null;
  return { apiKey: FIREBASE_API_KEY.trim(), authDomain: FIREBASE_AUTH_DOMAIN.trim(), projectId: FIREBASE_PROJECT_ID.trim(), appId: FIREBASE_APP_ID.trim() };
}

function parseFirebaseServiceAccount(environment = process.env) {
  const projectId = String(environment.FIREBASE_PROJECT_ID || '').trim();
  const encoded = String(environment.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || '').replace(/\s/g, '');
  const raw = String(environment.FIREBASE_SERVICE_ACCOUNT_JSON || '').replace(/^\uFEFF/, '').trim();
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
  serviceAccount.private_key = String(serviceAccount.private_key)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
  return { projectId, serviceAccount };
}

function getAdminModules(adminSdk) {
  // firebase-admin v14 documents its modular APIs in these submodules.
  if (!adminSdk) return { appSdk: require('firebase-admin/app'), authSdk: require('firebase-admin/auth') };
  // Injected SDKs keep tests simple and support older namespace SDK versions.
  return { appSdk: adminSdk, authSdk: adminSdk };
}

function getAdminApps(appSdk) {
  if (typeof appSdk.getApps === 'function') return appSdk.getApps();
  return Array.isArray(appSdk.apps) ? appSdk.apps : [];
}

function getNamedAdminApp(appSdk) {
  return getAdminApps(appSdk).find(app => app.name === 'hometake-auth');
}

function getAdminAuth(authSdk, app) {
  // Prefer modular API; retain compatibility with older namespace SDKs.
  if (typeof authSdk.getAuth === 'function') return authSdk.getAuth(app);
  if (typeof app.auth === 'function') return app.auth();
  throw new Error('Firebase Admin Auth is unavailable in this SDK.');
}

function createAdminCredential(appSdk, serviceAccount) {
  if (typeof appSdk.cert === 'function') return appSdk.cert(serviceAccount);
  if (appSdk.credential && typeof appSdk.credential.cert === 'function') return appSdk.credential.cert(serviceAccount);
  throw new Error('Firebase Admin cert() is unavailable in this SDK.');
}

function initializeAdminApp(appSdk, serviceAccount, projectId, storageBucket) {
  const options = { credential: createAdminCredential(appSdk, serviceAccount), projectId, storageBucket: storageBucket || undefined };
  if (typeof appSdk.initializeApp === 'function') return appSdk.initializeApp(options, 'hometake-auth');
  throw new Error('Firebase Admin initializeApp() is unavailable in this SDK.');
}

function initializeFirebaseAdmin(environment = process.env, injectedSdk = null) {
  const credentials = parseFirebaseServiceAccount(environment);
  if (!credentials) return null;
  const { projectId, serviceAccount } = credentials;
  const { appSdk, authSdk } = getAdminModules(injectedSdk);
  const existing = getNamedAdminApp(appSdk);
  const bucketName = String(environment.FIREBASE_STORAGE_BUCKET || '').trim();
  const app = existing || initializeAdminApp(appSdk, serviceAccount, projectId, bucketName);
  return getAdminAuth(authSdk, app);
}

function initializeFirebaseAdminApp(environment = process.env, injectedSdk = null) {
  const credentials = parseFirebaseServiceAccount(environment);
  const bucketName = String(environment.FIREBASE_STORAGE_BUCKET || '').trim();
  if (!credentials || !bucketName) return null;
  const { projectId, serviceAccount } = credentials;
  const { appSdk } = getAdminModules(injectedSdk);
  return getNamedAdminApp(appSdk) || initializeAdminApp(appSdk, serviceAccount, projectId, bucketName);
}
async function verifyFirebasePhoneToken(idToken, firebaseAuth, nowSeconds = Math.floor(Date.now() / 1000)) {
  const identity = await verifyFirebasePhoneIdentity(idToken, firebaseAuth, nowSeconds);
  return identity.phoneNumber;
}

async function verifyFirebasePhoneIdentity(idToken, firebaseAuth, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 10000 || !firebaseAuth) throw new Error('Firebase phone verification is not configured or token is invalid.');
  const decoded = await firebaseAuth.verifyIdToken(idToken, true);
  const phoneNumber = decoded.phone_number;
  const provider = decoded.firebase && decoded.firebase.sign_in_provider;
  const authTime = Number(decoded.auth_time);
  if (provider !== 'phone' || typeof phoneNumber !== 'string' || !E164_PHONE.test(phoneNumber)) throw new Error('A Firebase-verified phone sign-in is required.');
  if (!Number.isFinite(authTime) || authTime > nowSeconds || nowSeconds - authTime > 15 * 60) throw new Error('Phone verification has expired. Request a new OTP.');
  if (typeof decoded.uid !== 'string' || !decoded.uid.trim()) throw new Error('Firebase phone sign-in did not return a valid user ID.');
  return { uid: decoded.uid, phoneNumber };
}

async function verifyFirebaseSocialToken(idToken, firebaseAuth, expectedProvider, nowSeconds = Math.floor(Date.now() / 1000)) {
  const providerNames = { 'google.com': 'Google', 'facebook.com': 'Facebook' };
  const providerName = providerNames[expectedProvider] || 'social';
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 10000 || !firebaseAuth) throw new Error(`Firebase ${providerName} sign-in is not configured or token is invalid.`);
  const decoded = await firebaseAuth.verifyIdToken(idToken, true);
  const provider = decoded.firebase && decoded.firebase.sign_in_provider;
  const authTime = Number(decoded.auth_time);
  if (provider !== expectedProvider || typeof decoded.email !== 'string' || !decoded.email.trim() || (expectedProvider === 'google.com' && decoded.email_verified !== true)) {
    throw new Error(expectedProvider === 'google.com' ? 'A verified Firebase Google sign-in is required.' : `A valid Firebase ${providerName} sign-in with an email address is required.`);
  }
  if (!Number.isFinite(authTime) || authTime > nowSeconds || nowSeconds - authTime > 15 * 60) throw new Error(`${providerName} sign-in has expired. Please sign in again.`);
  if (typeof decoded.uid !== 'string' || !decoded.uid.trim()) throw new Error(`Firebase ${providerName} sign-in did not return a valid user ID.`);
  return { uid: decoded.uid, email: decoded.email.trim().toLowerCase(), name: String(decoded.name || '').trim().slice(0, 160) };
}

function verifyFirebaseGoogleToken(idToken, firebaseAuth, nowSeconds = Math.floor(Date.now() / 1000)) {
  return verifyFirebaseSocialToken(idToken, firebaseAuth, 'google.com', nowSeconds);
}

function verifyFirebaseFacebookToken(idToken, firebaseAuth, nowSeconds = Math.floor(Date.now() / 1000)) {
  return verifyFirebaseSocialToken(idToken, firebaseAuth, 'facebook.com', nowSeconds);
}

module.exports = { E164_PHONE, getFirebaseClientConfig, parseFirebaseServiceAccount, initializeFirebaseAdmin, initializeFirebaseAdminApp, verifyFirebasePhoneToken, verifyFirebasePhoneIdentity, verifyFirebaseSocialToken, verifyFirebaseGoogleToken, verifyFirebaseFacebookToken };
