#!/usr/bin/env bash
# Build a standalone Apple Silicon app using only the existing Node and Apple toolchain.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
VERSION="$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')"
OUTPUT_DIR="${PROMPTBOX_OUTPUT_DIR:-$ROOT_DIR/release/PromptBox-Desktop-v$VERSION}"
APP_BUNDLE="$OUTPUT_DIR/PromptBox.app"
if [ -e "$OUTPUT_DIR" ] && ! { [ "${PROMPTBOX_REBUILD:-0}" = "1" ] && [ -f "$OUTPUT_DIR/.promptbox-build" ]; }; then
  echo "输出目录已存在，请指定新的 PROMPTBOX_OUTPUT_DIR，避免覆盖已有应用：$OUTPUT_DIR" >&2
  exit 1
fi
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
touch "$OUTPUT_DIR/.promptbox-build"
./node_modules/.bin/tsc --noEmit
VITE_SAMPLES=off ./node_modules/.bin/vite build --outDir "$APP_BUNDLE/Contents/Resources/site" --emptyOutDir
xcrun swiftc -swift-version 5 -O -target arm64-apple-macosx14.0 \
  -module-cache-path "${TMPDIR:-/tmp}/promptbox-swift-module-cache" \
  -framework AppKit -framework WebKit -framework Network \
  desktop/LocalAssets.swift desktop/DesktopStore.swift desktop/NativeBridge.swift desktop/PromptBox.swift \
  -o "$APP_BUNDLE/Contents/MacOS/PromptBox"
cp desktop/Resources/AppIcon.icns "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>PromptBox</string>
  <key>CFBundleDisplayName</key><string>PromptBox</string>
  <key>CFBundleIdentifier</key><string>local.promptbox.desktop.native</string>
  <key>CFBundleExecutable</key><string>PromptBox</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>CFBundleDocumentTypes</key><array><dict>
    <key>CFBundleTypeName</key><string>PromptBox 导入文件</string>
    <key>CFBundleTypeRole</key><string>Viewer</string>
    <key>LSHandlerRank</key><string>Alternate</string>
    <key>CFBundleTypeExtensions</key><array><string>json</string><string>md</string><string>markdown</string><string>txt</string><string>zip</string></array>
  </dict></array>
</dict></plist>
PLIST
codesign --force --sign - "$APP_BUNDLE"
codesign --verify --strict "$APP_BUNDLE"
ditto -c -k --keepParent --norsrc --noextattr --noqtn "$APP_BUNDLE" "$OUTPUT_DIR/PromptBox-macOS-$VERSION-arm64.zip"
(cd "$OUTPUT_DIR" && shasum -a 256 "PromptBox-macOS-$VERSION-arm64.zip" > "PromptBox-macOS-$VERSION-arm64.zip.sha256")
echo "独立桌面版：$APP_BUNDLE"
