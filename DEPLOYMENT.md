# Home-Tech: VS Code to Render + Netlify

This package keeps the existing Git history, including the `Initial stable version` rollback point. It does not contain `.env` files, database contents, uploaded customer files, or `node_modules`.

## What this deploys

- Render runs the existing Node/Express API and connects to your existing PostgreSQL database. The Blueprint does **not** create, replace, or delete a database.
- Netlify serves the customer page at `/`, the admin page at `/admin.html`, and the partner page at `/partner.html`.
- The browser bundle gets the Render API URL during the Netlify build. Razorpay's public key is served by the backend; the secret remains server-side.
- Admin booking details include the customer's saved booking location and the assigned partner's latest location when the partner shares it. The customer's booking pin is the address/location selected at booking time; it is not continuous customer GPS tracking.

## One-time prerequisites

1. Create an empty GitHub repository and push this package to it (instructions below).
2. Keep access to the existing PostgreSQL connection string and Twilio Verify credentials from the existing backend `.env`. Do not paste secrets into chat or commit `.env`.
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
| `TWILIO_ACCOUNT_SID` | Existing Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify Service SID |
| `RAZORPAY_KEY_ID` | Razorpay Key ID for the chosen test/live mode |
| `RAZORPAY_KEY_SECRET` | Matching secret; server-side only |
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

Use a Razorpay test key pair first and make a real test checkout from the customer page. Switch both backend variables to the matching live pair only after verifying the test flow. Payment completion is confirmed by the server after it verifies Razorpay's signature against the authenticated booking and database quote.

Platform references: [Render Blueprint configuration](https://render.com/docs/blueprint-spec), [Render deployment guide](https://render.com/docs/your-first-deploy), [Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/), [Netlify environment variables](https://docs.netlify.com/build/environment-variables/get-started/).
