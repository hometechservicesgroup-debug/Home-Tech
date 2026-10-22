# Google Play release checklist

## Product

- [ ] Final Android application ID confirmed by the owner.
- [ ] Release signing key stored securely and SHA-256 fingerprint placed in the deployed Digital Asset Links file.
- [ ] TWA launches verified at `https://home-tech.pages.dev/` without falling back to a Custom Tab.
- [ ] Customer, partner and administrator flows work on a physical Android device.
- [ ] Booking, mobile-number validation, cancellation, payment instructions, image upload and sign-in are tested against production.
- [ ] Account deletion is reachable in the signed-in customer account and at `https://home-tech.pages.dev/account-deletion.html`.

## Play Console

- [ ] App name, short description, full description, category, contact email and privacy-policy URL are supplied.
- [ ] Screenshots and a 512 x 512 Play Store icon are uploaded.
- [ ] Data Safety form matches the live application and every enabled third-party SDK/service.
- [ ] App access instructions are supplied if Play review needs a test account.
- [ ] Content rating and target audience questionnaires are completed accurately.
- [ ] Target SDK is set to the Play-required current level at the time of release.
- [ ] An internal test track is approved before production rollout.
