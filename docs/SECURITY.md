# Security — FieldOps

## RLS Audit (supabase/migrations/001_schema.sql)
- All tables `ENABLE ROW LEVEL SECURITY` + policies scoped to `my_company_id()` / `is_company_member(target_company)` — no anon bypass.
- `users` trigger `handle_new_auth_user()` auto-creates profile on `auth.users` insert, `company_id` nullable until onboarding.
- Storage `storage.objects` policy checks `foldername(name)[1] = my_company_id()::text` for buckets `company-logos|job-photos|signatures|invoices` — prefix == company_id prevents cross-tenant read.
- Service_role only in Edge Functions (`supabaseAdmin.ts`), never in client (`supabase.ts` uses anon key + SecureStore).
- Edge Functions verify JWT via `getUserFromRequest(req)` and re-check `users.company_id == jobs.company_id` for every job mutation.

## Secret Handling
- Publishable keys (`EXPO_PUBLIC_SUPABASE_*`, `REVENUECAT_*`): committed in `.env.example` only as placeholders, real values in `.env` (ignored) and EAS Secrets.
- Secret keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `REVENUECAT_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`): never committed, set via `supabase secrets set` and EAS Secrets; webhooks verify HMAC/Bearer.
- Repo is PUBLIC but `.env` + `supabase/.env.local` are gitignored; `supabase/.env.local.example` documents shape without values.

## Input Validation
- Zod schemas `src/lib/validation.ts`: `jobCreateSchema` (title ≥3, address ≥5, phone `+?[0-9 ]{7,20}`), `companySchema` (name ≥1, ABN digits/spaces), `inviteSchema` (phone + role enum), `checklistResponseSchema`. Applied in `app/jobs/new.tsx`, `app/settings.tsx`, `app/(tabs)/team/index.tsx` before enqueue — blocks malformed local writes and prevents RLS-bypass payloads.
- Edge Functions also validate Whisper transcript length, image size (15MB/10MB caps), and structured JSON schema (`VoiceLogJsonSchema`, `ReceiptJsonSchema`) before DB writes.

## Checklist
- [ ] Rotate `sb_publishable_...` that was pasted as AI key in earlier run
- [ ] Enable Supabase email confirmation + SMS OTP rate limiting in Dashboard
- [ ] Set `STRIPE_WEBHOOK_SECRET` and verify `stripe-signature` on `stripe-webhook`
- [ ] Set `REVENUECAT_WEBHOOK_SECRET` and use `Authorization: Bearer` on `revenuecat-webhook`
- [ ] Replace placeholder `assets/*.png` before store submit
