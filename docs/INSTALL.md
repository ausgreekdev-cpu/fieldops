# FieldOps — Install in 2 Clicks (no coding)

**Goal:** Download → double-click → icon appears → click icon → works.

## Windows
1. Download: `FieldOps-Setup-0.2.3.exe` from https://github.com/ausgreekdev-cpu/fieldops/releases
2. **Double-click** the `.exe` → follow the installer (creates Start Menu + Desktop icon).
3. Double-click the **FieldOps** desktop icon → **Connect** screen → paste Supabase URL + anon key once → done.

- Alternative: `FieldOps-0.2.3-portable.exe` — single file, no install. Double-click to run (extracts to temp), no icon.
- The installer (`FieldOps-Setup-*.exe`) is the recommended path: it registers a real app + icon.

## Linux (Ubuntu/Debian)
**Option A — one-click script (recommended):**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ausgreekdev-cpu/fieldops/main/scripts/install-fieldops.sh)
```
Downloads the AppImage, installs to `~/.local/share/fieldops`, creates **FieldOps** in your app menu + a launcher. Then click the icon → Connect once → done.

**Option B — .deb (double-click):**
1. Download `fieldops_0.2.3_amd64.deb`.
2. Double-click it (Ubuntu Software Center) → **Install**.
3. Find **FieldOps** in the app menu → click → Connect once.

**Option C — AppImage (no install):**
```bash
chmod +x FieldOps-0.2.3.AppImage && ./FieldOps-0.2.3.AppImage
```
Single file, runs anywhere, no icon.

## First launch (every platform, once, 30 seconds)
1. App shows **Connect Workspace**.
2. Paste your **Supabase project URL** (`https://<ref>.supabase.co`).
3. Paste your **anon public key** (`Dashboard → Settings → API`, starts with `eyJ…`).
4. Tap **Connect**. Stored locally on the device only. No rebuild needed.
5. Log in with your phone OTP / magic link → the app is ready.

> If you haven't created a Supabase project yet, run `npm run setup` (wizard) on the repo to create/link it, or create one free at https://supabase.com.

## Keeping it updated
- **Windows:** download the newest `Setup.exe` and reinstall (keeps your data — app data lives in your user profile).
- **Linux:** re-run the one-click script (`Option A`) — it downloads the latest and replaces the icon target.

## Troubleshooting
- **Icon doesn't show:** run `bash <(curl -fsSL .../install-fieldops.sh)` once more; or log out/in.
- **App opens but "Missing dist"**: means it's a source checkout, not the installer. Use the release `.AppImage`/`.deb`/`.exe` instead.
- **Connecting fails**: check the URL is `https://` and the key starts with `eyJ`. Both come from Supabase Dashboard → Settings → API.