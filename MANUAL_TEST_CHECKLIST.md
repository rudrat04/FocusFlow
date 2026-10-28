# Manual test checklist

Nothing below has been run by the automated suite. Tick items as you perform them and note the date, build and result. See `TEST_REPORT.md` for what *was* automatically verified.

Prepare: import at least 6 tracks of 2+ minutes (plus one very short track, one MP3, one FLAC, one M4A). Use headphones for the spatial checks.

## Basic playback
- [ ] Play, pause, resume. No clicks or pops on pause/resume.
- [ ] Next / previous across 6+ tracks; previous after >3 s restarts the track.
- [ ] Seek by dragging the bar and with ←/→; no stutter after seeking.
- [ ] Volume slider and mute: no sudden jumps; unmute returns to the prior level.
- [ ] Shuffle: order differs, current track unaffected; turning it off restores order.
- [ ] Repeat one / all / off behave as labelled; one-track queue with repeat all loops.
- [ ] Rapidly click Next 20×: exactly one track plays, no overlap, queue position is right.
- [ ] Queue: remove, play-now, add next / add to end.
- [ ] Missing file: move a track out of the library folder, press Rescan → flagged "File missing"; playing the queue skips it with a toast.
- [ ] Corrupt file: rename a text file to `x.mp3`, import → reported as failed, not added.

## Crossfade
- [ ] Set crossfade to 0, 3, 8, 12 s; transitions overlap by that amount with no volume bump.
- [ ] Short track (< 2× crossfade) transitions cleanly.
- [ ] Changing crossfade while playing applies from the next transition.

## 30-minute continuous test
- [ ] Queue of ≥ 6 tracks, repeat all, shuffle on, crossfade 3 s, volume moderate.
- [ ] Play 30 min with the window hidden (close button) for most of it.
- [ ] Count: no gaps, no duplicate or overlapping tracks, no stuck state. Record start/end CPU and memory (Activity Monitor): start ____ / end ____.

## Multi-hour soak (4–8 h)
- [ ] Play a repeating queue with keep-awake on, power connected, display allowed to sleep.
- [ ] Check at 1 h, 2 h, 4 h: still playing, no gaps, memory not growing (record MB each time).
- [ ] Afterwards open Settings → Status and read the error log.

## Full 24 h test
- [ ] Repeating queue, power connected, keep-awake on, for 24 h. Record whether it kept playing the whole time, and any interruption and its cause.

## Restart and recovery
- [ ] Quit mid-track with "Restore queue on launch" on: relaunch → queue and position restored, **paused**, nothing plays.
- [ ] Force-quit (`kill -9`) during playback: relaunch → no data loss, settings intact.

## macOS sleep / wake and power
- [ ] Play, then sleep from the Apple menu, wake after ~2 min: playback state sensible; toast about the gap.
- [ ] With keep-awake ON and playing: leave the Mac idle past your sleep setting → system stays awake (display may sleep). With it OFF → Mac sleeps normally.
- [ ] `pmset -g assertions` shows a FocusFlow assertion while playing and none after pause/quit.
- [ ] Close the lid on battery → expect sleep (documented limitation).

## Earbuds, Bluetooth and media keys (not verified by the automated tests)
- [ ] Play something in FocusFlow, then open Control Center: Now Playing shows FocusFlow with the right title and cover.
- [ ] With a paused YouTube tab open, press the earbud/AirPods button (or the keyboard play/pause key): FocusFlow pauses and resumes, and the YouTube video does **not** start.
- [ ] Same with the window hidden (closed to the menu bar).
- [ ] Double-press / triple-press the earbud (or the keyboard next/previous keys): next and previous track.
- [ ] Try a second Bluetooth device (headphones, a speaker, a car stereo) and the Mac's own keyboard keys.
- [ ] Pause FocusFlow, start something in Safari/Chrome, then press play in Control Center for FocusFlow: it resumes.
- [ ] Turn the earbuds off or take them out of range while playing: FocusFlow pauses (it should not switch to the speakers).

## Spatial audio (use headphones, including Bluetooth ones)
- [ ] Off → Wide → Room → Orbit on a song you know: each is clearly different from the last (Wide is wider, Room has a sense of space, Orbit travels around your head).
- [ ] The intensity slider makes each effect stronger or weaker.
- [ ] If the Bluetooth headset is in call mode (mic in use), the warning about a mono output appears.

## Audio output changes
- [ ] Plug in / connect headphones or AirPods mid-track: audio follows (brief gap acceptable), no crash.
- [ ] Unplug them: playback continues on the speakers (or pauses; note which).
- [ ] Switch output in Control Center while playing.
- [ ] Change the device sample rate in Audio MIDI Setup (44.1 ↔ 48 kHz): track resumes at the same position, correct pitch.

## Sleep timer
- [ ] 1-minute timer with 20 s fade: volume ramps smoothly, then stops; cancel mid-fade restores volume.

## Spatial audio
- [ ] Off / Wide / Room / Orbit with headphones; intensity slider; no clipping or loud jumps when switching.

## Themes
- [ ] Switch through all six; text stays readable on each (check Mountains and Desert, the brightest).

## Cover art
- [ ] Import a track with embedded cover art: it shows in Songs, Now Playing and the song page.

## Link import (needs yt-dlp + ffmpeg)
- [ ] Single link with chapters → separate tracks with chapter names.
- [ ] Two links at once; one invalid → the other still imports.
- [ ] Re-importing the same link is refused.
- [ ] A mix **without chapters** whose description lists timestamps → split at them (progress says "from the description").
- [ ] A mix without chapters but with a pinned comment tracklist → split from the comment.
- [ ] A compilation with silent gaps and no text tracklist → "Track 1, 2, …"; cuts land between songs, not inside them.
- [ ] A gapless continuous mix with nothing to find → stays one track with a clear message.
- [ ] A YouTube Music album or playlist link → one track per entry, with titles and thumbnails, album named after the playlist.
- [ ] Rename an auto-named track on its song page.
- [ ] Destination “New album” → all tracks share the name in Albums; “New playlist” → playlist created with all tracks; the video thumbnail becomes the cover.
- [ ] Video without chapters + pasted timestamps → split at those times.

## Menu bar / shortcuts
- [ ] Menu-bar icon: Show, Play/Pause, Previous, Next, Quit all work; Quit releases keep-awake.
- [ ] Keyboard shortcuts listed in the README work; typing in a text field doesn't trigger them.

## Memory and CPU over time
Record at 0 / 30 min / 2 h / 8 h / 24 h (Activity Monitor → FocusFlow and its web content process):

| Time | CPU % | Memory MB | Notes |
|---|---|---|---|
| 0 | | | |
| 30 min | | | |
| 2 h | | | |
| 8 h | | | |
| 24 h | | | |

## Battery (needs the Mac unplugged)
- [ ] Note the battery %, play for 1 hour at your normal volume with the window visible, note the % again. Repeat with the window hidden. Compare with another music app for reference.
- [ ] Activity Monitor → Energy tab: FocusFlow's "Energy Impact" and "12 hr Power" stay low (single digits).

## New in the latest round (none of this could be tested automatically)
- [ ] **Sleep and wake:** play, close the lid (or Apple menu → Sleep), wake after a minute. With "Resume after the Mac wakes" on, music carries on and a message says how long the Mac slept; with it off, it stays paused.
- [ ] **Devices:** connect AirPods mid-song (audio should move over within about a second), then switch them off (it should pause, not jump to the speakers).
- [ ] **Loudness:** import a very quiet and a very loud file. With "Even out loudness" on, they sound about equally loud; toggling it off and on glides without a click.
- [ ] **Seeking** in a long VBR MP3: click various points; playback starts exactly there.
- [ ] **Mini player:** open it from the bottom bar and from the menu-bar icon; play/pause, next, previous, seek and favorite work; the pin keeps it above other windows; closing it frees it. Check it looks right in each theme.
- [ ] **Menu-bar title** shows the song while playing and disappears when paused.
- [ ] **yt-dlp:** with an old yt-dlp the banner appears; "Update yt-dlp" updates it; a private video and a bot-check video give a clear message (not a raw error).
