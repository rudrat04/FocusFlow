//! Native playback engine: symphonia decoding threads feed per-track ring buffers; a cpal output
//! callback mixes them with equal-power crossfades. All transitions are owned by this engine so
//! they do not depend on the webview's timers.

use std::collections::VecDeque;
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use symphonia::core::audio::sample::Sample as _;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;

use crate::dsp::{Spatial, SpatialMode};

const BUF_SECS: f64 = 4.0;
const QUICK_FADE_SECS: f32 = 0.025;
const MAX_FADING: usize = 4;

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum EngineEvent {
    Tick {
        serial: u64,
        path: Option<String>,
        position: f64,
        duration: f64,
        state: &'static str,
        device: String,
    },
    TrackChanged { serial: u64, path: String, duration: f64 },
    TrackError { path: String, message: String, preload: bool },
    /// The current track ran out and nothing was queued after it.
    Ended { serial: u64 },
    FadeComplete,
    OutputChanged { device: String },
    /// The output device that was playing disappeared (e.g. earbuds disconnected), so playback paused.
    DevicePaused,
}

pub type Emitter = Arc<dyn Fn(EngineEvent) + Send + Sync>;

// ---------------------------------------------------------------- decks

pub struct Deck {
    pub path: String,
    pub duration: f64,
    buf: Mutex<VecDeque<f32>>,
    done: AtomicBool,
    cancel: AtomicBool,
    error: Mutex<Option<String>>,
    error_reported: AtomicBool,
    played: AtomicU64,
    start_frames: u64,
    rate: u32,
}

impl Deck {
    fn position(&self) -> f64 {
        (self.start_frames + self.played.load(Ordering::Relaxed)) as f64 / self.rate as f64
    }
    fn finished(&self) -> bool {
        self.done.load(Ordering::Acquire) && self.buf.lock().map(|b| b.is_empty()).unwrap_or(true)
    }
    fn error(&self) -> Option<String> {
        self.error.lock().ok().and_then(|e| e.clone())
    }
}

impl Drop for Deck {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}

struct Opened {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::audio::AudioDecoder>,
    track_id: u32,
    src_rate: u32,
    frames: Option<u64>,
}

fn open_source(path: &str) -> Result<Opened, String> {
    let file = File::open(path).map_err(|e| format!("cannot open file: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| format!("unsupported or corrupted file: {e}"))?;
    let track = format.default_track(TrackType::Audio).ok_or("no audio track")?;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or("missing audio parameters")?;
    let src_rate = params.sample_rate.ok_or("unknown sample rate")?;
    let frames = track.num_frames;
    let decoder = symphonia::default::get_codecs()
        .make_audio_decoder(params, &AudioDecoderOptions::default())
        .map_err(|e| format!("unsupported codec: {e}"))?;
    let track_id = track.id;
    Ok(Opened { format, decoder, track_id, src_rate, frames })
}

/// Opens a file, starts its decoder thread and returns the deck immediately.
pub fn open_deck(path: &str, start_secs: f64, out_rate: u32, duration_hint: f64) -> Result<Arc<Deck>, String> {
    let mut src = open_source(path)?;
    let duration = match src.frames {
        Some(f) if f > 0 => f as f64 / src.src_rate as f64,
        _ => duration_hint,
    };
    let start = start_secs.max(0.0).min(if duration > 1.0 { duration - 0.5 } else { f64::MAX });
    if start > 0.05 {
        if let Some(t) = Time::try_from_secs_f64(start) {
            let _ = src.format.seek(SeekMode::Accurate, SeekTo::Time { time: t, track_id: Some(src.track_id) });
            src.decoder.reset();
        }
    }
    let deck = Arc::new(Deck {
        path: path.to_string(),
        duration,
        buf: Mutex::new(VecDeque::new()),
        done: AtomicBool::new(false),
        cancel: AtomicBool::new(false),
        error: Mutex::new(None),
        error_reported: AtomicBool::new(false),
        played: AtomicU64::new(0),
        start_frames: (start * out_rate as f64) as u64,
        rate: out_rate,
    });
    let d = Arc::downgrade(&deck);
    std::thread::Builder::new()
        .name("ff-decode".into())
        .spawn(move || decode_loop(d, src, out_rate))
        .map_err(|e| e.to_string())?;
    Ok(deck)
}

struct Resampler {
    ratio: f64, // source frames per output frame
    pos: f64,
    prev: [f32; 2],
    primed: bool,
}

impl Resampler {
    fn new(src: u32, dst: u32) -> Self {
        Self { ratio: src as f64 / dst as f64, pos: 0.0, prev: [0.0; 2], primed: false }
    }
    fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if (self.ratio - 1.0).abs() < 1e-9 {
            out.extend_from_slice(input);
            return;
        }
        let n = input.len() / 2;
        let mut i = 0usize;
        if !self.primed && n > 0 {
            self.prev = [input[0], input[1]];
            self.primed = true;
        }
        // `pos` is the fractional offset between `prev` (index -1) and input[0].
        while i < n {
            let next = [input[i * 2], input[i * 2 + 1]];
            while self.pos < 1.0 {
                let t = self.pos as f32;
                out.push(self.prev[0] + (next[0] - self.prev[0]) * t);
                out.push(self.prev[1] + (next[1] - self.prev[1]) * t);
                self.pos += self.ratio;
            }
            self.pos -= 1.0;
            self.prev = next;
            i += 1;
        }
    }
}

fn decode_loop(deck: std::sync::Weak<Deck>, mut src: Opened, out_rate: u32) {
    let mut resampler = Resampler::new(src.src_rate, out_rate);
    let mut raw: Vec<f32> = Vec::new();
    let mut stereo: Vec<f32> = Vec::new();
    let mut resampled: Vec<f32> = Vec::new();
    let cap = (out_rate as f64 * BUF_SECS) as usize * 2;
    let mut bad_streak = 0u32;
    let mut failure: Option<String> = None;

    'outer: loop {
        {
            let Some(d) = deck.upgrade() else { return };
            if d.cancel.load(Ordering::Acquire) {
                return;
            }
            let len = d.buf.lock().map(|b| b.len()).unwrap_or(cap);
            if len >= cap {
                drop(d);
                // The buffer holds seconds of audio, so checking a few times a second is plenty.
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
        }
        // Weak ref only: a cancelled or dropped deck must not be kept alive by its decoder.
        let Some(d) = deck.upgrade() else { return };
        let packet = match src.format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(SymError::IoError(_)) => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => {
                failure = Some(e.to_string());
                break;
            }
        };
        if packet.track_id != src.track_id {
            continue;
        }
        match src.decoder.decode(&packet) {
            Ok(buf) => {
                bad_streak = 0;
                let ch = buf.spec().channels().count().max(1);
                raw.resize(buf.samples_interleaved(), f32::MID);
                buf.copy_to_slice_interleaved(&mut raw);
                stereo.clear();
                for f in raw.chunks_exact(ch) {
                    match ch {
                        1 => {
                            stereo.push(f[0]);
                            stereo.push(f[0]);
                        }
                        2 => {
                            stereo.push(f[0]);
                            stereo.push(f[1]);
                        }
                        _ => {
                            let c = f[2] * 0.707;
                            stereo.push(f[0] + c);
                            stereo.push(f[1] + c);
                        }
                    }
                }
                resampled.clear();
                resampler.process(&stereo, &mut resampled);
                if let Ok(mut b) = d.buf.lock() {
                    b.extend(resampled.iter().copied());
                }
            }
            Err(SymError::DecodeError(_)) | Err(SymError::IoError(_)) => {
                bad_streak += 1;
                if bad_streak > 200 {
                    failure = Some("too many undecodable packets".into());
                    break 'outer;
                }
            }
            Err(e) => {
                failure = Some(e.to_string());
                break;
            }
        }
    }
    if let Some(d) = deck.upgrade() {
        if let Some(msg) = failure {
            if let Ok(mut e) = d.error.lock() {
                *e = Some(msg);
            }
        }
        d.done.store(true, Ordering::Release);
    }
}

// ---------------------------------------------------------------- mixer

#[derive(Clone, Copy)]
struct Fade {
    pos: u64,
    len: u64,
    out: bool,
}

struct Active {
    deck: Arc<Deck>,
    fade: Option<Fade>,
    scratch: Vec<f32>,
}

impl Active {
    fn new(deck: Arc<Deck>, fade: Option<Fade>) -> Self {
        Self { deck, fade, scratch: Vec::new() }
    }

    /// Pulls up to `frames` frames into `self.scratch[..]` with fade gain applied.
    /// Returns the number of frames produced.
    fn pull(&mut self, frames: usize) -> usize {
        if self.scratch.len() < frames * 2 {
            self.scratch.resize(frames * 2, 0.0);
        }
        let mut got = 0;
        let deck = self.deck.clone();
        if let Ok(mut b) = deck.buf.try_lock() {
            let take = (b.len() / 2).min(frames);
            for i in 0..take {
                let l = b.pop_front().unwrap_or(0.0);
                let r = b.pop_front().unwrap_or(0.0);
                let g = self.gain_step();
                self.scratch[i * 2] = l * g;
                self.scratch[i * 2 + 1] = r * g;
            }
            got = take;
        }
        self.deck.played.fetch_add(got as u64, Ordering::Relaxed);
        got
    }

    fn gain_step(&mut self) -> f32 {
        match &mut self.fade {
            None => 1.0,
            Some(f) => {
                let t = (f.pos as f32 / f.len.max(1) as f32).min(1.0);
                f.pos += 1;
                let a = t * std::f32::consts::FRAC_PI_2;
                if f.out { a.cos() } else { a.sin() }
            }
        }
    }

    fn fade_finished(&self) -> bool {
        matches!(self.fade, Some(f) if f.pos >= f.len)
    }
}

pub struct Mixer {
    pub rate: u32,
    current: Option<Active>,
    fading: Vec<Active>,
    next: Option<Arc<Deck>>,
    paused: bool,
    pause_gain: f32,
    volume: f32,
    vol_smooth: f32,
    muted: bool,
    pub crossfade: f32,
    master_fade: Option<Fade>,
    master_gain: f32,
    pub serial: u64,
    spatial: Spatial,
    pub ended: bool,
    pub fade_complete: bool,
    mixbuf: Vec<f32>,
}

impl Mixer {
    pub fn new(rate: u32) -> Self {
        Self {
            rate,
            current: None,
            fading: Vec::new(),
            next: None,
            paused: false,
            pause_gain: 1.0,
            volume: 0.8,
            vol_smooth: 0.8,
            muted: false,
            crossfade: 3.0,
            master_fade: None,
            master_gain: 1.0,
            serial: 0,
            spatial: Spatial::new(rate),
            ended: false,
            fade_complete: false,
            mixbuf: Vec::new(),
        }
    }

    fn secs_to_frames(&self, s: f32) -> u64 {
        ((s.max(0.0) * self.rate as f32) as u64).max(1)
    }

    /// Replace the current track. `fade_secs` crossfades from whatever is playing.
    pub fn install(&mut self, deck: Arc<Deck>, fade_secs: f32) {
        let secs = if self.current.is_some() { fade_secs.max(QUICK_FADE_SECS) } else { QUICK_FADE_SECS };
        let len = self.secs_to_frames(secs);
        if let Some(mut old) = self.current.take() {
            old.fade = Some(Fade { pos: 0, len, out: true });
            self.fading.push(old);
            while self.fading.len() > MAX_FADING {
                self.fading.remove(0);
            }
        }
        self.current = Some(Active::new(deck, Some(Fade { pos: 0, len, out: false })));
        self.paused = false;
        self.master_fade = None;
        self.master_gain = 1.0;
        self.serial += 1;
    }

    pub fn set_next(&mut self, deck: Option<Arc<Deck>>) {
        self.next = deck;
    }

    pub fn stop(&mut self) {
        let len = self.secs_to_frames(0.08);
        if let Some(mut old) = self.current.take() {
            old.fade = Some(Fade { pos: 0, len, out: true });
            self.fading.push(old);
        }
        self.next = None;
        self.paused = false;
        self.serial += 1;
    }

    pub fn set_paused(&mut self, p: bool) {
        self.paused = p;
    }

    pub fn fade_out_and_stop(&mut self, secs: f32) {
        let len = self.secs_to_frames(secs);
        self.master_fade = Some(Fade { pos: 0, len, out: true });
    }

    pub fn cancel_master_fade(&mut self) {
        self.master_fade = None;
        self.master_gain = 1.0;
    }

    pub fn state(&self) -> &'static str {
        if self.current.is_none() {
            "stopped"
        } else if self.paused {
            "paused"
        } else {
            "playing"
        }
    }

    fn finish_current(&mut self) {
        self.current = None;
        if let Some(n) = self.next.take() {
            self.current = Some(Active::new(n, None));
            self.serial += 1;
        }
    }

    /// Starts a crossfade when the current track nears its end. Called from the engine thread.
    pub fn tick(&mut self) {
        let Some(cur) = self.current.as_ref() else { return };
        if self.next.is_none() || self.paused || matches!(cur.fade, Some(f) if f.out) {
            return;
        }
        let dur = cur.deck.duration;
        if dur <= 0.0 {
            return;
        }
        let cf = (self.crossfade as f64).min(dur / 2.0);
        let remaining = dur - cur.deck.position();
        if cf >= 0.25 && remaining <= cf {
            let len = self.secs_to_frames(remaining.clamp(0.25, cf) as f32);
            if let (Some(mut old), Some(n)) = (self.current.take(), self.next.take()) {
                old.fade = Some(Fade { pos: 0, len, out: true });
                self.fading.push(old);
                self.current = Some(Active::new(n, Some(Fade { pos: 0, len, out: false })));
                self.serial += 1;
            }
        }
    }

    pub fn position(&self) -> (Option<String>, f64, f64) {
        match &self.current {
            Some(a) => (Some(a.deck.path.clone()), a.deck.position(), a.deck.duration),
            None => (None, 0.0, 0.0),
        }
    }

    pub fn take_errors(&mut self) -> Vec<(String, String, bool)> {
        let mut v = Vec::new();
        let mut check = |d: &Arc<Deck>, preload: bool| {
            if let Some(e) = d.error() {
                if !d.error_reported.swap(true, Ordering::Relaxed) {
                    v.push((d.path.clone(), e, preload));
                }
            }
        };
        if let Some(c) = &self.current {
            check(&c.deck, false);
        }
        if let Some(n) = &self.next {
            check(n, true);
        }
        v
    }

    /// Everything needed to resume the same audio at another output sample rate.
    fn snapshot(&self) -> (Option<(String, f64, f64)>, Option<(String, f64)>, bool) {
        (
            self.current.as_ref().map(|a| (a.deck.path.clone(), a.deck.position(), a.deck.duration)),
            self.next.as_ref().map(|d| (d.path.clone(), d.duration)),
            self.paused,
        )
    }

    fn reset_for_rate(&mut self, rate: u32) {
        self.rate = rate;
        self.current = None;
        self.fading.clear();
        self.next = None;
        self.spatial = Spatial::new(rate);
    }

    /// Render interleaved stereo.
    pub fn render(&mut self, out: &mut [f32]) {
        let frames = out.len() / 2;
        if frames == 0 {
            return;
        }
        if self.paused && self.pause_gain <= 0.0 {
            out.fill(0.0);
            return;
        }
        self.mixbuf.resize(frames * 2, 0.0);
        self.mixbuf.fill(0.0);

        // Current track; when it runs dry the preloaded next track continues in the same buffer.
        let mut got = 0;
        while got < frames {
            let Some(act) = self.current.as_mut() else { break };
            let n = act.pull(frames - got);
            for i in 0..n * 2 {
                self.mixbuf[got * 2 + i] += act.scratch[i];
            }
            got += n;
            if matches!(act.fade, Some(f) if !f.out && f.pos >= f.len) {
                act.fade = None;
            }
            if got >= frames {
                break;
            }
            if act.deck.finished() {
                if self.next.is_none() {
                    self.ended = true;
                }
                self.finish_current();
            } else {
                break; // underrun: decoder hasn't caught up yet
            }
        }

        for f in self.fading.iter_mut() {
            let n = f.pull(frames);
            for i in 0..n * 2 {
                self.mixbuf[i] += f.scratch[i];
            }
        }
        self.fading.retain(|f| !f.fade_finished() && !f.deck.finished());

        // Master stage.
        let pg_step = 1.0 / (0.04 * self.rate as f32);
        let vol_target = if self.muted { 0.0 } else { self.volume };
        let vol_coef = 1.0 - (-1.0 / (0.03 * self.rate as f32)).exp();
        let mut master_done = false;
        for i in 0..frames {
            if self.paused {
                self.pause_gain = (self.pause_gain - pg_step).max(0.0);
            } else if self.pause_gain < 1.0 {
                self.pause_gain = (self.pause_gain + pg_step).min(1.0);
            }
            self.vol_smooth += (vol_target - self.vol_smooth) * vol_coef;
            if let Some(f) = &mut self.master_fade {
                let t = (f.pos as f32 / f.len as f32).min(1.0);
                self.master_gain = (t * std::f32::consts::FRAC_PI_2).cos();
                f.pos += 1;
                if f.pos >= f.len {
                    master_done = true;
                }
            }
            let g = self.vol_smooth * self.pause_gain * self.master_gain;
            let (l, r) = self.spatial.process(self.mixbuf[i * 2], self.mixbuf[i * 2 + 1]);
            out[i * 2] = soft_limit(l * g);
            out[i * 2 + 1] = soft_limit(r * g);
        }
        if master_done {
            self.master_fade = None;
            self.master_gain = 1.0;
            self.fading.clear();
            self.current = None;
            self.next = None;
            self.serial += 1;
            self.fade_complete = true;
        }
    }
}

fn soft_limit(x: f32) -> f32 {
    let a = x.abs();
    if a <= 0.9 {
        x
    } else {
        x.signum() * (0.9 + 0.1 * ((a - 0.9) / 0.1).tanh())
    }
}

// ---------------------------------------------------------------- engine

pub struct Shared {
    pub mixer: Mutex<Mixer>,
    rate: AtomicU32,
    emit: Emitter,
    shutdown: AtomicBool,
    rebuild: AtomicBool,
    device: Mutex<String>,
    channels: AtomicU32,
    /// False while the window is hidden: progress updates are then sent far less often.
    ui_active: AtomicBool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayInfo {
    pub serial: u64,
    pub duration: f64,
}

pub struct Snapshot {
    pub state: &'static str,
    pub position: f64,
}

pub struct Engine {
    shared: Arc<Shared>,
}

impl Engine {
    pub fn start(emit: Emitter) -> Result<Engine, String> {
        let shared = Arc::new(Shared {
            mixer: Mutex::new(Mixer::new(48_000)),
            rate: AtomicU32::new(48_000),
            emit,
            shutdown: AtomicBool::new(false),
            rebuild: AtomicBool::new(false),
            device: Mutex::new(String::new()),
            channels: AtomicU32::new(2),
            ui_active: AtomicBool::new(true),
        });
        let (tx, rx) = std::sync::mpsc::channel();
        let s2 = shared.clone();
        std::thread::Builder::new()
            .name("ff-engine".into())
            .spawn(move || engine_thread(s2, tx))
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(8)).map_err(|_| "audio engine did not start".to_string())??;
        Ok(Engine { shared })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Mixer> {
        self.shared.mixer.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self) -> Snapshot {
        let m = self.lock();
        let (_, position, _) = m.position();
        Snapshot { state: m.state(), position }
    }

    /// Channels of the current output device. 1 means mono (e.g. a Bluetooth headset in call mode).
    pub fn channels(&self) -> u32 {
        self.shared.channels.load(Ordering::Relaxed)
    }

    pub fn set_ui_active(&self, active: bool) {
        self.shared.ui_active.store(active, Ordering::Relaxed);
    }

    pub fn device(&self) -> String {
        self.shared.device.lock().map(|d| d.clone()).unwrap_or_default()
    }

    pub fn play(&self, path: &str, start: f64, fade_secs: f32, duration_hint: f64) -> Result<PlayInfo, String> {
        let rate = self.shared.rate.load(Ordering::Relaxed);
        let deck = open_deck(path, start, rate, duration_hint)?;
        let duration = deck.duration;
        let mut m = self.lock();
        if m.rate != rate {
            return Err("audio output changed, try again".into());
        }
        m.install(deck, fade_secs);
        Ok(PlayInfo { serial: m.serial, duration })
    }

    /// Loads (but does not play) the track that follows the current one.
    pub fn set_next(&self, path: Option<&str>, duration_hint: f64) -> Result<(), String> {
        let deck = match path {
            Some(p) => {
                let rate = self.shared.rate.load(Ordering::Relaxed);
                Some(open_deck(p, 0.0, rate, duration_hint)?)
            }
            None => None,
        };
        self.lock().set_next(deck);
        Ok(())
    }

    pub fn pause(&self) {
        self.lock().set_paused(true);
    }

    pub fn resume(&self) {
        let mut m = self.lock();
        m.cancel_master_fade();
        m.set_paused(false);
    }

    pub fn stop(&self) {
        self.lock().stop();
    }

    pub fn seek(&self, secs: f64) -> Result<(), String> {
        let (path, dur, paused) = {
            let m = self.lock();
            match m.position() {
                (Some(p), _, d) => (p, d, m.state() == "paused"),
                _ => return Ok(()),
            }
        };
        let rate = self.shared.rate.load(Ordering::Relaxed);
        let deck = open_deck(&path, secs, rate, dur)?;
        let mut m = self.lock();
        m.install(deck, QUICK_FADE_SECS);
        m.set_paused(paused);
        Ok(())
    }

    pub fn set_volume(&self, v: f32, muted: bool) {
        let mut m = self.lock();
        m.volume = v.clamp(0.0, 1.0);
        m.muted = muted;
    }

    pub fn set_crossfade(&self, secs: f32) {
        self.lock().crossfade = secs.clamp(0.0, 12.0);
    }

    pub fn set_spatial(&self, mode: &str, amount: f32) {
        self.lock().spatial.set(SpatialMode::parse(mode), amount);
    }

    pub fn fade_out_and_stop(&self, secs: f32) {
        self.lock().fade_out_and_stop(secs);
    }

    pub fn cancel_fade(&self) {
        self.lock().cancel_master_fade();
    }

    pub fn shutdown(&self) {
        self.shared.shutdown.store(true, Ordering::Release);
    }
}

fn device_id(device: &cpal::Device) -> String {
    use cpal::traits::DeviceTrait;
    device.id().map(|i| i.to_string()).unwrap_or_else(|_| "unknown".into())
}

fn device_exists(name: &str) -> bool {
    use cpal::traits::HostTrait;
    cpal::default_host().output_devices().map(|mut it| it.any(|d| device_id(&d) == name)).unwrap_or(true)
}

fn build_stream(shared: &Arc<Shared>) -> Result<(cpal::Stream, String, u32), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("no audio output device")?;
    let name = device_id(&device);
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    let rate = config.sample_rate();
    let format = config.sample_format();
    let cfg: cpal::StreamConfig = config.into();
    let channels = cfg.channels as usize;
    shared.channels.store(channels as u32, Ordering::Relaxed);

    fn build<T>(
        device: &cpal::Device,
        cfg: cpal::StreamConfig,
        channels: usize,
        shared: Arc<Shared>,
    ) -> Result<cpal::Stream, String>
    where
        T: cpal::SizedSample + cpal::FromSample<f32>,
    {
        use cpal::traits::DeviceTrait;
        let sh = shared.clone();
        let mut tmp: Vec<f32> = Vec::new();
        let err_shared = shared;
        device
            .build_output_stream(
                cfg,
                move |data: &mut [T], _| {
                    let frames = data.len() / channels;
                    tmp.resize(frames * 2, 0.0);
                    match sh.mixer.lock() {
                        Ok(mut m) => m.render(&mut tmp),
                        Err(_) => tmp.fill(0.0),
                    }
                    for (i, frame) in data.chunks_mut(channels).enumerate() {
                        let (l, r) = (tmp[i * 2], tmp[i * 2 + 1]);
                        for (c, s) in frame.iter_mut().enumerate() {
                            let v = match (channels, c) {
                                (1, _) => (l + r) * 0.5,
                                (_, 0) => l,
                                (_, 1) => r,
                                _ => 0.0,
                            };
                            *s = T::from_sample(v);
                        }
                    }
                },
                move |err: cpal::Error| {
                    if !matches!(err.kind(), cpal::ErrorKind::Xrun | cpal::ErrorKind::RealtimeDenied) {
                        err_shared.rebuild.store(true, Ordering::Release);
                    }
                },
                None,
            )
            .map_err(|e| e.to_string())
    }

    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, cfg, channels, shared.clone())?,
        cpal::SampleFormat::I16 => build::<i16>(&device, cfg, channels, shared.clone())?,
        cpal::SampleFormat::I32 => build::<i32>(&device, cfg, channels, shared.clone())?,
        other => return Err(format!("unsupported output sample format {other}")),
    };
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, name, rate))
}

fn engine_thread(shared: Arc<Shared>, init: std::sync::mpsc::Sender<Result<(), String>>) {
    let mut init = Some(init);
    let mut stream: Option<cpal::Stream> = None;
    let mut last_check = Instant::now();
    let mut last_tick = Instant::now() - Duration::from_secs(1);
    let mut last_serial = 0u64;
    let mut first = true;

    loop {
        if shared.shutdown.load(Ordering::Acquire) {
            break;
        }
        if stream.is_none() || shared.rebuild.swap(false, Ordering::AcqRel) {
            let old_name = shared.device.lock().map(|d| d.clone()).unwrap_or_default();
            // If the device that was playing has vanished (earbuds disconnected, cable pulled) we
            // pause instead of suddenly blasting the music out of the speakers.
            let lost = !first && !old_name.is_empty() && !device_exists(&old_name);
            stream = None;
            match build_stream(&shared) {
                Ok((s, name, rate)) => {
                    let old = shared.rate.swap(rate, Ordering::AcqRel);
                    *shared.device.lock().unwrap() = name.clone();
                    if !first {
                        (shared.emit)(EngineEvent::OutputChanged { device: name });
                    }
                    if rate != old {
                        resume_at_new_rate(&shared, rate);
                    }
                    if lost {
                        let mut m = shared.mixer.lock().unwrap_or_else(|e| e.into_inner());
                        if m.state() == "playing" {
                            m.set_paused(true);
                            drop(m);
                            (shared.emit)(EngineEvent::DevicePaused);
                        }
                    }
                    stream = Some(s);
                    first = false;
                    if let Some(tx) = init.take() {
                        let _ = tx.send(Ok(()));
                    }
                }
                Err(e) => {
                    if let Some(tx) = init.take() {
                        let _ = tx.send(Err(e));
                        return;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }
            }
        }
        // Crossfade starts and device changes do not need finer timing than this.
        std::thread::sleep(Duration::from_millis(200));

        if last_check.elapsed() > Duration::from_secs(1) {
            last_check = Instant::now();
            use cpal::traits::HostTrait;
            if let Some(d) = cpal::default_host().default_output_device() {
                let now = device_id(&d);
                if now != *shared.device.lock().unwrap() {
                    shared.rebuild.store(true, Ordering::Release);
                }
            }
        }

        let (events, state_snapshot) = {
            let mut m = shared.mixer.lock().unwrap_or_else(|e| e.into_inner());
            m.tick();
            let mut ev = Vec::new();
            for (path, message, preload) in m.take_errors() {
                ev.push(EngineEvent::TrackError { path, message, preload });
            }
            let (path, position, duration) = m.position();
            if m.serial != last_serial {
                last_serial = m.serial;
                if let Some(p) = &path {
                    ev.push(EngineEvent::TrackChanged { serial: m.serial, path: p.clone(), duration });
                }
            }
            if m.ended {
                m.ended = false;
                ev.push(EngineEvent::Ended { serial: m.serial });
            }
            if m.fade_complete {
                m.fade_complete = false;
                ev.push(EngineEvent::FadeComplete);
            }
            (ev, (m.serial, path, position, duration, m.state()))
        };
        for e in events {
            (shared.emit)(e);
        }
        let tick_every = if shared.ui_active.load(Ordering::Relaxed) { Duration::from_millis(500) } else { Duration::from_secs(3) };
        if last_tick.elapsed() >= tick_every {
            last_tick = Instant::now();
            let (serial, path, position, duration, state) = state_snapshot;
            let device = shared.device.lock().map(|d| d.clone()).unwrap_or_default();
            (shared.emit)(EngineEvent::Tick { serial, path, position, duration, state, device });
        }
    }
    drop(stream);
}

fn resume_at_new_rate(shared: &Arc<Shared>, rate: u32) {
    let (cur, next, paused) = {
        let mut m = shared.mixer.lock().unwrap_or_else(|e| e.into_inner());
        let snap = m.snapshot();
        m.reset_for_rate(rate);
        snap
    };
    if let Some((path, pos, dur)) = cur {
        if let Ok(deck) = open_deck(&path, pos, rate, dur) {
            let mut m = shared.mixer.lock().unwrap_or_else(|e| e.into_inner());
            m.install(deck, QUICK_FADE_SECS);
            m.set_paused(paused);
            if let Some((np, nd)) = next {
                drop(m);
                if let Ok(d) = open_deck(&np, 0.0, rate, nd) {
                    shared.mixer.lock().unwrap_or_else(|e| e.into_inner()).set_next(Some(d));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Writes a 16-bit stereo PCM WAV with a sine (or constant when `freq` is 0) of the given length.
    fn write_wav(path: &Path, secs: f64, rate: u32, freq: f64, amp: f64) {
        let n = (secs * rate as f64) as u32;
        let mut f = File::create(path).unwrap();
        let data_len = n * 4;
        f.write_all(b"RIFF").unwrap();
        f.write_all(&(36 + data_len).to_le_bytes()).unwrap();
        f.write_all(b"WAVEfmt ").unwrap();
        f.write_all(&16u32.to_le_bytes()).unwrap();
        f.write_all(&1u16.to_le_bytes()).unwrap();
        f.write_all(&2u16.to_le_bytes()).unwrap();
        f.write_all(&rate.to_le_bytes()).unwrap();
        f.write_all(&(rate * 4).to_le_bytes()).unwrap();
        f.write_all(&4u16.to_le_bytes()).unwrap();
        f.write_all(&16u16.to_le_bytes()).unwrap();
        f.write_all(b"data").unwrap();
        f.write_all(&data_len.to_le_bytes()).unwrap();
        for i in 0..n {
            let v = if freq == 0.0 { amp } else { amp * (2.0 * std::f64::consts::PI * freq * i as f64 / rate as f64).sin() };
            let s = (v * 32767.0) as i16;
            f.write_all(&s.to_le_bytes()).unwrap();
            f.write_all(&s.to_le_bytes()).unwrap();
        }
    }

    fn wait_buffered(d: &Arc<Deck>, frames: usize) {
        for _ in 0..200 {
            if d.buf.lock().unwrap().len() / 2 >= frames || d.done.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn render_secs(m: &mut Mixer, secs: f64) -> Vec<f32> {
        let mut all = Vec::new();
        let frames = (secs * m.rate as f64) as usize;
        let mut done = 0;
        while done < frames {
            let n = 512.min(frames - done);
            let mut buf = vec![0.0; n * 2];
            m.render(&mut buf);
            all.extend(buf);
            done += n;
            std::thread::sleep(Duration::from_millis(1));
        }
        all
    }

    #[test]
    fn missing_file_is_an_error() {
        assert!(open_deck("/definitely/not/here.mp3", 0.0, 44100, 0.0).is_err());
    }

    #[test]
    fn corrupt_file_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bad.mp3");
        std::fs::write(&p, vec![0x13u8; 4096]).unwrap();
        let r = open_deck(p.to_str().unwrap(), 0.0, 44100, 0.0);
        if let Ok(d) = r {
            std::thread::sleep(Duration::from_millis(200));
            assert!(d.buf.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn gapless_promotion_has_no_silent_gap_and_bumps_serial() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a.wav"), dir.path().join("b.wav"));
        write_wav(&a, 1.0, 44100, 440.0, 0.5);
        write_wav(&b, 1.0, 44100, 440.0, 0.5);
        let da = open_deck(a.to_str().unwrap(), 0.0, 44100, 0.0).unwrap();
        let db = open_deck(b.to_str().unwrap(), 0.0, 44100, 0.0).unwrap();
        wait_buffered(&da, 44100);
        wait_buffered(&db, 44100);
        let mut m = Mixer::new(44100);
        m.crossfade = 0.0;
        m.volume = 1.0;
        m.vol_smooth = 1.0;
        m.install(da, 0.0);
        m.set_next(Some(db));
        let s0 = m.serial;
        let out = render_secs(&mut m, 1.6);
        assert!(m.serial > s0, "next track should have been promoted");
        // After the 25 ms fade-in, a 440 Hz sine never stays near zero for long.
        let mut run = 0;
        let mut longest = 0;
        for f in out.chunks(2).skip(2000).take(60000) {
            if f[0].abs() < 1e-4 { run += 1; longest = longest.max(run); } else { run = 0; }
        }
        assert!(longest < 20, "gap of {longest} silent frames");
    }

    #[test]
    fn crossfade_is_bounded_and_serial_changes_once() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a.wav"), dir.path().join("b.wav"));
        write_wav(&a, 3.0, 44100, 0.0, 0.5);
        write_wav(&b, 3.0, 44100, 0.0, 0.5);
        let da = open_deck(a.to_str().unwrap(), 0.0, 44100, 0.0).unwrap();
        let db = open_deck(b.to_str().unwrap(), 0.0, 44100, 0.0).unwrap();
        wait_buffered(&da, 44100);
        wait_buffered(&db, 44100);
        let mut m = Mixer::new(44100);
        m.crossfade = 1.0;
        m.volume = 1.0;
        m.vol_smooth = 1.0;
        m.install(da, 0.0);
        m.set_next(Some(db));
        let s0 = m.serial;
        let mut peak = 0.0f32;
        for _ in 0..40 {
            let out = render_secs(&mut m, 0.1);
            m.tick();
            for v in out { peak = peak.max(v.abs()); }
        }
        assert_eq!(m.serial, s0 + 1, "exactly one transition");
        assert!(peak <= 0.5 * 1.42 + 0.01 && peak > 0.4, "peak {peak}");
    }

    #[test]
    fn pause_consumes_nothing_and_resumes() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.wav");
        write_wav(&a, 2.0, 44100, 440.0, 0.5);
        let da = open_deck(a.to_str().unwrap(), 0.0, 44100, 0.0).unwrap();
        wait_buffered(&da, 44100);
        let mut m = Mixer::new(44100);
        m.install(da, 0.0);
        render_secs(&mut m, 0.2);
        m.set_paused(true);
        render_secs(&mut m, 0.2);
        let pos = m.position().1;
        render_secs(&mut m, 0.5);
        assert!((m.position().1 - pos).abs() < 1e-6);
        m.set_paused(false);
        render_secs(&mut m, 0.2);
        assert!(m.position().1 > pos);
    }

    #[test]
    fn single_track_with_no_next_ends_once() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.wav");
        write_wav(&a, 0.3, 44100, 440.0, 0.5);
        let da = open_deck(a.to_str().unwrap(), 0.0, 44100, 0.0).unwrap();
        wait_buffered(&da, 44100);
        let mut m = Mixer::new(44100);
        m.install(da, 0.0);
        render_secs(&mut m, 0.8);
        assert!(m.ended);
        assert_eq!(m.state(), "stopped");
    }

    #[test]
    fn seek_start_offsets_position() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.wav");
        write_wav(&a, 4.0, 44100, 440.0, 0.5);
        let da = open_deck(a.to_str().unwrap(), 2.0, 44100, 0.0).unwrap();
        assert!((da.position() - 2.0).abs() < 0.1);
    }

    // ------------------------------------------------------------------
    // Integration tests against real files and the real output device.
    // Run with: FOCUSFLOW_TEST_MEDIA=/dir/with/tone_a.mp3,... cargo test -- --ignored --nocapture

    fn media_dir() -> Option<std::path::PathBuf> {
        std::env::var_os("FOCUSFLOW_TEST_MEDIA").map(Into::into)
    }

    #[test]
    #[ignore]
    fn decodes_mp3_m4a_flac_wav_and_resamples() {
        let Some(dir) = media_dir() else { return };
        for name in ["tone_a.mp3", "tone_b.m4a", "tone_c.flac", "tone_d.wav", "mono48.mp3"] {
            let p = dir.join(name);
            for rate in [44100u32, 48000] {
                let d = open_deck(p.to_str().unwrap(), 0.0, rate, 0.0).unwrap_or_else(|e| panic!("{name}: {e}"));
                wait_buffered(&d, rate as usize * 3);
                let (n, peak) = {
                    let b = d.buf.lock().unwrap();
                    (b.len() / 2, b.iter().fold(0.0f32, |m, v| m.max(v.abs())))
                };
                assert!(n >= rate as usize, "{name}@{rate}: only {n} frames decoded");
                println!("{name}@{rate}: frames={n} peak={peak:.4} duration={:.2}", d.duration);
                // Peak levels measured independently with ffmpeg's astats; we must agree within 8%
                // (a little lower is expected after linear resampling).
                let expect_db = match name { "tone_a.mp3" => -31.97, "tone_b.m4a" => -30.31, "tone_c.flac" => -31.53, "tone_d.wav" => -31.53, _ => -28.79 };
                let expect = 10f32.powf(expect_db / 20.0);
                assert!((peak / expect - 1.0).abs() < 0.08, "{name}@{rate}: peak {peak}, expected about {expect}");
                assert!((d.duration - if name.starts_with("mono") { 5.0 } else { 6.0 }).abs() < 0.2, "{name}: duration {}", d.duration);
            }
        }
        println!("all formats decoded at 44.1k and 48k");
    }

    #[test]
    #[ignore]
    fn real_device_plays_crossfades_and_reports_events() {
        let Some(dir) = media_dir() else { return };
        let events: Arc<Mutex<Vec<EngineEvent>>> = Arc::default();
        let sink = events.clone();
        let engine = Engine::start(Arc::new(move |e| sink.lock().unwrap().push(e))).expect("engine should start on this Mac");
        engine.set_volume(0.05, false);
        engine.set_crossfade(1.5);
        let a = dir.join("tone_a.mp3");
        let b = dir.join("tone_b.m4a");
        let info = engine.play(a.to_str().unwrap(), 0.0, 0.0, 0.0).unwrap();
        assert!((info.duration - 6.0).abs() < 0.2);
        engine.set_next(Some(b.to_str().unwrap()), 0.0).unwrap();
        // Track A is 6 s with a 1.5 s crossfade: B takes over at about 4.5 s.
        std::thread::sleep(Duration::from_secs(8));
        let evs = events.lock().unwrap().clone();
        let changed: Vec<_> = evs.iter().filter_map(|e| match e { EngineEvent::TrackChanged { path, .. } => Some(path.clone()), _ => None }).collect();
        println!("device: {}", engine.device());
        println!("trackChanged: {changed:?}");
        assert!(changed.iter().any(|p| p.ends_with("tone_b.m4a")), "B never became current: {changed:?}");
        let positions: Vec<f64> = evs.iter().filter_map(|e| match e { EngineEvent::Tick { path: Some(p), position, .. } if p.ends_with("tone_a.mp3") => Some(*position), _ => None }).collect();
        assert!(positions.windows(2).all(|w| w[1] >= w[0]), "positions must advance: {positions:?}");
        assert!(positions.len() >= 8);
        // B has 6 s and nothing follows: it must end exactly once.
        std::thread::sleep(Duration::from_secs(4));
        let ended = events.lock().unwrap().iter().filter(|e| matches!(e, EngineEvent::Ended { .. })).count();
        assert_eq!(ended, 1, "expected exactly one Ended event");
        engine.shutdown();
    }

    #[test]
    #[ignore]
    fn real_device_rapid_skips_and_pause_do_not_overlap() {
        let Some(dir) = media_dir() else { return };
        let engine = Engine::start(Arc::new(|_| {})).expect("engine");
        engine.set_volume(0.05, false);
        let files = ["tone_a.mp3", "tone_b.m4a", "tone_c.flac", "tone_d.wav"];
        for i in 0..40 {
            let f = dir.join(files[i % files.len()]);
            engine.play(f.to_str().unwrap(), 0.0, 0.35, 0.0).unwrap();
            if i % 7 == 0 { engine.seek(1.0).unwrap(); }
            std::thread::sleep(Duration::from_millis(30));
        }
        engine.pause();
        std::thread::sleep(Duration::from_millis(300));
        let m = engine.lock();
        assert_eq!(m.state(), "paused");
        assert!(m.fading.len() <= MAX_FADING);
        drop(m);
        engine.resume();
        std::thread::sleep(Duration::from_millis(500));
        assert_eq!(engine.lock().state(), "playing");
        engine.stop();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(engine.lock().state(), "stopped");
        engine.shutdown();
    }
}
