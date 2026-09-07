# Google Play Store — FieldOps Release Guide

Package `com.fieldops.app` • Version `0.1.0` (versionCode auto via EAS) • Category Business • Free with in-app purchases (RevenueCat `pro`)

## Preflight (Do Once)

```bash
# EAS
npm i -g eas-cli
eas login  # ausgreekdev-cpu
eas credentials  # Android → upload keystore → Managed (Play App Signing)
# Secrets (publishable only in build, secrets via Supabase)
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://xxx.supabase.co
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value eyJ...
eas secret:create --scope project --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value goog_...
# Supabase secrets (never bundled)
supabase secrets set OPENAI_API_KEY=sk-proj-... ANTHROPIC_API_KEY=sk-ant-... STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... REVENUECAT_WEBHOOK_SECRET=...

# Local checks
npm run typecheck && npm test && npx expo-doctor
npx expo prebuild --clean --platform android  # dry-run, check app.json perms
```

## Build

```bash
# Preview (internal APK for manual test)
eas build --profile preview --platform android --auto-submit --track internal --non-interactive

# Production AAB (autoIncrement versionCode)
eas build --profile production --platform android --wait
# Verify
bundletool build-apks --bundle=build-*.aab --output=/tmp/app.apks
bundletool install-apks --apks=/tmp/app.apks  # on connected device
# Smoke: airplane → + New Job → checklist+signature → voice → restore → debug queue drain + audit
```

## Play Console — App Setup (One-Time)

1. **Create app:** Name `FieldOps`, package `com.fieldops.app` already reserved, `Free`, `Contains ads: No`, `Target >18`.
2. **Store listing (Business):**
   - Title (30–50): `FieldOps — Offline Jobs, AI Logs, Invoices`
   - Short (≤80): `Offline job cards + one-tap Whisper/Claude logs, checklists, branded PDFs.`
   - Full (≤4000): Copy from `docs/PLAY_STORE.md` “Full description” below + offline-first bullets + AI + checklists + Stripe link.
   - Contact: `fieldops@example.com`, website `https://github.com/ausgreekdev-cpu/fieldops`, privacy `https://ausgreekdev-cpu.github.io/fieldops/privacy` (host `docs/PRIVACY.md` via GitHub Pages), terms `https://ausgreekdev-cpu.github.io/fieldops/terms` (stub).
   - Category Business, tags `field, offline, invoices`.
   - Graphics: 512x512 icon (`assets/icon.png` placeholder → replace before submit), 1024x500 feature graphic (`store/feature-graphic.png`), Phone screenshots 1080x1920 ×4 (Kanban, Job Detail + Voice, Checklist+Signature, Invoices+PDF), Tablet optional 7" 10", Chromebook optional.
3. **Content rating:** IARC → Business, no violence → `Everyone` (PEGI 3) → Submit.
4. **Data safety:** Declare `Location (precise)`, `Photos`, `Microphone`, `Phone`, `App info` → Purpose `App functionality`, `Ephemeral` where noted, `Encrypted in transit`, `No sharing with third parties` except `OpenAI/Anthropic` for voice/receipt (disclose), `User can delete` via Settings → Delete job + contact email. Answer `Background location: No`, `Ads: No`, `Encryption: Yes`.
5. **Target audience & Content:** `18+`, `No ads`, `No social features`, `Encryption: uses HTTPS only (No export compliance docs needed)`.
6. **App access:** If login required for review, provide test OTP: `+61 400 000 001` / code `000000` (Supabase test user seeded via `seedDemoJobs` + `handle_new_auth_user`), instructions in `App access → Provide instructions`.
7. **Permissions declaration:** For `RECORD_AUDIO` (voice dictation) add video demo link (one-tap hold → transcript → formatted_notes) + justification “Field workers dictate job logs hands-free on site, no background recording”. For `CAMERA` similar + “job evidence, receipt/plate, checklist photo proof”. For `ACCESS_FINE_LOCATION` justify “tap-to-navigate to job site, foreground only”.

## Tracks

- **Internal testing (Day 0):** `eas submit --platform android --track internal` or manual upload `.aab` → add 1–100 testers (`ausgreekdev-cpu`, `paintvault@example.com`), verify purchase `pro` sandbox + `canEditTemplates` gates.
- **Closed testing (Day 1–14):** Promote to `closed` with ≥12 testers for 14 days (Play new-dev rule since 2023) → collect feedback, no production yet.
- **Production (Day 14+):** Promote `closed → production` (staged 20% → 100%), monitor `Play Console → Statistics` + `Sentry` (`src/lib/monitoring.ts`) + `supabase sync_logs`.

## Full Description (Store Listing)

FieldOps is the offline-first OS for electricians, plumbers, HVAC and site crews — built for single-thumb use on site.

• **Jobs Kanban:** Scheduled → In Progress → Completed → Invoiced, tap-to-call / tap-to-navigate (Google/Apple Maps), local photo capture, signature, notes — all queued offline and synced when back online (SyncManager batch 10, exponential backoff, Never blocks).

• **One-tap AI:** Hold-to-dictate Voice-to-Job (Whisper + GPT-4o/Claude → formatted_notes + materials + follow-up task) and Visual Receipt/Plate parser (Vision → line items → bill) via Supabase Edge Functions with structured JSON.

• **Safety Checklists:** Custom pass/fail templates per job type (Pre-Start Electrical 8 items, Heights 6 seeded), photo proof + timestamped signature, offline-first with signature Pad, audit log.

• **Invoices:** One-tap branded PDF from job materials (ABN, tax), share via SMS/WhatsApp/email, Stripe Payment Links for instant on-site collection.

• **Team:** Phone OTP / Magic Link auth, role gating (owner>admin>technician), Free 3 jobs/5 AI logs/mo → Pro unlimited via RevenueCat.

Offline banner “Offline • 3 pending” + Sync Debug queue viewer (attempts, next_retry). Built with Expo 52, expo-sqlite/WAL, Supabase Postgres RLS, EAS.

Support: fieldops@example.com • Privacy: ausgreekdev-cpu.github.io/fieldops/privacy

## Checklist Before Submit

- [ ] Replace `assets/icon.png` 1024 + generate 1024x500 feature graphic (dark #0F172A with F) — current is PIL placeholder
- [ ] Screenshots: exports from `expo start` + device (see docs/EAS.md)
- [ ] Host `docs/PRIVACY.md` at `https://ausgreekdev-cpu.github.io/fieldops/privacy` (enable GitHub Pages: Settings → Pages → main /docs)
- [ ] Run `npx expo-doctor` + `eas build --profile production --platform android` → `versionCode` autoIncrement check
- [ ] Data Safety answers match `docs/PRIVACY.md` table
- [ ] Provide test credentials in Play Console App access
- [ ] Rotate `sb_publishable_...` that was pasted as AI key earlier (if real)
