# Home-Tech Android app (TWA preparation)

This folder prepares an Android Trusted Web Activity (TWA) for the deployed PWA at `https://home-tech.pages.dev/`.

## Before generating the Android project

1. Deploy the PWA files from this repository and confirm the manifest is live at `https://home-tech.pages.dev/manifest.webmanifest`.
2. The confirmed Android application ID is `com.hometech.services`.
3. Install a JDK 17+ and Android SDK. They are not installed in the current development environment, so no APK/AAB can be built here yet.
4. Install Bubblewrap with `npm install --global @bubblewrap/cli`.
5. Run `bubblewrap init --manifest https://home-tech.pages.dev/manifest.webmanifest --directory ./generated`. When asked, use `com.hometech.services` as the package ID.
6. Generate the signing key only on a secure owner-controlled machine. Record the resulting SHA-256 certificate fingerprint.
7. Replace only the SHA-256 placeholder in `assetlinks.template.json`, then deploy it at `https://home-tech.pages.dev/.well-known/assetlinks.json` before the Play build.
8. Run `bubblewrap build` to create the debug APK / release AAB after signing is configured.

## Security boundaries

- The Android app is a TWA for the live site. It contains no Render, Firebase, Cloudinary, database, payment, or service-account secret.
- If Digital Asset Links are missing or invalid, Android opens the site in a Custom Tab rather than a verified full-screen TWA.
- Test customer, partner, admin, sign-in, bookings, cancellation, payments, image uploads and account-deletion request before Play submission.

## Play Console preparation

Use the policy checklist in `PLAY_STORE_CHECKLIST.md` before creating a production release. Data Safety answers must be completed from the actual deployed data flows and third-party SDK disclosures, not guessed from this template.
