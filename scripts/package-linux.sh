#!/bin/bash
set -e
# FieldOps — build Linux tarball + .deb + AppImage (requires Docker or fpm optional)
# Usage: bash scripts/package-linux.sh  [version]
# Outputs to dist-linux/: fieldops-<ver>.tar.gz, .deb (if fpm/dpkg-deb), AppDir, fieldops.desktop
VERSION="${1:-$(node -p "require('./package.json').version")}"
ARCH="amd64"
OUT="dist-linux"
APP="fieldops"
DIST="dist"

echo "== FieldOps Linux package v$VERSION =="

# 1. Web build (needs react-native-web)
if [ ! -f "node_modules/react-native-web/dist/index.js" ]; then
  echo "Installing react-native-web + react-dom for web export..."
  npx expo install react-native-web@~0.19.13 react-dom@18.3.1 -- --silent 2>&1 | tail -n 5 || npm install --save react-native-web@~0.19.13 react-dom@18.3.1
fi

echo "[1/4] Expo web export → $DIST"
rm -rf "$DIST"
npx expo export --platform web --output-dir "$DIST" 2>&1 | tail -n 20
test -f "$DIST/index.html" || { echo "Export failed: $DIST/index.html missing"; exit 1; }

# 2. Tarball
echo "[2/4] Tarball"
mkdir -p "$OUT"
tar czf "$OUT/${APP}-${VERSION}-linux-${ARCH}.tar.gz" -C "$DIST" . 2>&1 | tail -n 5
echo "  → $OUT/${APP}-${VERSION}-linux-${ARCH}.tar.gz ($(du -h "$OUT/${APP}-${VERSION}-linux-${ARCH}.tar.gz" | cut -f1))"

# 3. AppDir (for AppImage/desktop) + .desktop
echo "[3/4] AppDir"
APPDIR="$OUT/${APP}.AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/share/${APP}" "$APPDIR/usr/bin" "$APPDIR/usr/share/applications" "$APPDIR/usr/share/icons/hicolor/512x512/apps"
cp -a "$DIST" "$APPDIR/usr/share/${APP}/dist"
cp linux/fieldops.desktop "$APPDIR/usr/share/applications/"
cp linux/fieldops.desktop "$APPDIR/${APP}.desktop"
cp assets/icon.png "$APPDIR/usr/share/icons/hicolor/512x512/apps/fieldops.png" 2>/dev/null || cp assets/icon.png "$APPDIR/fieldops.png" 2>/dev/null || true
cat > "$APPDIR/AppRun" <<'EOS'
#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
exec npx -y serve -s "$HERE/usr/share/fieldops/dist" -l 8080
EOS
chmod +x "$APPDIR/AppRun"
echo "  → $APPDIR"

# AppImage (if appimagetool available)
if command -v appimagetool >/dev/null 2>&1; then
  echo "[3b] AppImage"
  appimagetool "$APPDIR" "$OUT/${APP}-${VERSION}-${ARCH}.AppImage" 2>&1 | tail -n 10
else
  echo "  ⊘ appimagetool not found — skip AppImage (install from https://github.com/AppImage/AppImageKit)"
fi

# 4. .deb (prefers fpm, falls back to dpkg-deb)
echo "[4/4] .deb"
DEB="$OUT/${APP}_${VERSION}_${ARCH}.deb"
if command -v fpm >/dev/null 2>&1; then
  fpm -s dir -t deb -n "$APP" -v "$VERSION" -a "$ARCH" \
    --description "FieldOps — offline-first field worker SaaS (Expo web + Supabase)" \
    --url "https://github.com/ausgreekdev-cpu/fieldops" \
    --maintainer "FieldOps <fieldops@example.com>" \
    --prefix /usr/share \
    -p "$DEB" \
    "$APPDIR/usr/share/${APP}/dist"="/share/${APP}/dist" \
    2>&1 | tail -n 10
  # add bin + desktop separately
  dpkg-deb -R "$DEB" /tmp/deb-unpack 2>/dev/null && cp linux/fieldops.desktop /tmp/deb-unpack/usr/share/applications/ 2>/dev/null || true
  echo "  → $DEB (fpm)"
elif command -v dpkg-deb >/dev/null 2>&1; then
  DEBROOT="/tmp/${APP}-deb"
  rm -rf "$DEBROOT"
  mkdir -p "$DEBROOT/DEBIAN" "$DEBROOT/usr/share/${APP}" "$DEBROOT/usr/bin" "$DEBROOT/usr/share/applications" "$DEBROOT/usr/share/icons/hicolor/512x512/apps"
  cp -a "$DIST" "$DEBROOT/usr/share/${APP}/dist"
  cp linux/fieldops.desktop "$DEBROOT/usr/share/applications/"
  cp assets/icon.png "$DEBROOT/usr/share/icons/hicolor/512x512/apps/fieldops.png" 2>/dev/null || true
  cat > "$DEBROOT/usr/bin/fieldops" <<'EOS'
#!/bin/bash
exec npx -y serve -s /usr/share/fieldops/dist -l 8080
EOS
  chmod +x "$DEBROOT/usr/bin/fieldops"
  cat > "$DEBROOT/DEBIAN/control" <<EOF
Package: $APP
Version: $VERSION
Architecture: $ARCH
Maintainer: FieldOps <fieldops@example.com>
Description: FieldOps — offline-first field worker SaaS
 Offline jobs, checklists, voice-AI, invoices (Expo web + Supabase).
Depends: nodejs, npm
EOF
  dpkg-deb --build "$DEBROOT" "$DEB" 2>&1 | tail -n 10
  echo "  → $DEB (dpkg-deb)"
else
  echo "  ⊘ fpm/dpkg-deb not found — skip .deb (install fpm: gem install fpm  or  apt install dpkg-dev)"
fi

echo ""
echo "== Done =="
ls -lh "$OUT" 2>&1 | tail -n 20
echo ""
echo "Install (tar):  tar xzf $OUT/${APP}-${VERSION}-linux-${ARCH}.tar.gz -C /tmp && npx serve -s /tmp/dist -l 8080"
echo "Install (deb):  sudo dpkg -i $DEB && fieldops"
echo "Install (docker): docker build -f linux/Dockerfile -t fieldops:linux . && docker run -p 8080:80 fieldops:linux"
echo "Desktop:  sudo bash linux/install.sh  (or --user)"
