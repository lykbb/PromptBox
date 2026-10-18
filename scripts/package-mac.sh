#!/bin/bash
# 打包成 macOS 桌面应用：release/PromptBox.app，拖到桌面或「应用程序」里双击就能用。
# 不装任何东西，只用系统自带的 python3 和 Chrome：双击后在本机 127.0.0.1:5190 起一个只给自己用的网页服务，
# 再用 Chrome 的独立窗口打开。桌面版不带示例，打开就是空的；数据存在 Chrome 里，和开发服务器（5180）的互不影响。
set -euo pipefail
cd "$(dirname "$0")/.."

APP=release/PromptBox.app
SITE="$APP/Contents/Resources/site"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" release/.build

npx tsc --noEmit
VITE_SAMPLES=off npx vite build --outDir "$SITE" --emptyOutDir

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>PromptBox</string>
  <key>CFBundleDisplayName</key><string>PromptBox</string>
  <key>CFBundleIdentifier</key><string>local.promptbox.desktop</string>
  <key>CFBundleExecutable</key><string>PromptBox</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/PromptBox" <<'LAUNCH'
#!/bin/bash
# 双击打开 PromptBox：在本机起一个只给自己用的网页服务（只监听 127.0.0.1，别的电脑访问不到），
# 再用 Chrome 的独立窗口打开。服务已经在跑就直接打开。
PORT=5190
SITE="$(cd "$(dirname "$0")/../Resources/site" && pwd)"
if ! /usr/bin/curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  cd "$SITE"
  nohup /usr/bin/python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  for _ in $(seq 1 50); do
    /usr/bin/curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
    sleep 0.1
  done
fi
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="http://localhost:$PORT/"
else
  open "http://localhost:$PORT/"
fi
LAUNCH
chmod +x "$APP/Contents/MacOS/PromptBox"

# 图标：用 favicon.svg 渲染成各个尺寸，再合成 .icns。生成失败也不影响使用，只是显示默认图标
ICONSET=release/.build/AppIcon.iconset
mkdir -p "$ICONSET"
if qlmanage -t -s 1024 -o release/.build public/favicon.svg >/dev/null 2>&1 && [ -f release/.build/favicon.svg.png ]; then
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" release/.build/favicon.svg.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" release/.build/favicon.svg.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" || echo "图标没生成，使用默认图标"
else
  echo "图标没生成，使用默认图标"
fi

echo "打包好了：$(pwd)/$APP"
