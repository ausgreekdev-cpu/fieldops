# Privacy Policy — FieldOps

**Last updated:** 2026-09-04  
**Public repo:** https://github.com/ausgreekdev-cpu/fieldops  
**Package:** `com.fieldops.app` (Google Play)  
**Contact:** fieldops@example.com / Ausgreek Developments

## Summary
FieldOps is an offline-first field worker SaaS. We collect only data needed to run jobs, checklists, and invoices, and to sync when you are online. We do **not** sell data.

## Data We Collect
| Category | Example | Purpose | Stored Where |
|---|---|---|---|
| Account | Phone (OTP), display name | Auth via Supabase Auth (`phone` OTP, magic link) | Supabase `auth.users` + `public.users` |
| Company | Name, ABN, logo | Branded PDFs, invoicing | `public.companies` + Storage `company-logos` |
| Jobs | Title, customer name/phone/address/lat/lng, notes, materials, photos | Job cards, offline cache | `public.jobs`, `job_photos` + local `expo-sqlite` |
| Checklists | Responses, photo proofs, signatures | Safety compliance, audit | `compliance_checklists`, `checklist_submissions`, `job_signatures` |
| Invoices | Line items, totals, PDFs | Billing + share | `public.invoices` + Storage `invoices` |
| Sync logs | Device sync status, retries | Reliability, audit | `public.sync_logs` + local `outbox` |

## Offline
All job/checklist/invoice data is cached in `expo-sqlite` on device and synced to Supabase Postgres when online via `SyncManager` (batch 10, exponential backoff 1s·2^attempts cap 5m). Files (photos, signatures, PDFs) are stored in `FileSystem.documentDirectory` and uploaded to Supabase Storage buckets (`job-photos`, `signatures`, `invoices`) on the path `<company_id>/<job_id>/<file>` scoped by RLS `my_company_id()`.

## AI Processing
- **Voice-to-Job:** Audio (m4a) sent to Edge Function `process-voice-log` → OpenAI Whisper (`whisper-1`) + GPT-4o-mini / Claude for structured `{formatted_notes, materials, follow_up_task}`. Audio is not stored after transcription.
- **Receipt/Plate Parser:** Image sent to `parse-receipt` → GPT-4o Vision for `{vendor, line_items, total}`. Images are not retained by AI providers beyond processing.
- You can opt-out: don’t use Hold-to-Dictate or Receipt capture.

## Permissions (Android + iOS)
- **Camera** — capture job evidence, receipt/plate, checklist photo proof, signature (no background).
- **Microphone** — one-tap voice-to-job dictation (no background recording).
- **Location (foreground only)** — tap-to-navigate to job site via Google/Apple Maps; we store `lat/lng` only if you attach to job. **We do NOT request background location.**
- **Photos/Media** — pick company logo.

We show in-app rationale before requesting (Expo `ImagePicker.requestCameraPermissionsAsync`, `AudioModule.requestRecordingPermissionsAsync`).

## Payments
- Mobile subscriptions via **RevenueCat** (App Store / Play). We receive entitlement `pro|team` via webhook `revenuecat-webhook` (app_user_id = Supabase user id) and store `companies.subscription_tier`. Payment details handled by Apple/Google, not us.
- Invoices: optional Stripe Payment Links via Edge Function `create-payment-link` (uses `STRIPE_SECRET_KEY` server-only) and `stripe-webhook` (HMAC verified). Card data never touches device beyond Stripe hosted page.

## Third Parties
- **Supabase** (DB/Auth/Storage/Functions) — EU/US region per project.
- **OpenAI / Anthropic** — voice/receipt AI (see above).
- **RevenueCat, Stripe** — billing.
- **Expo / EAS** — builds, OTA updates (`expo-updates`).

We do **not** share data with advertisers. Data is encrypted in transit (HTTPS) and at rest (Supabase/Postgres).

## Retention & Deletion
- Job/checklist/invoice data retained until you delete (soft-delete `deleted_at` + `outbox` sync). Delete a job in `JobDetail → Edit → Delete` (owner/admin only, enforces RLS).
- Account deletion: Settings → contact `fieldops@example.com` or Supabase `auth.admin.deleteUser` — cascades `public.users` → company data per RLS. Local `expo-sqlite` is wiped on app uninstall / `SyncManager` reset.
- Backups: Supabase point-in-time recovery per tier.

## Children
FieldOps is `Business` category, target `18+` field workers. Not directed to children. Data Safety: `Everyone` (PEGI 3).

## Your Rights (AU + GDPR)
Access, correction, deletion, export (Analytics → Export Jobs/Invoices/Revenue CSV, Audit → Export CSV). Contact `fieldops@example.com` for DSAR.

## Contact & Updates
For questions or to host this policy at `https://ausgreekdev-cpu.github.io/fieldops/privacy`, open an issue at https://github.com/ausgreekdev-cpu/fieldops/issues. Changes published here with new `Last updated`.

## Data Safety (Google Play Declaration Summary)
- **Location (precise)** — App functionality, ephemeral, not shared, encrypted, user can delete.
- **Photos, Microphone, Phone** — App functionality, not shared, encrypted, user can delete.
- **App info, Performance** — App functionality via Supabase/RevenueCat/Stripe, encrypted, aggregated.
- We answer “No” to background location, ads, data sharing for advertising.

---

*This policy covers `com.fieldops.app` v0.1.0 internal testing → production. Host at `https://ausgreekdev-cpu.github.io/fieldops/privacy` + link in Play Console → App content → Privacy policy.*
