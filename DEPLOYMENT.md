# Home-Tech deployment

This repository keeps the `Initial stable version` Git rollback point and connects the current app to the existing PostgreSQL database. Migrations are additive; the Render Blueprint does not create, replace, or delete a database.

## Services

- Render hosts the Node API and connects to the existing PostgreSQL database.
- Netlify hosts the customer page, admin page, and partner page.
- Firebase Authentication sends phone sign-in codes and supports Google sign-in. Firebase Admin verifies sign-in tokens on the backend.
- Firebase Storage stores new images and videos in the configured bucket. Existing `/uploads/...` links remain readable during migration.
- PhonePe is the only payment gateway used for customer bookings and partner wallet recharge.

## Render environment variables

Set these in Render → `hometech-api` → Environment. Never put service secrets in Netlify or in HTML.

| Variable | What to enter |
|---|---|
| `DATABASE_URL` | The existing PostgreSQL connection string. Keep the same database. |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID` | Firebase Web App settings. The web API key is a client config value; the other server values stay on Render. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full Firebase service account JSON. Secret; Render only. |
| `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | Optional Base64-encoded service-account JSON. Use this if Render corrupts multiline JSON; secret, Render only. When set, it takes precedence. |
| `FIREBASE_STORAGE_BUCKET` | Exact bucket name from Firebase Console → Storage. |
| `PHONEPE_ENV` | `sandbox` for local testing. On the live Render service set `production` only after PhonePe provides production PG credentials and approves UAT. The live API intentionally disables sandbox checkout. |
| `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_VERSION`, `PHONEPE_CLIENT_SECRET` | PhonePe PG credentials. Keep the secret on Render only. |
| `PUBLIC_SITE_URL` | Exact HTTPS Netlify site URL, such as `https://your-site.netlify.app`. |
| `ALLOWED_ORIGIN` | Same Netlify origin without a trailing slash. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Bootstrap credentials only if the existing database still needs its first admin. |

Keep `NODE_ENV=production`. Blueprint migrations run against the configured existing database during deploy. Do not run destructive database commands or recreate the database.

PhonePe production access requires a merchant account, UAT and PhonePe approval. Production credentials cannot be substituted with sandbox credentials. The server confirms payment with PhonePe's order status API before it records a booking or credits a partner wallet. See PhonePe [Authorization](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/authorization), [Create Payment](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/create-payment), [Order Status](https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/order-status), and [Go Live](https://developer.phonepe.com/payment-gateway/uat-testing-go-live/go-live).

## Firebase setup

1. In Firebase Console → Authentication → Sign-in method, enable **Phone** and **Google**.
2. In Authentication settings → Authorized domains, add the exact Netlify hostname. Add `localhost` only for local testing. Confirm India is allowed under the phone SMS region policy.
3. Real Firebase phone SMS requires the project to meet Firebase billing, quota and region requirements. Google sign-in does not send phone OTPs. Google login only works for an existing Home-Tech account whose email matches the verified Google email; new accounts still register with phone OTP.
4. Create or select the Firebase Storage bucket and a service account with the required storage access. Put the full service account JSON and bucket name in Render. If multiline JSON is rejected, set `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` instead; Base64-encode the JSON file contents locally, paste only the encoded value in Render, and leave the raw variable empty. Do not share either value in chat or commit it. Admin service photos, gallery photos/videos, site logo, and partner application photos upload to that bucket. Each current upload is capped at 50 MB. Firebase Storage is not unlimited free storage; current Firebase setup requires the Blaze plan and usage charges may apply, especially for video and downloads. Review [Firebase plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) and [Storage pricing](https://firebase.google.com/pricing).
5. After deploying, `/health` should show `otpEnabled: true`, `otpProvider: "firebase"`, and `cloudStorageEnabled: true`.

If phone OTP fails, the on-page message identifies common causes. Also inspect Firebase Authentication usage/quota, SMS region policy, billing, reCAPTCHA, and whether the current Netlify domain is authorized. Firebase test phone numbers do not send actual SMS.

New admin service images, gallery images/videos, logos and partner photos go to Firebase Storage. Uploads currently have a 50 MB per-file limit. Old local upload files are still ephemeral on Render unless copied to persistent storage.

## Netlify

Connect the GitHub repository with production branch `master` and build command `npm run build:netlify`. Set Netlify environment variable `RENDER_API_URL` to the Render API URL, then deploy. The build creates `dist` with `index.html`, `admin.html`, and `partner.html`.

After the final Netlify hostname is known, set `PUBLIC_SITE_URL` and `ALLOWED_ORIGIN` in Render to that exact HTTPS origin, save and redeploy. Useful URLs:

- Customer: `https://YOUR-SITE.netlify.app/`
- Admin: `https://YOUR-SITE.netlify.app/admin.html`
- Partner: `https://YOUR-SITE.netlify.app/partner.html`
- API health: `https://YOUR-RENDER-SERVICE.onrender.com/health`

## Local checks

From the project root in PowerShell:

```powershell
$env:RENDER_API_URL = 'https://YOUR-RENDER-SERVICE.onrender.com'
npm run build:netlify
cd backend
npm ci
npm test
```
