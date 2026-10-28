# Test report

Date: 2026-10-28 (updated after the media-key, spatial-audio and animation changes) · Machine: MacBook Air (Apple Silicon), macOS 27.0.1 · Build: FocusFlow 0.1.0 (release, unsigned)

Everything in "Ran" was actually executed on this Mac and passed in the final run. "Not run" lists what was **not** verified. Do not read the absence of a failure there as a pass.

## Ran

### Frontend logic: `npm test` → 24 passed, 0 failed (3 files)
| Area | Tests |
|---|---|
| Queue management (`queue.test.ts`) | empty queue, forward walk, end with repeat off, wrap with repeat all, repeat one (auto vs manual), one-track queue in every repeat/shuffle mode, skipping unplayable tracks, all-unplayable queue, enqueue next/end, removal keeps current track, move, 500 rapid next/previous steps stay in range |
| Shuffle / repeat | current track stays first, same set of tracks, un-shuffle restores order at current track, reshuffle each lap without repeating the last track first (20 laps) |
| Sleep timer (`timers.test.ts`) | fade then stop, fade clamped to length, minimum 1 min, zero-fade |
| Track-transition state (`transition.test.ts`) | adopt preloaded next, stale serials ignored, superseded plays ignored, repeat-one, resync on unexpected track |

### Backend: `cargo test --lib` → 32 passed, 0 failed
Engine (missing file → error, corrupt file → no panic, gapless promotion without a silent gap, exactly one crossfade transition with bounded level, pause consumes nothing, single track ends once, seek offset), spatializer (off is passthrough; wide/room/orbit stay finite and bounded), library (import files and folders, duplicate skipping by content, corrupt and missing files reported, files that disappear are flagged, **playlists/favorites persisted across closing and reopening the database**, error log), link import (timestamp parsing, name sanitizing, rejects non-links, playlist-link detection, track lists from descriptions and comments, silence-gap cut rules, and a **real-ffmpeg test that builds a file of three tracks separated by silence, finds both gaps, splits it into three MP3s and imports them with the right total duration**), song renaming, keep-awake (acquire/release a real IOKit assertion), album assignment and artwork round-trip, spatializer effect size (each mode must change at least 20–25% of the signal energy at 50% intensity, vs 2–12% before the rewrite; intensity slider scales it; Wide opens a mono source; Room leaves a reverb tail; Orbit swings the left/right balance by about 30 dB).

### Real files and real audio device: `cargo test --lib -- --ignored` → 3 passed
- MP3, M4A, FLAC, WAV and a mono 48 kHz MP3 decode at both 44.1 kHz and 48 kHz output; durations correct; peak levels match ffmpeg's independent measurement within 8%.
- Real output device: play → preloaded next track → crossfade → next becomes current → exactly one `Ended` event; positions advance monotonically.
- 40 rapid skips (with seeks) on the real device, then pause / resume / stop with correct states and no more than 4 fading tracks at once.

### Real app end to end: `scripts/selftest.sh` → 40 checks passed, 0 failed
The built app was launched against a throwaway data folder and driven through its real UI code, commands and audio device: import (5 files; re-import = 5 duplicates), play, pause/resume (position frozen while paused), next/previous, 12 rapid Next presses ending in one playing track, seek, automatic advance with a 1 s crossfade, shuffle and repeat-one, spatial modes switching during playback, album grouping, renaming and removing songs from an album, opening a song page, playlist reordering, theme change saved, renaming a song (and refusing an empty title), queue reordering, shuffle-play, the thumbnail play-and-open-Now-Playing action, handing now-playing info to macOS, sleep timer start/cancel, favorites and playlists saved, **a missing file being flagged and skipped to the next playable track with the error logged**, playback state saved, keep-awake released after stop.
Earlier in development this run **found and fixed a real deadlock** (an unplayable track froze the player), and the unit test for the animation levels found and fixed levels freezing on pause. The results above are after those fixes.

### Checked from outside the app
- `pmset -g assertions` showed `PreventUserIdleSystemSleep named "FocusFlow is playing music"` while playing and none after stopping. It is the system-sleep assertion only, not a display one.
- Restart recovery (checked on the build before the 24-hour mode was removed): relaunching restored the queue and started no playback or assertion. Not re-run after the redesign.
- Production build: `npm run build` (TypeScript + Vite) and `npm run tauri build` both succeed, producing `FocusFlow.app` (7.7 MB) and `FocusFlow_0.1.0_aarch64.dmg` (3.7 MB). The `.app` launches.

## Not verified: earbud and Bluetooth buttons
The code registers FocusFlow with macOS Now Playing (MPRemoteCommandCenter via the `souvlaki` crate), publishes the title, artist, cover and position, applies play/pause directly in the audio engine, and pauses when the playing output device disappears. The build and the self-test confirm the app starts, accepts now-playing info, and runs. **I could not press a real earbud, AirPods or media key, so I have not seen the buttons control FocusFlow, nor the paused-YouTube problem go away.** The checklist has the exact steps.

## Efficiency (measured with `scripts/bench.sh`, plugged in, window in front)
Energy impact is macOS's own figure (as in Activity Monitor), a proxy for battery use. CPU is % of one core, summed over the app and its web view and graphics processes.

| Scenario | Before (animations, moving themes) | After |
|---|---|---|
| Paused | 1.2% | 0.7–0.8% |
| Playing, default theme, artwork | 36% | 2–5% |
| Playing, other static themes | 12–17% | 2–5% (0.5–9% across repeated runs) |
| Playing, animation (any of five) | 43–64% | removed |
| Playing, window hidden to menu bar | 12% | ~2% |
| RAM | 270–380 MB | 220–290 MB |

What changed: animations and moving themes removed; the audio-analysis code that fed them removed; engine loop 40 ms → 200 ms; decoder polling 15 ms → 150 ms; progress events 4/s → 2/s (every 3 s when the window is hidden); only the progress bars re-render on a tick; scene layers are cached bitmaps; lighter glass blur.
**Caveats:** run-to-run noise is large (the same scene ranged 0.5–8.7% across runs, depending on what else the Mac was doing and the window state), so treat these as ranges. **Actual battery drain was not measured**: the Mac was plugged in, so only CPU and energy impact were recorded. The unplugged test is in `MANUAL_TEST_CHECKLIST.md`.

## Not verified: link import against real videos
The new detection (description → comments → silence) and playlist/album handling were tested on synthetic data and with a local ffmpeg-built file, not on real YouTube videos. In particular: how yt-dlp's comment extraction behaves on your videos, what YouTube Music album links resolve to, and how well silence detection splits real compilations are unconfirmed. Nothing was downloaded.

## Not run (needs you)
Nothing here has been verified; use `MANUAL_TEST_CHECKLIST.md`.
- **30-minute, multi-hour and 24-hour continuous playback**, and CPU/memory over time. The longest real-device run was about 15 seconds.
- **macOS sleep/wake** behaviour, lid close, battery depletion.
- **Audio output changes** (plugging in AirPods/headphones, changing sample rate). The code rebuilds the output stream on device change and re-opens the current track at the same position, but this was not exercised with real hardware changes.
- **Link import (yt-dlp/ffmpeg)** end to end: only the parsing helpers and the "not a link" path were tested; no download was performed. Both tools are installed (yt-dlp 2026.10.26, ffmpeg 9.0.2).
- **How it sounds**: crossfade smoothness, loudness consistency and the spatial modes were checked numerically (bounded, finite, continuous), not by ear.
- **Visual check of the native window**: the interface was reviewed in a browser preview with a mock backend; I could not screenshot the native window. Drag-and-drop of files, the file/folder pickers, and the menu-bar icon menu were not exercised.
- **Not exercised in the native window:** the sound-mode menu on Now Playing (checked in a browser preview, and the spatial modes by numbers rather than by ear); and also cover-art extraction from real files with embedded art, thumbnails from link imports, the album/playlist destination choice for link imports (the UI was checked in a browser preview; the controller code is typechecked, and album assignment is covered by tests), and how the animation looks with real music.
- Mini-player window: not implemented.

## Reproduce
```bash
npm test
(cd src-tauri && cargo test --lib)
FOCUSFLOW_TEST_MEDIA=/path/to/dir/with/tone_a.mp3,tone_b.m4a,tone_c.flac,tone_d.wav,mono48.mp3 \
  bash -c 'cd src-tauri && cargo test --lib -- --ignored --test-threads=1'
npm run tauri build && ./scripts/selftest.sh
```
(The ignored tests play a very quiet tone through the default output device for a few seconds.)
