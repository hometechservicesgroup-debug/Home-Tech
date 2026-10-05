# Home-Tech backend

The backend uses the existing PostgreSQL database, Firebase Phone Authentication and Google sign-in, Cloudinary for new media, and PhonePe for customer booking payments and partner wallet recharge.

## Local development

1. Copy `.env.example` to `.env` and set the existing PostgreSQL connection in `DATABASE_URL`.
2. Add the Firebase Web App settings and Firebase Admin service account values. Set PhonePe sandbox credentials only if you have them.
3. Set `ALLOWED_ORIGIN` to your local website origin, such as `http://localhost:5500`, and set `PUBLIC_SITE_URL` to a reachable return URL.
4. Run `npm ci`, `npm run migrate`, then `npm start`.
5. Open the storefront at `http://localhost:4000/`, admin at `/admin.html`, and partner at `/partner.html`.

The customer phone must be verified with Firebase OTP before registration. Google login is for existing accounts with a matching verified Google email. Customer and partner bookings retain server-side ownership and price validation.

## Production

Render hosts this service. Keep the existing PostgreSQL connection; migrations are additive. Set all Firebase, PhonePe, CORS and admin environment variables in Render. Never put Firebase service account JSON or PhonePe client secret into a public HTML file, Netlify variable, or chat. Real SMS depends on Firebase Phone Authentication setup, billing, region policy, quota and authorized domains. PhonePe production checkout requires PhonePe merchant approval and production PG credentials after UAT.

New uploads use Cloudinary when configured; each file is limited to 50 MB. The current Cloudinary free plan has a shared monthly credit allowance for storage, bandwidth and transformations. Existing `/uploads` files use the local Render filesystem and need migration to durable storage.
