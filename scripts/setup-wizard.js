#!/usr/bin/env node
/**
 * FieldOps — No-Code Setup Wizard
 * Guides you through Supabase, Netlify, Desktop build, Stripe & Play Store setup.
 * Zero dependencies (Node built-ins only). Run: `npm run setup`
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const p = (s) => console.log(s);
const ok = (s) => console.log(`  ${C.green}✓${C.reset} ${s}`);
const fail = (s) => console.log(`  ${C.red}✗${C.reset} ${s}`);
const warn = (s) => console.log(`  ${C.yellow}!${C.reset} ${s}`);
const info = (s) => console.log(`  ${C.cyan}·${C.reset} ${s}`);
const title = (s) => console.log(`\n${C.bold}${C.cyan}━━━ ${s} ${C.reset}${C.dim}${'━'.repeat(Math.max(2, 60 - s.length))}${C.reset}`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(`  ${q} `, res));
const confirm = async (q) => {
  const a = (await ask(`${q} [Y/n]`)).toLowerCase();
  return a === '' || a === 'y' || a === 'yes';
};

function which(bin) {
  const r = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function run(cmd, opts = {}) {
  if (opts.echo !== false) p(`  ${C.dim}$ ${cmd}${C.reset}`);
  const r = spawnSync('sh', ['-c', cmd], { stdio: 'inherit', cwd: ROOT, env: process.env });
  return r.status === 0;
}

function capture(cmd) {
  const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function readEnv(file) {
  const fp = path.join(ROOT, file);
  const out = {};
  if (!fs.existsSync(fp)) return out;
  for (const line of fs.readFileSync(fp, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}
function writeEnv(file, entries) {
  const fp = path.join(ROOT, file);
  const existing = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
  let out = existing.replace(/\n*$/, '\n');
  for (const [k, v] of Object.entries(entries)) {
    if (v === undefined || v === null || v === '') continue;
    out = out.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
    if (!out.includes(`${k}=`)) out += `${k}=${v}\n`;
  }
  fs.writeFileSync(fp, out);
  return fp;
}

/* ── Steps ─────────────────────────────────────────────────────── */

async function stepPrereqs() {
  title('Prerequisites check');
  const need = {
    node: 'node --version',
    npm: 'npm --version',
    supabase: 'supabase --version',
    netlify: 'netlify --version',
    eas: 'eas --version',
    stripe: 'stripe --version',
  };
  const missing = [];
  for (const [name, verCmd] of Object.entries(need)) {
    const bin = which(name);
    if (bin) {
      const v = capture(`${bin} ${verCmd.replace(name + ' ', '')}`).out.slice(0, 40) || '';
      ok(`${name} ${v}`);
    } else {
      missing.push(name);
    }
  }
  if (missing.length) {
    warn('Missing tools: ' + missing.join(', '));
    warn('Install with: npm i -g supabase netlify-cli eas-cli  and  brew install stripe/stripe-cli/stripe  (or follow https://stripe.com/docs/stripe-cli)');
    const go = await confirm('Continue anyway? (supabase is required for backend)');
    if (!go) process.exit(1);
  }
}

async function stepSupabase() {
  title('Supabase — backend, database, auth, storage, edge functions');
  const env = readEnv('.env');
  const supabaseBin = which('supabase');
  if (!supabaseBin) { fail('supabase CLI not installed. Install: npm i -g supabase'); return; }

  p('  Step 1: Log in to Supabase (opens browser) — only needed once.');
  if (await confirm('Run `supabase login` now?')) {
    run('supabase login');
  }

  const projRef = env.EXPO_PUBLIC_SUPABASE_PROJECT_REF || (await ask('  Your Supabase project ref (from dashboard URL https://<ref>.supabase.co):'));
  if (projRef) writeEnv('.env', { EXPO_PUBLIC_SUPABASE_PROJECT_REF: projRef });

  p('  Step 2: Link this repo to your Supabase project.');
  if (await confirm(`Run \`supabase link --project-ref ${projRef}\`?`)) {
    run(`supabase link --project-ref ${projRef}`);
  }

  p('  Step 3: Apply database schema (tables + RLS + storage buckets + email auth).');
  if (await confirm('Run `supabase db push` to deploy migrations 001 + 002 to production?')) {
    run('supabase db push');
    info('Migrations: 001_schema.sql (core) + 002_email_auth.sql (users.email for email login).');
    info('Email OTP login works out of the box — no SMS/Twilio needed.');
  }

  p('  Step 4: Deploy Edge Functions (voice AI, receipt AI, payment links, webhooks).');
  if (await confirm('Deploy all 5 Edge Functions now?')) {
    run('supabase functions deploy process-voice-log parse-receipt create-payment-link stripe-webhook revenuecat-webhook --no-verify-jwt');
    warn('Note: stripe-webhook & revenuecat-webhook are already configured verify_jwt=false; others use JWT.');
  }

  p('  Step 5: Set Edge Function secrets (never committed to git).');
  p('  These unlock AI + payments. You can leave one blank to skip it.');
  const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'REVENUECAT_WEBHOOK_SECRET'];
  const secrets = {};
  for (const k of keys) {
    const cur = env[k] || '';
    const v = await ask(`${k} [${cur ? 'saved' : 'optional'}] (blank = keep/skip):`);
    if (v) secrets[k] = v;
  }
  if (Object.keys(secrets).length) {
    const cmd = 'supabase secrets set ' + Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join(' ');
    if (await confirm('Set these secrets on Supabase now?')) run(cmd);
  }

  p('  Step 6: Public keys for the app.');
  const url = env.EXPO_PUBLIC_SUPABASE_URL || (await ask('  Supabase URL (https://<ref>.supabase.co):'));
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || (await ask('  anon public key (Dashboard → Settings → API):'));
  if (url && anon) {
    writeEnv('.env', { EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: anon });
    ok('Wrote .env (EXPO_PUBLIC_SUPABASE_URL + ANON_KEY)');
  } else {
    warn('Skipped — add EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY to .env manually.');
  }

  warn('Tip: phone OTP needs Twilio (or email magic-link needs SMTP) in Supabase Dashboard → Auth → Providers. Without it, login SMS won’t send.');
}

async function stepNetlify() {
  title('Netlify — host the web app (SPA)');
  const bin = which('netlify');
  if (!bin) { fail('netlify-cli not installed. Install: npm i -g netlify-cli'); return; }

  if (await confirm('Log in to Netlify now (opens browser)?')) run('netlify login');

  const hasConfig = fs.existsSync(path.join(ROOT, 'netlify.toml'));
  ok(hasConfig ? 'Found netlify.toml (auto build: npm run build:web → dist)' : 'netlify.toml missing');

  if (await confirm('Link this folder to a Netlify site (create new or pick existing)?')) {
    run('netlify link');
  }

  const env = readEnv('.env');
  const envs = {};
  for (const k of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY', 'EXPO_PUBLIC_REVENUECAT_IOS_KEY']) {
    const v = env[k];
    if (v) envs[k] = v;
  }
  if (Object.keys(envs).length && await confirm('Set these env vars on Netlify?')) {
    for (const [k, v] of Object.entries(envs)) {
      run(`netlify env:set ${k} ${v}`);
    }
  }

  p('  Build & deploy: (needs a moment)');
  if (await confirm('Run `netlify deploy --prod` now?')) {
    run('npm run build:web && netlify deploy --prod');
    info('Your site URL will appear in the output. Share it with your team!');
  }
}

async function stepDesktop() {
  title('Desktop — build Linux + Windows single-file apps (GitHub Actions)');
  p('  The repo auto-builds on every `v*` tag via .github/workflows/desktop.yml.');
  p('  To cut a new release tag (builds AppImage + .deb + portable.exe + Setup.exe):');
  p(`    git tag v0.2.3 && git push origin v0.2.3`);
  ok('Latest artifacts: https://github.com/ausgreekdev-cpu/fieldops/releases');
  const v = (await ask('  Want me to run `npm install` + web build now for local preview? [Y/n]')).toLowerCase();
  if (v !== 'n' && v !== 'no') run('npm install && npm run build:web');
}

async function stepStripe() {
  title('Stripe — payment links + webhook');
  const bin = which('stripe');
  if (!bin) { warn('stripe CLI not installed (optional). For test payments: https://stripe.com/docs/stripe-cli'); return; }
  if (await confirm('Log in to Stripe (opens browser)?')) run('stripe login');

  const env = readEnv('supabase/.env.local');
  if (await confirm('Run `stripe listen --forward-to` so the local webhook works? (gives a whsec_…)')) {
    p('  Copy the whsec_… key into supabase/.env.local as STRIPE_WEBHOOK_SECRET and re-run setup to set it.');
    run('stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook');
  }
  if (await confirm('Deploy a production webhook to Supabase (endpoint: .../functions/v1/stripe-webhook)?')) {
    const url = await ask('  Full endpoint URL (https://<ref>.supabase.co/functions/v1/stripe-webhook):');
    run(`stripe webhook_endpoints create --url "${url}" --enabled-events checkout.session.completed,payment_intent.succeeded,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted`);
  }
}

async function stepPlayStore() {
  title('Google Play Store — Android build + submit');
  const bin = which('eas');
  if (!bin) { warn('eas-cli not installed. Install: npm i -g eas-cli'); return; }
  if (await confirm('Log in to Expo/EAS (opens browser)?')) run('eas login');
  if (await confirm('Configure Android signing credentials (EAS-managed keystore)?')) {
    run('eas credentials --platform android');
  }
  if (await confirm('Build a preview APK/AAB and submit to Internal track?')) {
    run('eas build --profile preview --platform android --auto-submit --track internal');
  }
  info('Full guide: docs/PLAY_STORE.md (store listing, privacy URL already live on GitHub Pages).');
}

async function stepVerify() {
  title('Verify setup');
  const env = readEnv('.env');
  if (env.EXPO_PUBLIC_SUPABASE_URL && env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ok('.env has Supabase URL + anon key');
  else fail('.env missing EXPO_PUBLIC_SUPABASE_URL / ANON_KEY');

  if (which('supabase')) {
    const link = capture('supabase projects list');
    if (link.code === 0) ok('supabase CLI linked & authenticated');
    else warn('supabase CLI not linked yet (run setup → Supabase)');
  }
  const netlify = which('netlify');
  if (netlify) {
    const s = capture('netlify status');
    if (s.code === 0) ok('netlify authenticated');
    else warn('netlify not authenticated');
  }
  p('');
  p('  Final checks before launch:');
  p('   1) `npm test` + `npx tsc --noEmit --skipLibCheck` pass');
  p('   2) Login OTP works (needs Twilio/SMTP in Supabase Auth)');
  p('   3) Open web preview: `npx expo start --web` (mobile: `npx expo start` + Expo Go)');
}

const MENU = `
${C.bold}FieldOps — Setup Wizard${C.reset}
  ${C.cyan}1${C.reset}  Check prerequisites
  ${C.cyan}2${C.reset}  Supabase (DB + auth + storage + Edge Functions + secrets)
  ${C.cyan}3${C.reset}  Netlify (host web app + env vars + deploy)
  ${C.cyan}4${C.reset}  Desktop builds (Linux/Windows single-file, via GitHub Releases)
  ${C.cyan}5${C.reset}  Stripe (payment links + webhook)
  ${C.cyan}6${C.reset}  Google Play Store (EAS build + submit)
  ${C.cyan}7${C.reset}  Verify setup
  ${C.cyan}0${C.reset}  Exit
`;

(async () => {
  p(`\n${C.bold}${C.cyan}FieldOps Setup Wizard${C.reset} — answers prompts, no coding needed.`);
  p(`${C.dim}Working dir: ${ROOT}${C.reset}`);
  let running = true;
  while (running) {
    p(MENU);
    const choice = await ask('Choose an option:');
    switch (choice.trim()) {
      case '1': await stepPrereqs(); break;
      case '2': await stepSupabase(); break;
      case '3': await stepNetlify(); break;
      case '4': await stepDesktop(); break;
      case '5': await stepStripe(); break;
      case '6': await stepPlayStore(); break;
      case '7': await stepVerify(); break;
      case '0':
      case 'q': running = false; break;
      default: warn('Unknown option');
    }
  }
  rl.close();
  p(`\n${C.green}Done!${C.reset} Repo: https://github.com/ausgreekdev-cpu/fieldops — keep it public or flip to private anytime.`);
})();