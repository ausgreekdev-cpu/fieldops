# FieldOps — Offline-First Field Worker Micro-SaaS

High-performance, mobile-first B2B platform for field workers, trade technicians, and site operators. Eliminates end-of-day admin with offline job management + one-tap AI.

## Stack
- **Mobile:** React Native + Expo 52 + Expo Router + TypeScript, `expo-sqlite` + `drizzle-orm` (offline-first), Zustand + TanStack Query
- **Backend:** Supabase (Postgres, Auth (phone OTP / magic link), Storage, Edge Functions (Deno))
- **AI:** Whisper + GPT-4o / Claude 3.5 via Edge Functions with structured JSON schemas
- **Payments:** RevenueCat (iOS/Android) + Stripe webhooks

## Quick Start
```bash
npm install
cp .env.example .env   # set EXPO_PUBLIC_SUPABASE_URL etc.
npx expo start

# Supabase local
supabase start
supabase db reset   # runs supabase/migrations/001_schema.sql
supabase functions serve --env-file ./supabase/.env.local --debug
supabase secrets set OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-...
```

## Key Concepts
- **Local-first writes:** Every mutation (`src/sync/mutations.ts`) writes to SQLite immediately, enqueues to `outbox`, shows `OfflineBanner`. `SyncManager` drains with exponential backoff (1s * 2^attempts + jitter, cap 5m).
- **Pull sync:** `SyncManager.pull(table)` hydrates from Supabase via `last_pull_*` in `sync_meta`.
- **Files:** Photos stored to `FileSystem.documentDirectory`, queued upload to Supabase Storage bucket path `<company_id>/<job_id>/<file>`; RLS scoped by `my_company_id()`.
- **AI:**
  - `process-voice-log` — `audio` (FormData) + `job_id` → Whisper → GPT/Claude structured JSON → optional auto-apply to `jobs.notes/materials`.
  - `parse-receipt` — `image` + `job_id` → GPT-4o Vision → line items → optional auto-apply.
  Both verify JWT, check `users.company_id == jobs.company_id`, log to `sync_logs`.

## Database
- `supabase/migrations/001_schema.sql` — companies, users, jobs (Kanban statuses), job_photos/signatures, compliance_checklists, checklist_submissions, invoices, sync_logs, Storage buckets + RLS (`is_company_member`, `my_company_id()`).
- Local mirror in `src/db/schema.ts`, auto-migrated on first `getDb()`.

## Project Layout
```
app/(auth)  login, verify-otp, onboarding (<60s)
app/(tabs)  jobs (Kanban), checklists, invoices
app/jobs/[id].tsx  detail + VoiceButton + photo/receipt
src/components/ui  Button (48dp+), OfflineBanner, JobCard, VoiceButton (press-and-hold)
src/db  schema + expo-sqlite client (WAL)
src/sync  SyncManager + useSyncStatus + mutations
supabase/functions  process-voice-log, parse-receipt, _shared
```

## UX Constraints
- Single-thumb, 48-56dp targets, high-contrast, offline banner never blocks input.
- Tap-to-call / tap-to-navigate (Google/Apple Maps), large Voice button.

## Verification
```bash
npm run typecheck
npm test
```

## Next Steps
- Add signature pad (`react-native-signature-canvas`) + checklist form engine
- Wire PDF share via `expo-sharing` + Stripe Payment Links in `invoices` edge function
- EAS Build profiles in `eas.json`
