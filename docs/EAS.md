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

Icons: `assets/icon.png` (1024², navy/white F), `adaptive-icon.png` (1024² transparent foreground — 600px glyph inside the circle keyline), `splash.png` (1284²) — branded, not placeholders; regenerate from `icon.png` if the mark changes.
