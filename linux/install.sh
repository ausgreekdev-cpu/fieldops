#!/bin/bash
set -e
# FieldOps Linux installer — system-wide .desktop + binary + nginx config (optional)
# Usage: sudo bash linux/install.sh  [--user]
PREFIX="${PREFIX:-/usr/local}"
BIN="$PREFIX/bin/fieldops"
DESKTOP="/usr/share/applications/fieldops.desktop"
ICON_DIR="/usr/share/icons/hicolor/512x512/apps"

if [ "$1" = "--user" ]; then
  PREFIX="$HOME/.local"
  BIN="$PREFIX/bin/fieldops"
  DESKTOP="$HOME/.local/share/applications/fieldops.desktop"
  ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
fi

echo "== FieldOps Linux install → $PREFIX =="

# Binary: if dist/ exists, serve via npx serve, else use docker
mkdir -p "$(dirname "$BIN")" "$ICON_DIR" "$(dirname "$DESKTOP")"

cat > "$BIN" <<'EOS'
#!/bin/bash
# FieldOps launcher — prefers Docker, falls back to npx serve of ./dist or Expo web
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
if command -v docker >/dev/null 2>&1 && docker image inspect fieldops:linux >/dev/null 2>&1; then
  echo "Starting fieldops:linux Docker on http://localhost:8080"
  exec docker run --rm -p 8080:80 fieldops:linux
elif [ -d "$DIR/share/fieldops/dist" ]; then
  echo "Serving $DIR/share/fieldops/dist on http://localhost:8080"
  exec npx -y serve -s "$DIR/share/fieldops/dist" -l 8080
else
  echo "No dist or Docker image. Run: npm run build:web  or  docker build -f linux/Dockerfile -t fieldops:linux ."
  exit 1
fi
EOS
chmod +x "$BIN"

# Icon + desktop
if [ -f "assets/icon.png" ]; then
  mkdir -p "$ICON_DIR"
  cp assets/icon.png "$ICON_DIR/fieldops.png" 2>/dev/null || true
fi
cp linux/fieldops.desktop "$DESKTOP"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
fi

echo "Installed: $BIN"
echo "Desktop: $DESKTOP"
echo "Run: fieldops  (or fieldops --help)"
echo "Web build: npm run build:web  → dist/ → sudo make install (via install.sh)"
