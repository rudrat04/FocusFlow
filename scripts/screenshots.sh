#!/usr/bin/env bash
# Regenerates the README screenshots from the real interface running in Chrome with demo data
# (invented songs and generated covers from src/dev/mock.ts). Needs Google Chrome and `npm install`.
set -euo pipefail
cd "$(dirname "$0")/.."
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="docs/screenshots"; mkdir -p "$OUT"
npm run dev >/dev/null 2>&1 & DEV=$!
trap 'kill $DEV 2>/dev/null' EXIT
sleep 4
shoot() {  # name, shot, [theme]
  "$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=1440,900 \
    --virtual-time-budget=9000 --screenshot="$OUT/$1.png" "http://localhost:1420/?shot=$2${3:+&theme=$3}" >/dev/null 2>&1
  sips -Z "${4:-1920}" -s format jpeg -s formatOptions 86 "$OUT/$1.png" --out "$OUT/$1.jpg" >/dev/null && rm "$OUT/$1.png"
}
for spec in now:now sound:sound songs:songs albums:albums album:album song:track playlists:playlists settings:settings link:link; do shoot "${spec%%:*}" "${spec##*:}"; done
for t in forest ocean mountains desert aurora; do shoot "theme-$t" now "$t" 1100; done
echo "Screenshots written to $OUT"
