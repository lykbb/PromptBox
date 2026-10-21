#!/usr/bin/env bash
# Build a standalone Apple Silicon app using only the existing Node and Apple toolchain.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
VERSION="$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')"
OUTPUT_DIR="${PROMPTBOX_OUTPUT_DIR:-$ROOT_DIR/release/PromptBox-Desktop-v$VERSION}"
APP_BUNDLE="$OUTPUT_DIR/PromptBox.app"
DEFAULT_DMG="$ROOT_DIR/release/PromptBox-macOS-$VERSION-arm64.dmg"
if [ -n "${PROMPTBOX_OUTPUT_DIR:-}" ]; then DEFAULT_DMG="$OUTPUT_DIR.dmg"; fi
DMG_PATH="${PROMPTBOX_DMG_PATH:-$DEFAULT_DMG}"
if [ -e "$OUTPUT_DIR" ] || [ -e "$DMG_PATH" ]; then
  echo "应用目录或 DMG 已存在，请指定新的 PROMPTBOX_OUTPUT_DIR，避免覆盖：$OUTPUT_DIR / $DMG_PATH" >&2
  exit 1
fi
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
mkdir -p "$ROOT_DIR/release/.build-cache/swift"
./node_modules/.bin/tsc --noEmit
VITE_SAMPLES=off ./node_modules/.bin/vite build --outDir "$APP_BUNDLE/Contents/Resources/site" --emptyOutDir
xcrun swiftc -swift-version 5 -O -target arm64-apple-macosx14.0 \
  -module-cache-path "$ROOT_DIR/release/.build-cache/swift" \
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
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSDocumentsFolderUsageDescription</key><string>将提示词、规则和设置集中保存在文稿中的 PromptBox 文件夹。</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>CFBundleDocumentTypes</key><array><dict>
    <key>CFBundleTypeName</key><string>PromptBox 导入文件</string>
    <key>CFBundleTypeRole</key><string>Viewer</string>
    <key>LSHandlerRank</key><string>Alternate</string>
    <key>CFBundleTypeExtensions</key><array><string>json</string><string>md</string><string>markdown</string><string>txt</string><string>zip</string></array>
  </dict></array>
</dict></plist>
PLIST
SIGN_IDENTITY="${PROMPTBOX_SIGN_IDENTITY:--}"
if [ "$SIGN_IDENTITY" = "-" ]; then
  codesign --force --options runtime --sign - "$APP_BUNDLE"
else
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP_BUNDLE"
fi
codesign --verify --strict "$APP_BUNDLE"
ln -s /Applications "$OUTPUT_DIR/Applications"
hdiutil create -volname "PromptBox $VERSION" -srcfolder "$OUTPUT_DIR" -fs HFS+ -format UDZO "$DMG_PATH"
if [ "$SIGN_IDENTITY" != "-" ]; then
  codesign --timestamp --sign "$SIGN_IDENTITY" "$DMG_PATH"
fi
hdiutil verify "$DMG_PATH"
echo "独立桌面版：$APP_BUNDLE"
echo "DMG 安装包：$DMG_PATH"
shasum -a 256 "$DMG_PATH"
if [ "$SIGN_IDENTITY" = "-" ]; then
  echo "当前为临时签名，未做 Apple 公证；DMG 格式不会绕过 macOS 的首次打开检查。" >&2
fi
