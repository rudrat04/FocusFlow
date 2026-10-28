#!/usr/bin/env bash
# Measures FocusFlow's CPU, memory and macOS "energy impact" in steady states (needs the built app and ffmpeg).
# Usage: scripts/bench.sh [app path]   Output: one line per scenario. Plays at a very low volume.
set -uo pipefail
cd "$(dirname "$0")/.."
APP="${1:-src-tauri/target/release/bundle/macos/FocusFlow.app/Contents/MacOS/tauri-app}"
W="$(mktemp -d)"; mkdir -p "$W/media" "$W/data" "$W/lib"
i=0; for f in 220 277 330 392 440; do i=$((i+1)); ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=$f:duration=240" -af volume=0.3 -ac 2 -ar 44100 "$W/media/tone_$i.mp3"; done

scenario() {  # name, bench string
  local name="$1" bench="$2"
  if [ -n "${FILTER:-}" ] && ! echo "$name" | grep -qE "$FILTER"; then return; fi
  pkill -f "tauri-app" 2>/dev/null; sleep 1
  local before; before=$(pgrep -f "com.apple.WebKit" | sort | tr '\n' ' ')
  FOCUSFLOW_DATA_DIR="$W/data" FOCUSFLOW_SELFTEST_OUT="$W/none.json" FOCUSFLOW_SELFTEST_MEDIA="$W/media" FOCUSFLOW_SELFTEST_LIB="$W/lib" FOCUSFLOW_BENCH="$bench" "$APP" >/dev/null 2>&1 &
  disown
  local app=$!
  sleep 6
  osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is '"$app"') to true' >/dev/null 2>&1  # bring the window to the front so it really renders
  sleep 8
  local pids="$app"
  for p in $(pgrep -f "com.apple.WebKit"); do case " $before " in *" $p "*) ;; *) pids="$pids $p";; esac; done
  # 5 samples, 4 s apart; the first sample is discarded (top reports since-start for it).
  local out; out=$(top -l 6 -s 4 -stats pid,cpu,power,mem 2>/dev/null)
  echo "$out" | python3 -c "
import sys,re
import subprocess
import subprocess
pids=set('$pids'.split())
role={}
for p in pids:
    c=subprocess.run(['ps','-o','comm=','-p',p],capture_output=True,text=True).stdout
    role[p]='app' if 'tauri-app' in c else 'web' if 'WebContent' in c else 'gpu' if 'GPU' in c else 'net'
role={}
for p in pids:
    c=subprocess.run(['ps','-o','comm=','-p',p],capture_output=True,text=True).stdout
    role[p]='app' if 'tauri-app' in c else 'web' if 'WebContent' in c else 'gpu' if 'GPU' in c else 'net'
samples=[];cur=[]
for line in sys.stdin:
    if line.startswith('Processes:'):
        if cur: samples.append(cur)
        cur=[]
    m=re.match(r'\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)([KMG])',line)
    if m and m.group(1) in pids:
        mem=float(m.group(4))*{'K':1/1024,'M':1,'G':1024}[m.group(5)]
        cur.append((float(m.group(2)),float(m.group(3)),mem,role[m.group(1)]))
if cur: samples.append(cur)
s=samples[2:] or samples
n=len(s)
cpu=sum(sum(x[0] for x in smp) for smp in s)/n
pw=sum(sum(x[1] for x in smp) for smp in s)/n
mem=sum(sum(x[2] for x in smp) for smp in s)/n
split={r:sum(x[0] for smp in s for x in smp if x[3]==r)/n for r in ('app','web','gpu')}
split={r:sum(x[0] for smp in s for x in smp if x[3]==r)/n for r in ('app','web','gpu')}
print(f'{\"$name\":<34} CPU {cpu:5.1f}%  [app {split[\"app\"]:4.1f} web {split[\"web\"]:4.1f} gpu {split[\"gpu\"]:4.1f}]  energy {pw:5.1f}   RAM {mem:4.0f} MB')
"
  pkill -f "tauri-app" 2>/dev/null
}

echo "scenario                           (CPU % is of one core; energy impact as in Activity Monitor; lower is better)"
scenario "paused, window visible"          "play=0;theme=stargazing"
scenario "playing, stargazing"             "theme=stargazing"
scenario "playing, forest"                 "theme=forest"
scenario "playing, northern lights"        "theme=aurora"
scenario "playing, ocean"                  "theme=ocean"
scenario "playing, window hidden"          "theme=stargazing;hide=1"
