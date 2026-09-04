# FieldOps — Offline-First Field Worker Micro-SaaS

High-performance, mobile-first B2B for field workers, trade techs, site operators. Eliminates end-of-day admin with offline job management + one-tap AI. Public repo: **https://github.com/ausgreekdev-cpu/fieldops**

## Stack
- **Mobile:** React Native + Expo 52 + Expo Router + TypeScript, `expo-sqlite` + `drizzle-orm` (WAL), Zustand + TanStack Query, `expo-audio` (useAudioRecorder), `react-native-signature-canvas`
- **Backend:** Supabase (Postgres + Auth phone OTP/magic link + Storage + Edge Functions Deno)
- **AI:** Whisper (`whisper-1`) + GPT-4o-mini / Claude 3.5 via structured JSON schemas (`VoiceLogJsonSchema`, `ReceiptJsonSchema`)
- **Payments:** RevenueCat (`react-native-purchases`) for App Store/Play + Stripe (payment links + webhooks) for team tier

## Quick Start
```bash
npm install
cp .env.example .env  # EXPO_PUBLIC_SUPABASE_URL, ANON_KEY, REVENUECAT keys, AI_PROVIDER=openai
npm run typecheck && npx tsc --noEmit --skipLibCheck  # functions excluded via tsconfig

# Supabase local (needs Docker + supabase CLI: npm i -g supabase)
supabase start
supabase db reset   # applies supabase/migrations/001_schema.sql (RLS, buckets, triggers)
supabase functions serve --env-file ./supabase/.env.local --debug

# Secrets (never committed; copy supabase/.env.local.example → supabase/.env.local)
supabase secrets set OPENAI_API_KEY=sk-proj-... ANTHROPIC_API_KEY=sk-ant-... STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... REVENUECAT_WEBHOOK_SECRET=...

npx expo start  # QR in Expo Go; for web: npx expo install react-native-web react-dom && npx expo start --web
bash scripts/verify-offline.sh  # harness + manual E2E checklist
```

## Key Concepts
- **Local-first writes:** Every mutation (`src/sync/mutations.ts`, `ChecklistForm`, `generateInvoiceLocally`) writes to SQLite immediately, enqueues to `outbox` (status `pending|syncing|failed`, `next_retry_at`, `attempts`), shows `OfflineBanner` (“Offline • 3 pending”). `SyncManager` drains batch 10 with exponential backoff `1s * 2^attempts + jitter` cap 5m, NetInfo + 30s poll, stripe by `attempts >=10 → failed`.
- **Pull sync:** `SyncManager.pull(table)` hydrates via `last_pull_*` in `sync_meta`.
- **Files:** Photos/signatures/logos/PDFs → `FileSystem.documentDirectory` immediately, queued upload to buckets `company-logos|job-photos|signatures|invoices` with path `<company_id>/<job_id>/<file>`; RLS scoped by `my_company_id()` (`storage.foldername(name)[1]`), upsert with `local_uri` stripped.
- **AI:**
  - `process-voice-log` — `FormData{audio, job_id}` → Whisper → OpenAI `gpt-4o-mini` (`response_format: json_object`) with Anthropic fallback → `{formatted_notes, materials, follow_up_task, confidence}` → optional `auto_apply` to `jobs.notes/materials`, logs to `sync_logs`.
  - `parse-receipt` — `FormData{image, job_id}` → GPT-4o Vision (`image_url` base64 `detail: high`) → `{vendor, date, line_items, total, tax, currency}` → auto-apply to materials.
  - Both verify JWT via `getUserFromRequest`, check `users.company_id == jobs.company_id`, `15MB/10MB` limits, `supabaseAdmin` service_role.
  - `create-payment-link` — `amount/currency/invoice_number` → Stripe `payment_links.create` if `STRIPE_SECRET_KEY` else stub `https://pay.fieldops.example/...`, persists `payment_link`.
  - Webhooks: `stripe-webhook` (HMAC `stripe-signature` verification, handles `checkout.session.completed`, `payment_intent.succeeded` → `invoices.paid`, `customer.subscription.*` → `companies.subscription_tier`), `revenuecat-webhook` (Bearer `REVENUECAT_WEBHOOK_SECRET`, maps `INITIAL_PURCHASE|RENEWAL → pro/team`, `CANCELLATION|EXPIRATION → free` via `users.company_id`).
- **Checklists:** Seed defaults (Electrical 8, Heights 6) via `src/db/seed.ts`, `ChecklistForm` renders `pass_fail|checkbox|text|select|photo` + `SignaturePad` (offline PNG → `signatures` bucket), computes `pass|fail|pending`, queues `checklist_submissions` + photo uploads as `job_photos`.
- **Invoicing:** `generateInvoiceLocally` (materials → line_items → subtotal/tax/total, `@react-pdf` → `FileSystem` PDF, local `invoices` + outbox `_localPdfUri` → `invoices` bucket), `Invoices` tab share via `expo-sharing` + Stripe link + WhatsApp, `Jobs` detail one-tap `Generate Invoice (Offline)` for `completed → invoiced`.
- **Settings:** `app/settings.tsx` — logo picker (`ImagePicker` → `company-logos`), ABN/name, subscription badge (`pro|free` via `checkEntitlement`), `Paywall` modal (RevenueCat offerings).

## Database
- `supabase/migrations/001_schema.sql` — enums (`job_status`, `user_role`, `invoice_status`, `subscription_tier`), helpers `is_company_member`, `my_company_id`, `handle_new_auth_user`, `next_invoice_number()`, triggers `set_updated_at`, tables `companies|users|jobs|job_photos|job_signatures|compliance_checklists|checklist_submissions|invoices|sync_logs`, GIN/trgm indexes, RLS all tables + Storage `storage.objects` (`company-logos|job-photos|signatures|invoices`).
- Local mirror `src/db/schema.ts` + `src/db/client.ts` WAL auto-migrate, `src/db/seed.ts`.

## Project Layout
```
app/(auth)  login (phone OTP), verify-otp, onboarding (<60s company+logo+ABN)
app/(tabs)  jobs (Kanban filters), checklists (live templates + editor), invoices (list+share), settings (logo+paywall)
app/jobs    [id] (detail+voice+photo/receipt+checklists+invoice) + new (create offline)
app/checklists/[id]  template CRUD
src/components/ui  Button(48dp+), OfflineBanner, JobCard, VoiceButton(useAudioRecorder), SignaturePad, Paywall
src/features  checklists (ChecklistForm, useChecklists), invoices (generateInvoice, useInvoices, pdfTemplate), jobs
src/db  schema, client, seed
src/sync  SyncManager (outbox, backoff, storage uploads, markRecordSynced), useSyncStatus, mutations
src/lib  supabase (SecureStore), revenuecat, maps
supabase/functions  process-voice-log, parse-receipt, create-payment-link, stripe-webhook, revenuecat-webhook, _shared
scripts  verify-offline.sh, e2e-offline.test.ts
```

## UX Constraints
- Single-thumb 48-56dp, high-contrast WCAG AA, bottom primary actions, offline banner non-blocking (top, `Offline • X pending` + Retry).
- Tap-to-call / navigate (Google/Apple Maps via `Linking`), large hold-to-dictate, signature modal `pageSheet`.

## Verification
```bash
npm run typecheck  # tsc --noEmit --skipLibCheck (functions excluded)
npm test           # jest e2e-offline.test.ts (in-memory sqlite + mock supabase)
bash scripts/verify-offline.sh
# Manual: airplane mode create job → checklist+signature+voice → restore → check Supabase + Storage
```

## Webhooks
- Stripe Dashboard → `https://<project>.supabase.co/functions/v1/stripe-webhook` (events: `checkout.session.completed`, `payment_intent.succeeded`, `customer.subscription.*`), set `STRIPE_WEBHOOK_SECRET`
- RevenueCat → Integrations → Webhooks → `.../revenuecat-webhook`, set `REVENUECAT_WEBHOOK_SECRET`, configure `appUserID = supabase user id`

## EAS
- `eas.json` profiles `development|preview|production` — `eas build --profile preview` → TestFlight/Internal, OTA via `expo-updates`.

## Security
- Public repo keeps secrets out of git: `.env` + `supabase/.env.local` ignored, `supabase/.env.local.example` committed, `supabase secrets set` for Edge Functions, RLS `my_company_id()` scopes all data + Storage.
