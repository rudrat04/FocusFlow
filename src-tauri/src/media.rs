//! macOS "Now Playing" integration. Registering with MPRemoteCommandCenter is what makes the media
//! keys, AirPods/earbud buttons, Bluetooth headsets and Control Center talk to FocusFlow instead of
//! whichever other app (a browser tab, for instance) last claimed playback.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig, SeekDirection};
use tauri::{AppHandle, Emitter};

use crate::audio::Engine;

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "action", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum MediaAction {
    /// Play/pause already applied by the engine; the UI only needs to follow.
    State { playing: bool },
    Play,
    Toggle,
    Next,
    Previous,
    Stop,
}

pub struct Media {
    controls: Arc<Mutex<MediaControls>>,
}

impl Media {
    pub fn start(app: AppHandle, engine: Option<Arc<Engine>>) -> Result<Self, String> {
        let controls = Arc::new(Mutex::new(MediaControls::new(PlatformConfig { dbus_name: "focusflow", display_name: "FocusFlow", hwnd: None }).map_err(|e| format!("{e:?}"))?));
        let handler_controls = controls.clone();
        controls
            .lock()
            .map_err(|_| "media controls poisoned")?
            .attach(move |event| handle(&app, engine.as_ref(), &handler_controls, event))
            .map_err(|e| format!("{e:?}"))?;
        Ok(Self { controls })
    }

    pub fn set_now_playing(&self, title: Option<&str>, artist: Option<&str>, album: Option<&str>, duration: f64, cover: Option<&str>, playing: bool, loaded: bool, position: f64) {
        let Ok(mut c) = self.controls.lock() else { return };
        if title.is_some() {
            let cover_url = cover.map(|p| format!("file://{p}"));
            let _ = c.set_metadata(MediaMetadata {
                title,
                artist,
                album,
                duration: (duration > 0.0).then(|| Duration::from_secs_f64(duration)),
                cover_url: cover_url.as_deref(),
            });
        }
        let progress = Some(MediaPosition(Duration::from_secs_f64(position.max(0.0))));
        let _ = c.set_playback(if !loaded {
            if title.is_some() { MediaPlayback::Paused { progress } } else { MediaPlayback::Stopped }
        } else if playing {
            MediaPlayback::Playing { progress }
        } else {
            MediaPlayback::Paused { progress }
        });
    }
}

fn handle(app: &AppHandle, engine: Option<&Arc<Engine>>, controls: &Arc<Mutex<MediaControls>>, event: MediaControlEvent) {
    let emit = |a: MediaAction| {
        let _ = app.emit("media", a);
    };
    // Play / pause / toggle are applied by the engine directly so they work even when the window
    // is hidden and the webview is throttled. With nothing loaded the UI has to pick a track.
    let current_state = engine.map(|e| e.snapshot().state);
    let apply = |want_playing: Option<bool>| {
        let (Some(e), Some(state)) = (engine, current_state) else { return emit(MediaAction::Toggle) };
        if state == "stopped" {
            return emit(MediaAction::Play);
        }
        let playing = want_playing.unwrap_or(state != "playing");
        if playing {
            e.resume();
        } else {
            e.pause();
        }
        if let Ok(mut c) = controls.lock() {
            let snap = e.snapshot();
            let progress = Some(MediaPosition(Duration::from_secs_f64(snap.position.max(0.0))));
            let _ = c.set_playback(if playing { MediaPlayback::Playing { progress } } else { MediaPlayback::Paused { progress } });
        }
        emit(MediaAction::State { playing });
    };
    match event {
        MediaControlEvent::Play => apply(Some(true)),
        MediaControlEvent::Pause => apply(Some(false)),
        MediaControlEvent::Toggle => apply(None),
        MediaControlEvent::Next => emit(MediaAction::Next),
        MediaControlEvent::Previous => emit(MediaAction::Previous),
        MediaControlEvent::Stop => emit(MediaAction::Stop),
        MediaControlEvent::SetPosition(MediaPosition(p)) => seek_to(engine, p.as_secs_f64()),
        MediaControlEvent::SeekBy(dir, by) => {
            if let Some(e) = engine {
                let now = e.snapshot().position;
                let d = by.as_secs_f64();
                seek_to(engine, if dir == SeekDirection::Forward { now + d } else { (now - d).max(0.0) });
            }
        }
        MediaControlEvent::Seek(dir) => {
            if let Some(e) = engine {
                let now = e.snapshot().position;
                seek_to(engine, if dir == SeekDirection::Forward { now + 10.0 } else { (now - 10.0).max(0.0) });
            }
        }
        _ => {}
    }
}

fn seek_to(engine: Option<&Arc<Engine>>, secs: f64) {
    if let Some(e) = engine {
        let e = e.clone();
        // Opening the file can take a moment; keep it off the main thread.
        std::thread::spawn(move || {
            let _ = e.seek(secs);
        });
    }
}
