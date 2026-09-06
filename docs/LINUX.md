# FieldOps — Linux Package

Public repo: **https://github.com/ausgreekdev-cpu/fieldops** — offline-first (Expo + Supabase). This doc packages it for **Linux** (Ubuntu/Debian/Fedora/Arch, Docker, .deb, AppImage).

## Quick Install (Ubuntu/Debian)

```bash
git clone https://github.com/ausgreekdev-cpu/fieldops.git && cd fieldops
npm install
cp .env.example .env  # set EXPO_PUBLIC_SUPABASE_URL / ANON_KEY

# Option A: Docker (recommended, isolated)
npm run linux:docker:build
npm run linux:docker:run  # http://localhost:8080

# Option B: Native web build (no Docker)
npm run build:web          # → dist/ (requires react-native-web, auto-installed)
npx serve -s dist -l 8080  # or fieldops binary after deb install

# Option C: Build .deb + AppImage + tarball
bash scripts/package-linux.sh  # → dist-linux/: .tar.gz + .deb (if fpm/dpkg-deb) + AppDir
sudo dpkg -i dist-linux/fieldops_0.1.0_amd64.deb && fieldops  # serves dist on :8080
# or AppImage: ./dist-linux/fieldops-0.1.0-x86_64.AppImage (if appimagetool installed)

# Desktop entry (system or --user)
sudo bash linux/install.sh         # /usr/local/bin/fieldops + /usr/share/applications/fieldops.desktop
bash linux/install.sh --user       # ~/.local/...
```

## Docker Compose (app + Postgres stub)

```bash
docker compose -f linux/docker-compose.yml up --build          # app on :8080
docker compose -f linux/docker-compose.yml --profile with-db up # + postgres on :54322
# For full Supabase local, run Supabase CLI on host instead:
npm i -g supabase
supabase start              # Postgres 54322, Studio 54323, API 54321
supabase db reset           # applies supabase/migrations/001_schema.sql (RLS, buckets)
supabase functions serve --env-file ./supabase/.env.local --debug
```

## Secrets (never committed)
```bash
cp supabase/.env.local.example supabase/.env.local
# edit OPENAI_API_KEY=sk-proj-... ANTHROPIC_API_KEY=sk-ant-... etc.
supabase secrets set OPENAI_API_KEY=... ANTHROPIC_API_KEY=... STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... REVENUECAT_WEBHOOK_SECRET=...
```

## Packaging Details
- `linux/Dockerfile` — multi-stage Node 20 → nginx SPA fallback for `expo-router` routes
- `linux/docker-compose.yml` — app + optional `postgres:15-alpine` (`--profile with-db`); for full Supabase use host `supabase start`
- `linux/fieldops.desktop` — XDG entry (`Exec=fieldops`, `Icon=fieldops`)
- `linux/install.sh` — installs bin (Docker-aware or `npx serve` fallback), icon, desktop; `update-desktop-database`
- `scripts/package-linux.sh` — Expo web export → tarball, AppDir, `.AppImage` (if `appimagetool`), `.deb` via `fpm` else `dpkg-deb`

## Systemd (optional, serve on boot)
```ini
# /etc/systemd/system/fieldops.service
[Unit]
Description=FieldOps
After=network.target docker.service
[Service]
ExecStart=/usr/local/bin/fieldops
Restart=always
[Install]
WantedBy=multi-user.target
```
`sudo systemctl enable --now fieldops`

## Verification
```bash
npm run typecheck && npm test
bash scripts/verify-offline.sh  # harness + manual E2E (airplane → create job → checklist → restore)
curl http://localhost:8080 | head  # after docker/serve
```

## Notes
- Placeholder icons `assets/icon.png` etc. exist — replace before store/flatpak submit.
- For Flatpak, wrap `linux/Dockerfile` output or use `flatpak-builder` with `dist/` as source and `npx serve` as command.
- Web build needs `react-native-web@~0.19.13` + `react-dom@18.3.1` — `scripts/package-linux.sh` auto-installs via `npx expo install`.
