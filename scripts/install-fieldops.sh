#!/usr/bin/env bash
# FieldOps — one-click installer (Linux). Downloads the latest release, installs,
# and creates a desktop launcher icon. Run once:  bash install-fieldops.sh
set -euo pipefail

REPO="ausgreekdev-cpu/fieldops"
VERSION="${1:-latest}"
INSTALL_DIR="${FIELD_OPS_INSTALL_DIR:-$HOME/.local/share/fieldops}"
BIN_DIR="${HOME}/.local/bin"
APP_DESKTOP="${HOME}/.local/share/applications/fieldops.desktop"

RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; CYAN='\033[36m'; RESET='\033[0m'
ok(){ echo -e "  ${GREEN}✓${RESET} $1"; }
info(){ echo -e "  ${CYAN}·${RESET} $1"; }
warn(){ echo -e "  ${YELLOW}!${RESET} $1"; }

echo ""
echo -e "${CYAN}=== FieldOps — one-click install ===${RESET}"

# 1. Resolve version + asset URL
if [ "$VERSION" = "latest" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -oP '"tag_name":\s*"\K[^"]+' | head -1)
fi
info "Version: ${VERSION}"
# AppImage is single-file, no install, easiest to run anywhere.
ASSET_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/tags/${VERSION}" \
  | grep -oP '"browser_download_url":\s*"\K[^"]+\.AppImage' | head -1)

if [ -z "$ASSET_URL" ]; then
  warn "No AppImage found for ${VERSION}. Trying latest .deb instead."
  ASSET_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/tags/${VERSION}" \
    | grep -oP '"browser_download_url":\s*"\K[^"]+_amd64\.deb' | head -1)
  if [ -z "$ASSET_URL" ]; then
    echo -e "${RED}✗ Could not find a downloadable artifact. Check: https://github.com/${REPO}/releases${RESET}"
    exit 1
  fi
fi

FILENAME=$(basename "$ASSET_URL")
info "Downloading: $FILENAME"

# 2. Download to cache
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/fieldops"
mkdir -p "$CACHE_DIR"
TARGET="$CACHE_DIR/$FILENAME"
if [ ! -f "$TARGET" ] || [ "$(stat -c%s "$TARGET")" -lt 1000000 ]; then
  curl -fSL -o "$TARGET" "$ASSET_URL"
fi
ok "Downloaded: $TARGET"

# 3. Install
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
if [[ "$FILENAME" == *.AppImage ]]; then
  chmod +x "$TARGET"
  rm -f "$INSTALL_DIR/FieldOps.AppImage"
  cp "$TARGET" "$INSTALL_DIR/FieldOps.AppImage"
  LAUNCHER="$BIN_DIR/fieldops"
  cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
exec "$INSTALL_DIR/FieldOps.AppImage" --no-sandbox
EOF
  chmod +x "$LAUNCHER"
  ok "Installed AppImage → $INSTALL_DIR/FieldOps.AppImage"
  # AppImage icon: extract embedded .DirIcon if possible
  if command -v appimagetool >/dev/null 2>&1; then
    mkdir -p "${HOME}/.local/share/icons/hicolor/512x512/apps"
    "$INSTALL_DIR/FieldOps.AppImage" --appimage-extract '.DirIcon' >/dev/null 2>&1 && cp squashfs-root/.DirIcon "${HOME}/.local/share/icons/hicolor/512x512/apps/fieldops.png" 2>/dev/null && rm -rf squashfs-root || true
  fi
else
  warn "Using .deb — installs system-wide. Run with sudo if dpkg needs it."
  sudo dpkg -i "$TARGET" 2>/dev/null || (sudo apt-get install -f -y && sudo dpkg -i "$TARGET")
  LAUNCHER="fieldops"
  ok "Installed via dpkg. Launch with: fieldops"
fi

# 4. Desktop launcher (icon)
cat > "$APP_DESKTOP" <<EOF
[Desktop Entry]
Name=FieldOps
Comment=Offline-first field worker SaaS — jobs, checklists, invoices
Exec=${LAUNCHER}
Icon=fieldops
Type=Application
Categories=Office;ProjectManagement;
Terminal=false
StartupWMClass=FieldOps
EOF
chmod +x "$APP_DESKTOP"
# icon fallback
if [ ! -f "${HOME}/.local/share/icons/hicolor/512x512/apps/fieldops.png" ]; then
  mkdir -p "${HOME}/.local/share/icons/hicolor/512x512/apps"
  curl -fsSL -o "${HOME}/.local/share/icons/hicolor/512x512/apps/fieldops.png" \
    "https://raw.githubusercontent.com/${REPO}/main/assets/icon.png" 2>/dev/null || true
fi
# refresh menu
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${HOME}/.local/share/applications" 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}✓ FieldOps installed!${RESET}"
echo -e "  Open it: ${CYAN}${LAUNCHER}${RESET}  OR find 'FieldOps' in your app menu / desktop."
echo -e "  First launch: enter your Supabase URL + anon key once (30 seconds) — saved on device, no rebuild."
echo -e "  Newest version is on: https://github.com/${REPO}/releases"
echo ""