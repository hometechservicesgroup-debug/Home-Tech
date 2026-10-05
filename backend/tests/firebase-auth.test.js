const test = require('node:test');
const assert = require('node:assert/strict');
const { getFirebaseClientConfig, initializeFirebaseAdmin, verifyFirebasePhoneToken, verifyFirebasePhoneIdentity, verifyFirebaseGoogleToken } = require('../firebase-auth');

const webConfig = { FIREBASE_API_KEY: 'public-key', FIREBASE_AUTH_DOMAIN: 'home-tech.firebaseapp.com', FIREBASE_PROJECT_ID: 'home-tech', FIREBASE_APP_ID: '1:123:web:abc' };
const serviceAccount = { project_id: 'home-tech', client_email: 'firebase-admin@home-tech.iam.gserviceaccount.com', private_key: 'private-key' };

test('client config requires all web app settings and returns no service credentials', () => {
  assert.equal(getFirebaseClientConfig({ ...webConfig, FIREBASE_SERVICE_ACCOUNT_JSON: 'do-not-return' }).projectId, 'home-tech');
  assert.equal('serviceAccount' in getFirebaseClientConfig({ ...webConfig, FIREBASE_SERVICE_ACCOUNT_JSON: 'do-not-return' }), false);
  assert.equal(getFirebaseClientConfig({ FIREBASE_PROJECT_ID: 'home-tech' }), null);
});

test('Admin SDK initialization checks that service account belongs to configured project', () => {
  const auth = { verifyIdToken: async () => ({}) };
  const sdk = {
    apps: [],
    credential: { cert: value => value },
    initializeApp(options, name) {
      const app = { name, auth: () => auth, options };
      this.apps.push(app);
      return app;
    }
  };
  const initialized = initializeFirebaseAdmin({ FIREBASE_PROJECT_ID: 'home-tech', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) }, sdk);
  assert.equal(initialized, auth);
  assert.equal(sdk.apps[0].name, 'hometake-auth');
  assert.equal(initializeFirebaseAdmin({}, sdk), null);
  assert.throws(() => initializeFirebaseAdmin({ FIREBASE_PROJECT_ID: 'another-project', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) }, sdk), /do not match/);
});

test('server accepts only fresh Firebase phone sign-in tokens with an E.164 number', async () => {
  const auth = { verifyIdToken: async token => ({
    uid: 'uid-123',
    phone_number: '+919876543210',
    auth_time: 990,
    firebase: { sign_in_provider: 'phone' }
  }) };
  assert.equal(await verifyFirebasePhoneToken('x'.repeat(120), auth, 1000), '+919876543210');
  assert.deepEqual(await verifyFirebasePhoneIdentity('x'.repeat(120), auth, 1000), { uid: 'uid-123', phoneNumber: '+919876543210' });
  await assert.rejects(verifyFirebasePhoneToken('x'.repeat(120), { verifyIdToken: async () => ({ phone_number: '+919876543210', auth_time: 990, firebase: { sign_in_provider: 'password' } }) }, 1000), /phone sign-in/);
  await assert.rejects(verifyFirebasePhoneToken('x'.repeat(120), { verifyIdToken: async () => ({ phone_number: '+919876543210', auth_time: 1, firebase: { sign_in_provider: 'phone' } }) }, 1000), /expired/);
  await assert.rejects(verifyFirebasePhoneToken('short', auth, 1000), /token is invalid/);
  await assert.rejects(verifyFirebasePhoneIdentity('x'.repeat(120), { verifyIdToken: async () => ({ phone_number: '+919876543210', auth_time: 990, firebase: { sign_in_provider: 'phone' } }) }, 1000), /valid user ID/);
});

test('server accepts only fresh, verified Firebase Google sign-in tokens', async () => {
  const auth = { verifyIdToken: async () => ({ email: ' CUSTOMER@EXAMPLE.COM ', name: 'Customer', email_verified: true, auth_time: 990, firebase: { sign_in_provider: 'google.com' } }) };
  assert.deepEqual(await verifyFirebaseGoogleToken('x'.repeat(120), auth, 1000), { email: 'customer@example.com', name: 'Customer' });
  await assert.rejects(verifyFirebaseGoogleToken('x'.repeat(120), { verifyIdToken: async () => ({ email: 'customer@example.com', email_verified: false, auth_time: 990, firebase: { sign_in_provider: 'google.com' } }) }, 1000), /verified Firebase Google/);
  await assert.rejects(verifyFirebaseGoogleToken('x'.repeat(120), { verifyIdToken: async () => ({ email: 'customer@example.com', email_verified: true, auth_time: 990, firebase: { sign_in_provider: 'password' } }) }, 1000), /verified Firebase Google/);
  await assert.rejects(verifyFirebaseGoogleToken('x'.repeat(120), { verifyIdToken: async () => ({ email: 'customer@example.com', email_verified: true, auth_time: 1, firebase: { sign_in_provider: 'google.com' } }) }, 1000), /expired/);
});
const { parseFirebaseServiceAccount, initializeFirebaseAdminApp } = require('../firebase-auth');

test('service account parser accepts compact JSON and normalizes escaped private key newlines', () => {
  const value = { ...serviceAccount, private_key: 'line1\\nline2' };
  const parsed = parseFirebaseServiceAccount({ FIREBASE_PROJECT_ID: 'home-tech', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(value) });
  assert.equal(parsed.projectId, 'home-tech');
  assert.equal(parsed.serviceAccount.private_key, 'line1\nline2');
});

test('service account parser accepts Base64 JSON and gives actionable errors for invalid input', () => {
  const encoded = Buffer.from(JSON.stringify(serviceAccount), 'utf8').toString('base64');
  assert.deepEqual(parseFirebaseServiceAccount({ FIREBASE_PROJECT_ID: 'home-tech', FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: encoded }).serviceAccount, serviceAccount);
  assert.throws(() => parseFirebaseServiceAccount({ FIREBASE_PROJECT_ID: 'home-tech', FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: 'not valid!' }), /valid Base64/);
  assert.throws(() => parseFirebaseServiceAccount({ FIREBASE_PROJECT_ID: 'home-tech', FIREBASE_SERVICE_ACCOUNT_JSON: '{bad json' }), /valid Firebase service account JSON/);
});

test('storage admin reuses initialized app and does not initialize without a bucket', () => {
  const app = { name: 'hometake-auth' };
  const sdk = { apps: [app], initializeApp() { throw new Error('should reuse existing app'); } };
  assert.equal(initializeFirebaseAdminApp({ FIREBASE_PROJECT_ID: 'home-tech', FIREBASE_STORAGE_BUCKET: 'bucket', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) }, sdk), app);
  assert.equal(initializeFirebaseAdminApp({ FIREBASE_PROJECT_ID: 'home-tech', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) }, sdk), null);
});
