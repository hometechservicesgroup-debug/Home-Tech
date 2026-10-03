# Home-Tech: VS Code to Render + Netlify

This package keeps the existing Git history, including the `Initial stable version` rollback point. It does not contain `.env` files, database contents, uploaded customer files, or `node_modules`.

## What this deploys

- Render runs the existing Node/Express API and connects to your existing PostgreSQL database. The Blueprint does **not** create, replace, or delete a database. Its build step runs the project's tracked migrations against that database before starting the API; migrations are versioned and do not recreate the database.
- Netlify serves the customer page at `/`, the admin page at `/admin.html`, and the partner page at `/partner.html`.
- The browser bundle gets the Render API URL during the Netlify build. Razorpay's public key is served by the backend; the secret remains server-side.
- Admin booking details include the customer's saved booking location and the assigned partner's latest location when the partner shares it. The customer's booking pin is the address/location selected at booking time; it is not continuous customer GPS tracking.

## One-time prerequisites

1. Create an empty GitHub repository and push this package to it (instructions below).
2. Keep access to the existing PostgreSQL connection string. Create an MSG91 account and an OTP Widget with mobile and email channels. Do not paste secrets into chat or commit `.env`.
3. Have the Razorpay **Key ID and Key Secret pair from the same mode** (test keys for test payments, live keys for live payments). Never put the secret in Netlify or frontend code.
4. Choose the final Netlify site address first, so it can be entered as Render's `ALLOWED_ORIGIN`.

Render's free service uses temporary local storage. Uploaded files may disappear after a restart/redeploy; for persistent production uploads, attach a Render disk on a paid service or configure external object storage and set `UPLOADS_DIR` accordingly.

## 1. Open and push from VS Code

Extract the ZIP, open the extracted `hometake-services` folder in VS Code, then open **Terminal → New Terminal**. Run:

```powershell
git status
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin master
```

The included branch is `master`. GitHub may ask you to sign in in a browser. The ZIP's Git history includes the stable rollback commit.

## 2. Create the Render API

In Render, choose **New → Blueprint**, select the GitHub repository you just pushed, and deploy the checked-in `render.yaml`. Render asks for the values marked `sync: false`. Add these from your existing backend configuration / dashboards:

| Render variable | Value |
|---|---|
| `DATABASE_URL` | Existing PostgreSQL connection string (keep the same database) |
| `MSG91_AUTH_KEY` | MSG91 API Auth Key; keep it only on Render/backend |
| `MSG91_WIDGET_ID` | ID of the MSG91 OTP Widget configured for phone and email |
| `RAZORPAY_KEY_ID` | Razorpay Key ID for the chosen test/live mode |
| `RAZORPAY_KEY_SECRET` | Matching secret; server-side only |
| `RAZORPAY_ALLOW_TEST_KEYS` | Set to `true` only to temporarily test Razorpay test keys on the Render production service; remove/set `false` for live payment mode |
| `ALLOWED_ORIGIN` | Exact Netlify origin, e.g. `https://your-site.netlify.app` (no trailing slash) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Bootstrap values only if the existing database still needs its first admin |

Do not create a new Render database if you already have the app's PostgreSQL database. After deployment, copy the service's `https://....onrender.com` address. Check `https://....onrender.com/health`; it should report the API/database as healthy. Render may take time to wake a free service after inactivity.

## 3. Build and deploy the Netlify site

Install Node.js LTS, Git, and the two platform CLIs if they are not already installed:

```powershell
npm install --global netlify-cli
```

In the VS Code terminal at the project root:

```powershell
netlify login
netlify init
netlify env:set RENDER_API_URL https://YOUR-RENDER-SERVICE.onrender.com
npm run deploy:netlify
```

During `netlify init`, create or link the Netlify site for this project. The build script writes the Render API URL into the generated pages, then publishes `dist`. Do not use Razorpay credentials with `netlify env:set`.

After Netlify gives you its final site URL, set that exact origin as Render's `ALLOWED_ORIGIN` (Render Dashboard → service → Environment), then redeploy/restart the Render service. If the URL changes later, update both `ALLOWED_ORIGIN` on Render and `RENDER_API_URL` on Netlify, then redeploy.

## Local build and check

To generate the same static files locally (no credentials are required for this build):

```powershell
$env:RENDER_API_URL = 'https://YOUR-RENDER-SERVICE.onrender.com'
npm run build:netlify
```

Useful live URLs after deployment:

- Customer: `https://YOUR-SITE.netlify.app/`
- Admin: `https://YOUR-SITE.netlify.app/admin.html`
- Partner: `https://YOUR-SITE.netlify.app/partner.html`
- API health: `https://YOUR-RENDER-SERVICE.onrender.com/health`

For a hosted test checkout, set `RAZORPAY_ALLOW_TEST_KEYS=true` on Render with the matching Razorpay test key pair. `/health` then reports `paymentMode: "test"`; test mode cannot collect real money and the checkout labels it as a test payment. Before collecting real payments, replace both keys with the matching live pair and remove/set `RAZORPAY_ALLOW_TEST_KEYS=false`. Payment completion is confirmed by the server after it verifies Razorpay's signature against the authenticated booking and database quote.

## 4. Set up MSG91 OTP (SMS and email)

1. Create/sign in to an account at [MSG91](https://msg91.com/signup) and complete the requested account verification.
2. In the MSG91 dashboard, open **OTP Widget** and create a widget. Enable both **mobile number** and **email**, configure the OTP expiry, length, and templates, then copy the **Widget ID**.
3. For Indian SMS delivery, complete MSG91's DLT setup: business/entity registration, sender header, and approval of the OTP message template. Delivery depends on account approval and available balance/plan.
4. Configure the widget's email channel and sender/domain settings in MSG91. Test an email from the MSG91 dashboard.
5. In Render → `hometech-api` → **Environment**, add `MSG91_AUTH_KEY` (server API Auth Key) and `MSG91_WIDGET_ID` (widget ID). Save and redeploy. Never enter the Auth Key in Netlify or website code.
6. Open `https://YOUR-RENDER-SERVICE.onrender.com/health`. It should show `otpEnabled: true` and `otpProvider: "msg91"`. Test a phone and email you control through sign-up.

The app uses MSG91 for OTP after this code is deployed. MSG91's OTP Widget supports phone and email and requires a configured Widget ID and request ID for verification; see [MSG91 OTP Widget documentation](https://docs.msg91.com/otp-widget).

Platform references: [Render Blueprint configuration](https://render.com/docs/blueprint-spec), [Render deployment guide](https://render.com/docs/your-first-deploy), [Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/), [Netlify environment variables](https://docs.netlify.com/build/environment-variables/get-started/).
