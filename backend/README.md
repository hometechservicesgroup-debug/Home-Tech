# Backend setup

## Local development

1. Copy `.env.example` to `.env` and set your existing PostgreSQL connection in `DATABASE_URL`.
2. Set the Twilio Verify variables required for OTP. Razorpay variables are optional until online payment is enabled.
3. Set `ALLOWED_ORIGIN` to the local storefront origin, for example `http://localhost:5500`.
4. From this directory, run `npm ci`, `npm run migrate`, then `npm start`.
5. Open the storefront at `http://localhost:4000/`, the admin dashboard at `http://localhost:4000/admin.html`, and the partner dashboard at `http://localhost:4000/partner.html`. The frontend defaults to `http://localhost:4000` when served on localhost; its `api-base` meta value can override that.

To import the existing JSON records without deleting the source files, run `npm run migrate:json` after the schema migration. The import is insert-only and can be rerun; review its summary and resolve any records reported without a matching account before considering the import complete. Do not remove the JSON files until their imported counts and relationships are verified.

## Render Web Service

Deploy this `backend/` directory as the Node web service. Use `npm ci` as the build command and `npm start` as the start command. The server binds to Render's `PORT` on `0.0.0.0`, serves the existing HTML files, and connects through `DATABASE_URL`.

Set `NODE_ENV=production`, the existing PostgreSQL database's Render connection URL, `ALLOWED_ORIGIN` to the exact website origin, Twilio Verify credentials, and the admin bootstrap credentials if the database does not yet have an admin. Set Razorpay credentials only when online payments are configured. Never put server secrets in HTML or a static-site environment exposed to browsers.

Run `npm run migrate` against the existing PostgreSQL database before deploying code that depends on a new migration. This service configuration does not create a database.

Render's local filesystem is ephemeral. If admin uploads must survive deploys, attach a persistent disk and set `UPLOADS_DIR` to its mount path (for example `/var/data/uploads`). If the storefront or dashboards are deployed separately from this Node service, set each page's `<meta name="api-base" content="https://your-render-web-service.onrender.com">` to the public backend origin and include the page origin in `ALLOWED_ORIGIN`.
