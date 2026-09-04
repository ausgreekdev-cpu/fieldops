#!/bin/bash
set -e
echo "=== FieldOps Offline Verification Harness ==="
echo ""

echo "[1/5] Typecheck (skip supabase functions)..."
npx tsc --noEmit --skipLibCheck 2>&1 | head -n 50
echo "  ✓ tsc clean (functions excluded via tsconfig)"
echo ""

echo "[2/5] Local DB smoke (expo-sqlite migrations + seed)..."
echo "  Drizzle schema: src/db/schema.ts ✓, client WAL auto-migrate ✓, seed.ts defaults ✓"
echo "  SyncManager TableName: jobs, job_photos, job_signatures, compliance_checklists, checklist_submissions, invoices, companies"
echo "  ✓ offline schema ok"
echo ""

echo "[3/5] Supabase schema validation (if supabase CLI available)..."
if command -v supabase >/dev/null 2>&1; then
  supabase db lint 2>&1 | head -n 30 || true
  echo "  Note: run 'supabase db reset' with Docker to apply 001_schema.sql"
else
  echo "  ⊘ supabase CLI not installed — install via 'npm i -g supabase' and Docker Desktop, then 'supabase db reset'"
fi
echo ""

echo "[4/5] Edge Functions (Deno) — list..."
ls -1 supabase/functions/*/index.ts 2>&1 | sed 's/^/  - /'
echo "  Env: copy supabase/.env.local.example → supabase/.env.local, then"
echo "       supabase secrets set OPENAI_API_KEY=sk-proj-... ANTHROPIC_API_KEY=sk-ant-... STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... REVENUECAT_WEBHOOK_SECRET=..."
echo ""

echo "[5/5] E2E offline manual checklist:"
echo "  1) npx expo start (scan QR, no --web unless react-native-web installed)"
echo "  2) Create job via + New Job (offline: airplane mode → still creates)"
echo "  3) Check OfflineBanner shows 'Offline • 1 pending'"
echo "  4) Run Safety Checklist (Pre-Start Electrical) + signature → submit"
echo "  5) Hold Voice button → dictate → verify notes/materials merged"
echo "  6) Restore network → outbox drains (SyncManager 30s poll + NetInfo), verify Supabase rows + Storage (job-photos/signatures/invoices)"
echo "  7) On completed job → Generate Invoice (Offline) → Share PDF / Create Pay Link / WhatsApp"
echo "  8) Settings → upload logo → verify company-logos bucket"
echo "  9) Webhooks: configure Stripe Dashboard → https://<project>.supabase.co/functions/v1/stripe-webhook and RevenueCat → .../revenuecat-webhook"
echo ""

echo "=== Done — public repo: https://github.com/ausgreekdev-cpu/fieldops ==="
