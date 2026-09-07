# EAS Credentials — FieldOps (Google Play)

## One-time setup (Manager)

```bash
eas login  # ausgreekdev-cpu
eas credentials  # select com.fieldops.app → Android → Upload keystore → Managed (Play App Signing)
# Check:
eas credentials --platform android
# Store secrets (publishable only):
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://xxx.supabase.co
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value eyJ...
eas secret:create --scope project --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value goog_...
# Do NOT store OPENAI/STRIPE secrets here — they live on Supabase Edge Functions via `supabase secrets set`
```

## Build & Submit

```bash
# Preview AAB to internal track (fastest review <24h)
eas build --profile preview --platform android --auto-submit --track internal

# Production AAB (autoIncrement versionCode)
eas build --profile production --platform android --wait
eas submit --platform android --track internal  # then promote in Play Console: Closed → Production

# OTA (JS only, no versionCode bump)
eas update --branch production --message "hotfix offline banner"
```

## Local verification without EAS

```bash
npx expo prebuild --clean --platform android
npx expo-doctor
# or local AAB via Gradle (needs Android SDK)
npm run build:web  # for Linux/desktop; for Android use eas build
```

## Play Console Tracks

- **Internal** (1–100 testers, <24h) → start here
- **Closed** (≥12 testers 14 days, required for new devs since 2023) → promote from internal
- **Production** (staged 20% → 100%) → promote from closed

## Troubleshooting

- `versionCode` conflict: `eas.json production.autoIncrement true` handles it; if manual, bump `android.versionCode` in `app.json`.
- `RECORD_AUDIO` rejection: provide video demo in Play Console → App content → Permissions Declaration + justify “one-tap voice-to-job for field workers, no background”.
- `sb_publishable_...` previously pasted as AI key: rotate Supabase anon key in Supabase Dashboard → API → Reset.
