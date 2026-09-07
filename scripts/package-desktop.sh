#!/bin/bash
set -e
# FieldOps — single-program desktop packager (Electron + electron-builder)
# Usage: bash scripts/package-desktop.sh [version] [--linux|--win|--all]
# Outputs to dist-desktop/: Linux AppImage (single file, no install), .deb, tar.gz + Windows portable.exe (single file) + Setup.exe (nsis)
# Prereqs: npm ci, electron deps auto-installed. For Windows on Linux host needs wine (or use GitHub Actions windows-latest instead).
VERSION="${1:-$(node -p "require('./package.json').version")}"
MODE="${2:---all}"
ARCH="x64"
OUT="dist-desktop"
DIST="dist"

echo "== FieldOps Desktop v$VERSION ($MODE) =="

# 1. Web build
if [ ! -f "node_modules/react-native-web/dist/index.js" ]; then
  echo "Installing react-native-web + react-dom..."
  npx expo install react-native-web@~0.19.13 react-dom@18.3.1 -- --silent 2>&1 | tail -n 5 || npm install --save react-native-web@~0.19.13 react-dom@18.3.1
fi
if [ ! -d "node_modules/electron" ]; then
  echo "Installing electron deps..."
  npm install --save-dev electron@~30 electron-builder@~24 2>&1 | tail -n 10
fi

echo "[1/3] Expo web export → $DIST"
rm -rf "$DIST"
npx expo export --platform web --output-dir "$DIST" 2>&1 | tail -n 30
test -f "$DIST/index.html" || { echo "Export failed: $DIST/index.html missing"; exit 1; }

# ensure icon exists for win
if [ ! -f "assets/icon.png" ]; then echo "Missing assets/icon.png"; exit 1; fi

echo "[2/3] Electron build ($MODE) → $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

# Choose targets
ARGS=""
case "$MODE" in
  --linux) ARGS="--linux" ;;
  --win) ARGS="--win" ;;
  --all|*) 
    # On Linux host, --win needs wine; skip win if wine missing unless forced
    if command -v wine >/dev/null 2>&1; then ARGS="--linux --win"
    else echo "  ⊘ wine not found — building Linux only locally (Windows via GitHub Actions windows-latest)"; ARGS="--linux"; fi
    ;;
esac

# electron-builder needs dist + electron files; config in electron-builder.yml
npx electron-builder $ARGS --publish never 2>&1 | tail -n 40

echo "[3/3] Artifacts"
ls -lh "$OUT" 2>&1 | tail -n 20
echo ""
echo "Single-program outputs:"
echo "  Linux (single file, no install): $OUT/FieldOps-*-.AppImage  (chmod +x && ./FieldOps*.AppImage)"
echo "  Linux (single file, install):    $OUT/fieldops_*_amd64.deb  (sudo dpkg -i ... && fieldops)"
echo "  Windows (single file, portable): $OUT/FieldOps-*-portable.exe  (double-click, no install)"
echo "  Windows (single file, installer):$OUT/FieldOps-Setup-*.exe    (oneClick false, choose dir)"
echo ""
echo "Run: ./dist-desktop/FieldOps-*.AppImage  or  ./dist-desktop/FieldOps-*-portable.exe"
