#!/bin/bash
# Builds "NoCap Edit.app", quits the copy that is running, puts the new one in /Applications and opens it.
# Usage: scripts/build-app.sh          (add --no-open to build and install without opening)
#
# The app holds only the desktop shell (desktop/) and the built site (out/). Projects are not in the
# app: they live in ~/Library/Application Support/NoCap Edit, which this script never touches, so
# reinstalling keeps them. See docs/DESKTOP_PLAN.md.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="NoCap Edit"
BUNDLE_ID="local.nocap-edit"
ARCH="$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64)"
DEST="/Applications/$APP.app"

# The gate, then the site itself.
npm run -s lint >/dev/null
npm run -s typecheck
npm test >/dev/null
npm run -s build >/dev/null
[ -f out/index.html ] || { echo "build failed: out/index.html is missing"; exit 1; }

# Everything is put together in a temporary folder outside the project.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nocap-edit-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# The icon, from the site's own 512 px icon.
SET="$WORK/icon.iconset"
mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" public/icon-512.png --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z "$((s * 2))" "$((s * 2))" public/icon-512.png --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$WORK/icon.icns"

# Only what the app runs: the shell and the built site. No node_modules (the shell uses only
# Electron and Node's own modules), no source.
STAGE="$WORK/stage"
mkdir -p "$STAGE"
cp -R desktop "$STAGE/desktop"
cp -R out "$STAGE/out"
VERSION="$(node -p "require('./package.json').version")"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
ELECTRON_VERSION="$(node -p "require('./node_modules/electron/package.json').version")"
cat > "$STAGE/package.json" <<EOF
{ "name": "nocap-edit", "productName": "$APP", "version": "$VERSION", "description": "built from $SHA", "main": "desktop/main.mjs" }
EOF

npx electron-packager "$STAGE" "$APP" --platform=darwin --arch="$ARCH" --out="$WORK/dist" --overwrite \
  --electron-version="$ELECTRON_VERSION" --icon="$WORK/icon.icns" --app-bundle-id="$BUNDLE_ID" \
  --app-version="$VERSION" --build-version="$SHA" >/dev/null

BUILT="$WORK/dist/$APP-darwin-$ARCH/$APP.app"
[ -d "$BUILT" ] || { echo "build failed: $BUILT is missing"; exit 1; }
[ -f "$BUILT/Contents/Resources/app/out/index.html" ] || { echo "build failed: the site is not inside the app"; exit 1; }

# Renaming Electron and adding the site leaves Electron's own signature not matching the app. Sign it
# again with a local ("ad-hoc") signature: no Apple account involved, valid on this Mac only.
codesign --force --deep --sign - "$BUILT" 2>/dev/null
codesign --verify --deep "$BUILT" || { echo "build failed: the app's signature does not verify"; exit 1; }

# only ever replace our own app
if [ -d "$DEST" ]; then
  HAVE="$(defaults read "$DEST/Contents/Info" CFBundleIdentifier 2>/dev/null || true)"
  [ "$HAVE" = "$BUNDLE_ID" ] || { echo "$DEST exists and is a different app ($HAVE); not touching it"; exit 1; }
  osascript -e "quit app id \"$BUNDLE_ID\"" 2>/dev/null || true
  sleep 1
  rm -rf "$DEST"
fi
cp -R "$BUILT" "$DEST"
echo "installed $DEST ($VERSION, $SHA)"
[ "${1:-}" = "--no-open" ] || open "$DEST"
