# FocusFlow

A dark, glass-style music player for long work sessions on macOS (built for Apple Silicon), laid out like Apple Music. It plays audio files from your own library with crossfade, a sleep timer, a headphone spatializer, cover art, eight static nature themes, and an optional keep-awake mode. It works fully offline: no account, backend, subscription or AI API is needed to play music.

**FocusFlow ships with no music.** You add your own: files you made, own or are licensed to use.

## Quick start

```bash
git clone https://github.com/rudrat04/FocusFlow.git
cd FocusFlow
```

Requirements: macOS on Apple Silicon, Node.js, Rust (`rustup`), Xcode Command Line Tools.
For "Add from link" only: `brew install yt-dlp ffmpeg`.

```bash
npm install
npm run tauri dev        # run the app in development
npm test                 # frontend logic tests (queue, shuffle/repeat, timers, transitions)
cd src-tauri && cargo test --lib   # backend tests (engine, library, playlists, link parsing, keep-awake)
npm run tauri build      # production build: .app and .dmg
./scripts/selftest.sh    # drives the built app end to end (quiet audio for ~1 min)
```

What was actually tested, and what was not: see `TEST_REPORT.md`. Long-run and sleep/wake tests are in `MANUAL_TEST_CHECKLIST.md` and have **not** been performed yet.

Build output:

- App: `src-tauri/target/release/bundle/macos/FocusFlow.app`
- Installer: `src-tauri/target/release/bundle/dmg/FocusFlow_0.1.0_aarch64.dmg`

The build is unsigned. The first time you open it from the DMG, right-click the app → **Open**. It is fine for your own Mac; distributing to others would need an Apple Developer ID and notarization.

## Adding music

- **Import files / folder:** Library → Files or Folder, or drag audio onto the window. MP3, M4A/AAC, WAV and FLAC are supported (OGG too). Files are copied into your library folder (`~/Music/FocusFlow` by default, outside the app, so you can add music without rebuilding). Duplicates are detected by content and skipped; unreadable files are reported and not imported.
- **Drop files in the folder:** put audio into `~/Music/FocusFlow` and press **Rescan**.
- **Add from link:** paste one or more links. FocusFlow uses your installed `yt-dlp` and `ffmpeg` to download the audio, then splits it into separate MP3 tracks (cover = the video's thumbnail). Before importing, choose where the tracks go: just your **Music library**, a **New album** (every track gets that name), or a **New playlist**. How it finds the tracks:
  1. **A video with chapters:** one track per chapter.
  2. **A video without chapters** (with "Find the tracks automatically" on, the default), in this order: the timestamps you paste into the box; a timestamped track list in the **description**; a track list in the **top comments** (many mixes pin one); then **silence between tracks**, found by listening to the audio. Tracks found by silence are named "Track 1, 2, 3…" because the audio has no titles; rename them on each song's page. If nothing is found, it stays one track.
  3. **An album or playlist link** (for example `music.youtube.com/playlist?list=…`): every entry becomes its own track with its own title and thumbnail, and the album gets the playlist's name. A link to a single video that merely includes `&list=` imports just that video; paste the playlist link itself to get them all.

  Only import audio you have the right to keep; downloading can violate a site's terms. If a download stops working, update the tool: `brew upgrade yt-dlp`. Silence detection can't split a continuous, gapless mix; for those, paste timestamps.

## Using it

| Section | What it does |
|---|---|
| Now Playing | Large cover art, seek bar, transport, a sound-mode menu beside Shuffle, and the queue (play, reorder, remove). |
| Songs | Search, filter (all / favorites / missing), import, rescan. Click a title to open its song page. |
| Albums | Grid of albums. Open one to Play, Shuffle or Edit (rename it, add songs, remove songs, delete the album). “New album” builds one from songs you pick. |
| Playlists | Create, Play, Shuffle, and Edit (rename, add songs, remove, reorder, delete). Songs can also be added from a song's “…” menu. |
| Favorites | Tracks you hearted. |
| Settings | Theme, crossfade (0–12 s, default 3), shuffle/repeat defaults, spatial audio, sleep timer, power, library folder. |

Clicking a song's **thumbnail** in any list, or the cover or title in the bottom bar, opens Now Playing. The bar at the bottom works like Apple Music's: shuffle, previous, play/pause, next and repeat on the left; a "now playing" display with progress in the middle ; sleep timer, spatial audio and volume on the right.

**Song page:** click any song title in a list for its cover art, details (duration, format, sample rate, channels, size, date added, playlists, file path, source link), and actions, and you can edit its title, artist and album. 

**Thumbnails:** clicking a song's thumbnail in any list plays it and opens Now Playing.

### Themes

Settings → Theme: **Stargazing** (the original), **Forest**, **Ocean**, **Mountains**, **Desert** and **Northern lights**. Each has its own colours and accent and a generated landscape. The scenes are drawn in code (nothing is licensed) and are **static**: nothing animates, so they cost no GPU time while you listen.

### Efficiency

FocusFlow is built to stay cool and sip power: no animations, static scenes, and almost no background wake-ups. The audio engine sleeps between short bursts of decoding, progress is reported twice a second (every few seconds when the window is hidden), and only the progress bars redraw. `scripts/bench.sh` measures it. On an M2 MacBook Air, plugged in, with the window in front, playing used roughly **2–5% of one CPU core** (≈ 0.3–0.6% of the whole chip) and about 250–290 MB of RAM; with the window hidden to the menu bar about **2%**, and paused under 1%. An earlier build that had animations used 12–64%. Battery drain itself was not measured (see TEST_REPORT.md).

### Queue

Hover a song in the queue to get up, down and remove buttons, or drag it by its handle to reorder.

### Sleep timer

The moon button in the bottom bar starts a timer (15–90 min). The volume fades out gradually over the length set in Settings, then playback stops. The timer is based on the clock, not on counting ticks.

### Keep awake

"Keep Mac awake while playing" holds an IOKit power assertion (`PreventUserIdleSystemSleep`) only while audio is playing. It is released on pause, stop, quitting, or turning the setting off. It does not keep the display awake.

### Spatial audio

Four modes, switchable from the headphone icon beside Shuffle on Now Playing, the headphone button in the bottom bar, or Settings, each with an intensity slider:

- **Off:** plain stereo.
- **Wide:** a much wider stage (it opens up even near-mono recordings), with a little crossfeed so it stays comfortable.
- **Room:** two virtual speakers in a room, with early reflections and reverb.
- **Orbit:** the sound circles your head about once every 10 seconds.

This is FocusFlow's own lightweight processing (interaural delay and level, head-shadow filtering, reflections, reverb), not measured-HRTF binaural rendering. It works with any stereo headphones, wired or Bluetooth. It cannot work when the output is **mono**: a Bluetooth headset switches to mono "call mode" when something is using its microphone. FocusFlow warns you when that happens; pick the stereo output in System Settings → Sound. AirPods also have system Spatial Audio in Control Center; apps cannot toggle that, so keep this Off if you use it.

### Earbuds, Bluetooth and media keys

FocusFlow registers with macOS as a Now Playing app, so the Mac's media keys, AirPods and earbud buttons, Bluetooth headsets and Control Center control it: play/pause (from the earbud stem or button), next, previous and scrubbing. Play/pause is handled directly by the audio engine, so it works even when the window is hidden. Because it announces itself as the active player, these buttons no longer go to a paused video in your browser. If you disconnect the headphones that were playing, FocusFlow pauses instead of switching to the speakers.

## Known limitations (please read)

- **Playback can be interrupted by things the app cannot control:** system sleep (manual, or closing the lid on battery), a flat battery, shutdown or restart, macOS updates, and some audio device changes. Keep-awake only prevents *idle* sleep. When the output device changes (e.g. earbuds connected) FocusFlow follows the new default device and resumes the track, but a brief gap is possible.
- **Long-run reliability has not been proven on real hardware.** The automated tests cover logic and short real-device runs only. Run the checklist in `MANUAL_TEST_CHECKLIST.md` (30-minute, multi-hour and 24-hour tests) before relying on it.
- Resampling uses linear interpolation; if your files are 44.1 kHz and the device runs at 48 kHz, audio is very slightly less pristine than a high-order resampler. Seeking in some VBR MP3s may land a few tens of milliseconds off.
- Tracks are not loudness-normalized, so different sources may differ in volume.
- No mini-player window yet. (There is no "24 hour session" mode any more: it was removed on request. Playback simply loops the queue until you stop it or the sleep timer ends it.) The menu-bar controls, keyboard shortcuts and DMG are included.
- Link import depends on third-party tools and on the site; it can break when the site changes.
- Release builds are unsigned.

## Troubleshooting

- **"Audio engine unavailable":** no output device was found at launch. Connect/select one in System Settings → Sound and relaunch.
- **A track is skipped with an error toast:** open Settings → Status to see the error log. Missing files are flagged in the Library ("File missing"); restore them and press Rescan.
- **Link import says tools are missing:** `brew install yt-dlp ffmpeg`. GUI apps do not see your shell PATH, so FocusFlow looks in `/opt/homebrew/bin` and `/usr/local/bin`.
- **App won't open from the DMG ("unidentified developer"):** right-click → Open once.
- **Where is my data?** Library, playlists and favorites: `~/Library/Application Support/com.focusflow.app/library.db`. Settings and playback state are small JSON files in the same folder. Music: `~/Music/FocusFlow` (changeable).

## Project layout

```
src/                 React + TypeScript interface
  lib/queue.ts       queue, shuffle, repeat (pure, tested)
  lib/timers.ts      sleep timer (pure, tested)
  lib/transition.ts  engine-event decisions (pure, tested)
  lib/player.ts      controller: engine, library, persistence, timers
src-tauri/src/
  audio.rs           decoding threads, mixer, crossfade, output device handling
  dsp.rs             spatializer
  library.rs         SQLite library, playlists, favorites, error log, import
  ytdl.rs            link import and chapter splitting
  awake.rs           keep-awake power assertion
  lib.rs             Tauri commands, tray, window behaviour
```

Track transitions (preload, crossfade start, promotion to the next track) are done by the Rust engine, so they do not depend on webview timers.
