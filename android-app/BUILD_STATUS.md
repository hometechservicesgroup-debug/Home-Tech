# Build status — 22 October 2026

Production PWA endpoints were verified successfully:

- `https://home-tech.pages.dev/`
- `https://home-tech.pages.dev/manifest.webmanifest`
- `https://home-tech.pages.dev/assets/pwa/icon-192.png`
- `https://home-tech.pages.dev/account-deletion.html`

The current build environment has Node.js, npm and npx, but does **not** have a JDK, `keytool`, Android SDK, Gradle, or Android Debug Bridge. Therefore no Android project generation, SHA-256 release certificate fingerprint, signed APK, or signed AAB was produced here.

Once a JDK and Android SDK are installed on an owner-controlled development machine, run `generate-twa-project.ps1`. Keep its signing keystore outside Git. Use the key's real SHA-256 fingerprint with `prepare-assetlinks.ps1`; then deploy the resulting `assetlinks.json` to `/.well-known/assetlinks.json` before testing the TWA.
