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

## Edge Function Audit (2026-09-28)
Verified sound across all 5 functions (`stripe-webhook`, `revenuecat-webhook`, `process-voice-log`, `parse-receipt`, `create-payment-link`):
- JWT verified via `getUserFromRequest` (anon client `auth.getUser()`); service role confined to `_shared/supabaseAdmin.ts`.
- Every job mutation cross-checks `job.company_id === user.company_id`; invoice ops check `invoices.company_id`.
- Size caps (audio 15MB / image 10MB), amount integer ≥50¢ + currency enum, LLM outputs constrained by JSON-schema prompts.
- Stripe webhook: HMAC-SHA256 + 5-min timestamp tolerance + constant-time compare + `event.id` idempotency.

Findings fixed in this audit:
1. **Amount tampering** — `create-payment-link` only *warned* on invoice-total mismatch; now rejects with 400 (1¢ tolerance). Defense in depth: `stripe-webhook` re-verifies `amount_total`/`amount` against `invoices.total` before marking paid; mismatch skips the update and writes an audit row to `sync_logs`.
2. **No rate limit on AI endpoints** — both AI functions now cap 30 calls/user/hour via `sync_logs` count → 429.
3. **Webhooks failed open without secrets** — now fail closed: 503 `SECRET_NOT_CONFIGURED` until `STRIPE_WEBHOOK_SECRET` / `REVENUECAT_WEBHOOK_SECRET` are set. Deploy must be paired with `supabase secrets set`.
4. **No typecheck for edge functions** — `deno check supabase/functions/*/index.ts` runs locally and in CI (`deno-check` job).

Deployment status: **not deployed** as of this audit (all functions returned `NOT_FOUND` against prod) — deploy via `supabase functions deploy` after `supabase login`.

## Checklist
- [x] Verified no secrets committed — `git log -S "sb_publishable"` + grep show only rotation warnings in docs, never the key; `.env`/`supabase/.env.local` gitignored with placeholders only
- [x] ~~Rotate `sb_publishable_...`~~ — **not required.** Publishable keys are client-public by design (they ship in every app bundle and appear in every network request); chat exposure adds no capability beyond that. Rotation would break installed clients for no security gain. Keep publishable keys out of *server* contexts (service_role stays in Edge Functions only).
- [ ] Enable Supabase email confirmation + SMS OTP rate limiting in Dashboard
- [ ] Set `STRIPE_WEBHOOK_SECRET` — code verifies `stripe-signature` fail-closed (503 until set)
- [ ] Set `REVENUECAT_WEBHOOK_SECRET` — code verifies `Authorization: Bearer` fail-closed (503 until set)
- [ ] Deploy the 5 edge functions (currently NOT_FOUND against prod)
- [ ] Replace placeholder `assets/*.png` before store submit
