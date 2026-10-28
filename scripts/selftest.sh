#!/usr/bin/env bash
# Runs FocusFlow's real-app self-test: generates short test tones with ffmpeg, launches the built app
# against a throwaway data folder, drives it through a scripted scenario (plays very quietly through
# your speakers for ~1 minute) and prints the report. Requires: ffmpeg, and `npm run tauri build` first.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="src-tauri/target/release/bundle/macos/FocusFlow.app/Contents/MacOS/tauri-app"
[ -x "$APP" ] || { echo "Build first: npm run tauri build"; exit 1; }
W="$(mktemp -d)"; mkdir -p "$W/media" "$W/data" "$W/lib"
i=0; for spec in mp3:220 m4a:277 flac:330 wav:392; do
  ext=${spec%%:*}; f=${spec##*:}; i=$((i+1))
  ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=$f:duration=6" -af volume=0.3 -ac 2 -ar 44100 "$W/media/tone_$i.$ext"
done
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=5" -af volume=0.3 -ar 48000 -ac 1 "$W/media/mono48.mp3"
FOCUSFLOW_DATA_DIR="$W/data" FOCUSFLOW_SELFTEST_OUT="$W/out.json" FOCUSFLOW_SELFTEST_MEDIA="$W/media" FOCUSFLOW_SELFTEST_LIB="$W/lib" "$APP" >/dev/null 2>&1 &
for _ in $(seq 1 90); do [ -f "$W/out.json" ] && break; sleep 2; done
python3 - "$W/out.json" <<'PY'
import json, sys, os
p = sys.argv[1]
if not os.path.exists(p): sys.exit("self-test produced no report (app hung or crashed)")
d = json.load(open(p)); print(f"passed {d['passed']}  failed {d['failed']}")
for r in d["results"]: print(("PASS " if r["ok"] else "FAIL "), r["name"], "|", r["detail"][:120])
sys.exit(1 if d["failed"] else 0)
PY
