# Home-Tech deployment

This repository keeps the `Initial stable version` Git rollback point and connects the current app to the existing PostgreSQL database. Migrations are additive; the Render Blueprint does not create, replace, or delete a database.

## Services

- Render hosts the Node API and connects to the existing PostgreSQL database.
- Netlify hosts the customer page, admin page, and partner page.
- Firebase Authentication sends phone sign-in codes and supports Google sign-in. Firebase Admin verifies sign-in tokens on the backend.
- Cloudinary stores new service images, gallery photos/videos, logos, and partner photos. Existing `/uploads/...` links remain readable during migration.
- Customers pay by scanning an admin-uploaded UPI QR. Bookings remain payment-pending until an admin verifies the transfer; partner wallet top-ups are arranged with support.

## Render environment variables

Set these in Render → `hometech-api` → Environment. Never put service secrets in Netlify or in HTML.

| Variable | What to enter |
|---|---|
| `DATABASE_URL` | The existing PostgreSQL connection string. Keep the same database. |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID` | Firebase Web App settings. The web API key is a client config value; the other server values stay on Render. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full Firebase service account JSON. Secret; Render only. |
| `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | Optional Base64-encoded service-account JSON. Use this if Render corrupts multiline JSON; secret, Render only. When set, it takes precedence. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary account credentials. Keep the API secret on Render only. |
| `ALLOWED_ORIGIN` | Same Netlify origin without a trailing slash. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Bootstrap credentials only if the existing database still needs its first admin. |

Keep `NODE_ENV=production`. Blueprint migrations run against the configured existing database during deploy. Do not run destructive database commands or recreate the database.

After deploying, open Admin → Branding, enter the optional UPI ID and upload the business QR image. Customer checkout can then open the UPI app from a phone when an ID is configured, or scan the QR from another device. Verify transfers in your business account before using “Verify UPI & Mark Paid” in the admin booking list.

## Firebase setup

1. In Firebase Console → Authentication → Sign-in method, enable **Phone** and **Google**.
2. In Authentication settings → Authorized domains, keep the exact Netlify hostname authorized. Confirm India is allowed under the phone SMS region policy. Firebase Phone Auth does not support `localhost` as a hosted domain for real SMS. For local UI/auth flow testing, configure a fictional Firebase test phone number/code; use an HTTPS staging hostname authorized in Firebase to test real SMS.
3. Real Firebase verification SMS requires a linked Cloud Billing account and uses per-SMS pricing; the Firebase Spark plan does not send production verification SMS. Add billing only if you accept those SMS charges. Firebase test numbers work without sending SMS or consuming Firebase SMS quota. Google login only works for an existing Home-Tech account whose email matches the verified Google email. Customers can sign in using either their existing email/password or phone OTP; a verified phone already in the customer table is linked to that same record, preserving its bookings.
4. Create a Cloudinary account and set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in Render. New media uploads go to Cloudinary; current file limit is 50 MB. The free plan currently includes 25 monthly credits shared across storage, bandwidth, and transformations, so monitor usage and review [Cloudinary pricing](https://cloudinary.com/pricing). Do not put the API secret in Netlify, HTML, chat, or source control.
5. Firebase service-account JSON remains on Render for backend token verification and login; it is no longer used for media storage. The customer page uses Firebase Web SDK modular imports from Google's CDN; the existing Web App config is still served by the backend `/api/auth/firebase-config` endpoint. No Firebase service-account credentials go to Netlify. After deploying, `/health` should show `otpEnabled: true`, `otpProvider: "firebase"`, and `cloudStorageEnabled: true` (Cloudinary configured).
6. The next Render deploy automatically runs an additive PostgreSQL migration that adds a Firebase UID link to existing customer records. It does not change or remove bookings, customer profiles, or Firestore data.

If phone OTP fails, the on-page message identifies common causes. Also inspect Firebase Authentication usage/quota, SMS region policy, billing, reCAPTCHA, and whether the current Netlify domain is authorized. OTP resend has a 60-second client countdown and still honors the existing three-requests-per-day backend limit. For local automated/manual verification, configure a fictional phone/code in Firebase Authentication → Sign-in method → Phone numbers for testing, then use that exact number/code in the app.

New admin service images, gallery images/videos, logos and partner photos go to Cloudinary. Uploads currently have a 50 MB per-file limit. Old local upload files are still ephemeral on Render unless copied to persistent storage.

## Netlify

Connect the GitHub repository with production branch `master` and build command `npm run build:netlify`. Set Netlify environment variable `RENDER_API_URL` to the Render API URL, then deploy. The build creates `dist` with `index.html`, `admin.html`, and `partner.html`. No Firebase secret or additional Firebase variable is required on Netlify; Firebase Web config is read from Render's public config endpoint.

After the final Netlify hostname is known, set `ALLOWED_ORIGIN` in Render to that exact HTTPS origin, save and redeploy. Useful URLs:

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
