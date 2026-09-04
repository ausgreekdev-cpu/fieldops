# EAS Build & Submit — FieldOps

`eas.json` profiles: `development` (dev client), `preview` (internal), `production` (store).

```bash
npm i -g eas-cli
eas login
eas build:configure # if not already

# Preview (internal APK/IPA)
eas build --profile preview --platform all

# Production (store)
eas build --profile production --platform all
eas submit --platform ios --latest
eas submit --platform android --latest

# OTA Updates (expo-updates)
eas update --branch production --message "offline sync fix"
```

Env: `EXPO_PUBLIC_*` baked at build time via `eas.json` env or EAS Secrets. Secrets for Edge Functions set via `supabase secrets set` (not EAS).

RevenueCat: configure API keys in `app.json`/`eas.json` env, webhook `.../revenuecat-webhook`.

Icons: `assets/icon.png` (1024), `adaptive-icon.png`, `splash.png` (1284x2778) already placeholder — replace with branded assets before store submit.
