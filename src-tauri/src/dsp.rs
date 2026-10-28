//! Headphone spatializer: stereo widening + crossfeed, a soft virtual room, and a slow orbit.
//! These are lightweight approximations, not measured HRTF convolution.

use std::f32::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpatialMode {
    Off,
    Wide,
    Room,
    Orbit,
}

impl SpatialMode {
    pub fn parse(s: &str) -> Self {
        match s {
            "wide" => Self::Wide,
            "room" => Self::Room,
            "orbit" => Self::Orbit,
            _ => Self::Off,
        }
    }
}

struct Comb {
    buf: Vec<f32>,
    idx: usize,
    store: f32,
}

impl Comb {
    fn new(n: usize) -> Self {
        Self { buf: vec![0.0; n.max(1)], idx: 0, store: 0.0 }
    }
    fn process(&mut self, x: f32, fb: f32, damp: f32) -> f32 {
        let out = self.buf[self.idx];
        self.store = out * (1.0 - damp) + self.store * damp;
        self.buf[self.idx] = x + self.store * fb;
        self.idx = (self.idx + 1) % self.buf.len();
        out
    }
}

struct Allpass {
    buf: Vec<f32>,
    idx: usize,
}

impl Allpass {
    fn new(n: usize) -> Self {
        Self { buf: vec![0.0; n.max(1)], idx: 0 }
    }
    fn process(&mut self, x: f32) -> f32 {
        let b = self.buf[self.idx];
        let out = -x + b;
        self.buf[self.idx] = x + b * 0.5;
        self.idx = (self.idx + 1) % self.buf.len();
        out
    }
}

struct Reverb {
    combs_l: Vec<Comb>,
    combs_r: Vec<Comb>,
    all_l: Vec<Allpass>,
    all_r: Vec<Allpass>,
}

const COMB_TUNING: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING: [usize; 4] = [556, 441, 341, 225];
const STEREO_SPREAD: usize = 23;

impl Reverb {
    fn new(rate: u32) -> Self {
        let k = rate as f32 / 44100.0;
        let s = |n: usize| ((n as f32) * k) as usize;
        Self {
            combs_l: COMB_TUNING.iter().map(|&n| Comb::new(s(n))).collect(),
            combs_r: COMB_TUNING.iter().map(|&n| Comb::new(s(n + STEREO_SPREAD))).collect(),
            all_l: ALLPASS_TUNING.iter().map(|&n| Allpass::new(s(n))).collect(),
            all_r: ALLPASS_TUNING.iter().map(|&n| Allpass::new(s(n + STEREO_SPREAD))).collect(),
        }
    }

    fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        let input = (l + r) * 0.015;
        let (mut ol, mut or) = (0.0, 0.0);
        for c in &mut self.combs_l {
            ol += c.process(input, 0.84, 0.25);
        }
        for c in &mut self.combs_r {
            or += c.process(input, 0.84, 0.25);
        }
        for a in &mut self.all_l {
            ol = a.process(ol);
        }
        for a in &mut self.all_r {
            or = a.process(or);
        }
        (ol, or)
    }
}

const DELAY_LEN: usize = 8192;

struct Delay {
    buf: Vec<f32>,
    w: usize,
}

impl Delay {
    fn new() -> Self {
        Self { buf: vec![0.0; DELAY_LEN], w: 0 }
    }
    fn push(&mut self, x: f32) {
        self.buf[self.w] = x;
        self.w = (self.w + 1) % DELAY_LEN;
    }
    fn tap(&self, d: usize) -> f32 {
        self.buf[(self.w + DELAY_LEN - 1 - d.min(DELAY_LEN - 1)) % DELAY_LEN]
    }
}

struct OnePole(f32);
impl OnePole {
    fn run(&mut self, x: f32, k: f32) -> f32 {
        self.0 += k * (x - self.0);
        self.0
    }
}

/// Headphone spatializer. Three clearly audible modes; all are lightweight approximations
/// (interaural delay/level, head-shadow filtering, early reflections, reverb), not measured HRTFs.
pub struct Spatial {
    rate: f32,
    mode: SpatialMode,
    amount: f32,
    mix: f32,
    reverb: Reverb,
    dl: Delay,
    dr: Delay,
    dm: Delay,
    er_l: Delay,
    er_r: Delay,
    mono: Delay,
    lp_xl: OnePole,
    lp_xr: OnePole,
    lp_far: OnePole,
    lp_back: OnePole,
    phase: f32,
}

impl Spatial {
    pub fn new(rate: u32) -> Self {
        Self {
            rate: rate as f32,
            mode: SpatialMode::Off,
            amount: 0.7,
            mix: 0.0,
            reverb: Reverb::new(rate),
            dl: Delay::new(),
            dr: Delay::new(),
            dm: Delay::new(),
            er_l: Delay::new(),
            er_r: Delay::new(),
            mono: Delay::new(),
            lp_xl: OnePole(0.0),
            lp_xr: OnePole(0.0),
            lp_far: OnePole(0.0),
            lp_back: OnePole(0.0),
            phase: 0.0,
        }
    }

    pub fn set(&mut self, mode: SpatialMode, amount: f32) {
        self.amount = amount.clamp(0.0, 1.0);
        self.mode = mode;
    }

    fn ms(&self, ms: f32) -> usize {
        ((ms * 0.001 * self.rate) as usize).clamp(1, DELAY_LEN - 2)
    }

    fn k(&self, hz: f32) -> f32 {
        (2.0 * PI * hz / self.rate).min(1.0)
    }

    /// Process one stereo frame.
    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        let target = if self.mode == SpatialMode::Off { 0.0 } else { 1.0 };
        self.mix += (target - self.mix) * 0.0008;
        if self.mix < 0.0005 && self.mode == SpatialMode::Off {
            return (l, r);
        }
        let (wl, wr) = match self.mode {
            SpatialMode::Off | SpatialMode::Wide => self.wide(l, r),
            SpatialMode::Room => self.room(l, r),
            SpatialMode::Orbit => self.orbit(l, r),
        };
        (l + (wl - l) * self.mix, r + (wr - r) * self.mix)
    }

    /// Wide stage: strong stereo widening, with a delayed copy of the centre pushed to opposite
    /// sides so even near-mono music opens up, plus a little crossfeed to keep it comfortable.
    fn wide(&mut self, l: f32, r: f32) -> (f32, f32) {
        let a = self.amount;
        let m = (l + r) * 0.5;
        let s = (l - r) * 0.5;
        self.dm.push(m);
        let md = self.dm.tap(self.ms(13.0));
        let g = 1.0 + 3.4 * a;
        let side = s * g + a * 0.95 * md;
        let (wl, wr) = (m + side, m - side);
        self.dl.push(wl);
        self.dr.push(wr);
        let d = self.ms(0.3);
        let k = self.k(900.0);
        let cl = self.lp_xl.run(self.dr.tap(d), k);
        let cr = self.lp_xr.run(self.dl.tap(d), k);
        let cf = 0.22 * a;
        let norm = 1.0 / (1.0 + 0.7 * a);
        ((wl + cf * cl) * norm, (wr + cf * cr) * norm)
    }

    /// Surround room: the left and right channels become two virtual speakers in a room, heard
    /// with head-shadow crossfeed, early reflections and a reverb tail.
    fn room(&mut self, l: f32, r: f32) -> (f32, f32) {
        let a = self.amount;
        self.dl.push(l);
        self.dr.push(r);
        let d = self.ms(0.35);
        let k = self.k(1400.0);
        let xl = self.lp_xl.run(self.dr.tap(d), k);
        let xr = self.lp_xr.run(self.dl.tap(d), k);
        let bl = l + 0.7 * a * xl;
        let br = r + 0.7 * a * xr;
        self.er_l.push(bl);
        self.er_r.push(br);
        let er_l = 0.36 * self.er_l.tap(self.ms(9.0)) + 0.26 * self.er_r.tap(self.ms(17.0)) + 0.18 * self.er_l.tap(self.ms(29.0)) + 0.12 * self.er_r.tap(self.ms(41.0));
        let er_r = 0.36 * self.er_r.tap(self.ms(10.0)) + 0.26 * self.er_l.tap(self.ms(19.0)) + 0.18 * self.er_r.tap(self.ms(31.0)) + 0.12 * self.er_l.tap(self.ms(43.0));
        let (rl, rr) = self.reverb.process(bl, br);
        let wet = 0.35 + 1.0 * a;
        let dry = 1.0 - 0.15 * a;
        (bl * dry + a * er_l * 0.9 + rl * wet * 2.6, br * dry + a * er_r * 0.9 + rr * wet * 2.6)
    }

    /// Orbit: the centre of the mix circles the head (about one lap every 10 s) with interaural
    /// delay, head-shadow filtering, a darker "behind you" and a touch of reverb for depth.
    fn orbit(&mut self, l: f32, r: f32) -> (f32, f32) {
        self.phase += 2.0 * PI / (10.0 * self.rate);
        if self.phase > 2.0 * PI {
            self.phase -= 2.0 * PI;
        }
        let a = self.amount;
        let m = (l + r) * 0.5;
        let s = (l - r) * 0.5;
        let pan = self.phase.sin();
        let front = self.phase.cos();
        let behind = (-front).max(0.0);
        // Behind the head the sound loses its highs.
        let src = {
            let low = self.lp_back.run(m, self.k(1800.0));
            m + (low - m) * behind
        };
        self.mono.push(src);
        let itd = self.ms(0.7 * pan.abs());
        let near = src;
        let far_raw = self.mono.tap(itd);
        // Head shadow: the far ear is dulled.
        let far = self.lp_far.run(far_raw, self.k(2200.0 + 5000.0 * (1.0 - pan.abs())));
        let ang = (pan + 1.0) * PI / 4.0;
        let (gl, gr) = (ang.cos(), ang.sin());
        let dist = 1.0 - 0.25 * behind;
        let (nl, nr) = if pan >= 0.0 { (far * gl, near * gr) } else { (near * gl, far * gr) };
        let boost = 1.65 * dist;
        let (rl, rr) = self.reverb.process(src * 0.8, src * 0.8);
        let ol = nl * boost + s * 0.5 + rl * 1.2 * a;
        let or = nr * boost - s * 0.5 + rr * 1.2 * a;
        let mixo = (a * 1.5).min(1.0);
        (l + (ol - l) * mixo, r + (or - r) * mixo)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stereo-ish test signal: different tones left/right plus a shared noisy component.
    fn signal(i: usize) -> (f32, f32) {
        let t = i as f32 / 48000.0;
        let n = ((i as u32).wrapping_mul(2654435761) >> 16) as f32 / 65535.0 - 0.5;
        let c = 0.25 * (2.0 * PI * 220.0 * t).sin() + 0.1 * n;
        (c + 0.2 * (2.0 * PI * 330.0 * t).sin(), c + 0.2 * (2.0 * PI * 495.0 * t).sin())
    }

    fn difference_percent(mode: SpatialMode, amount: f32) -> f64 {
        let mut s = Spatial::new(48000);
        s.set(mode, amount);
        let (mut diff, mut dry) = (0.0f64, 0.0f64);
        for i in 0..240_000 {
            let (l, r) = signal(i);
            let (a, b) = s.process(l, r);
            if i > 48000 {
                diff += ((a - l) as f64).powi(2) + ((b - r) as f64).powi(2);
                dry += (l as f64).powi(2) + (r as f64).powi(2);
            }
        }
        100.0 * diff / dry
    }

    #[test]
    fn off_is_passthrough() {
        let mut s = Spatial::new(48000);
        assert_eq!(s.process(0.3, -0.2), (0.3, -0.2));
    }

    #[test]
    fn modes_stay_bounded_and_finite() {
        for mode in [SpatialMode::Wide, SpatialMode::Room, SpatialMode::Orbit] {
            for amount in [0.2, 0.7, 1.0] {
                let mut s = Spatial::new(48000);
                s.set(mode, amount);
                let mut peak = 0.0f32;
                for i in 0..200_000 {
                    let x = (i as f32 * 0.05).sin() * 0.8;
                    let (l, r) = s.process(x, x * 0.5);
                    assert!(l.is_finite() && r.is_finite());
                    peak = peak.max(l.abs()).max(r.abs());
                }
                assert!(peak < 3.5, "{mode:?}@{amount} peak {peak}");
            }
        }
    }

    #[test]
    fn every_mode_changes_the_sound_clearly_at_default_intensity() {
        // At 50% intensity the processed signal must differ from the dry one by a clearly audible amount.
        for (mode, min) in [(SpatialMode::Wide, 25.0), (SpatialMode::Room, 40.0), (SpatialMode::Orbit, 20.0)] {
            let d = difference_percent(mode, 0.5);
            println!("{mode:?}: {d:.1}% of signal energy differs from dry");
            assert!(d > min, "{mode:?} only changes {d:.1}% (needs > {min}%)");
        }
    }

    #[test]
    fn intensity_slider_scales_the_effect() {
        for mode in [SpatialMode::Wide, SpatialMode::Room, SpatialMode::Orbit] {
            assert!(difference_percent(mode, 0.9) > difference_percent(mode, 0.2) * 1.3, "{mode:?}");
        }
    }

    #[test]
    fn wide_opens_up_a_mono_signal() {
        let mut s = Spatial::new(48000);
        s.set(SpatialMode::Wide, 0.7);
        let (mut side, mut mid) = (0.0f64, 0.0f64);
        for i in 0..120_000 {
            let n = ((i as u32).wrapping_mul(2654435761) >> 16) as f32 / 65535.0 - 0.5;
            let (l, r) = s.process(n, n);
            if i > 48000 {
                side += (((l - r) * 0.5) as f64).powi(2);
                mid += (((l + r) * 0.5) as f64).powi(2);
            }
        }
        assert!(side / mid > 0.1, "a mono source should gain real width: side/mid = {}", side / mid);
    }

    #[test]
    fn room_has_a_reverb_tail_after_the_music_stops() {
        let mut s = Spatial::new(48000);
        s.set(SpatialMode::Room, 0.7);
        for i in 0..24_000 {
            let n = ((i as u32).wrapping_mul(2654435761) >> 16) as f32 / 65535.0 - 0.5;
            s.process(n, -n);
        }
        let mut tail = 0.0f64;
        for _ in 0..12_000 {
            let (l, r) = s.process(0.0, 0.0);
            tail += (l as f64).powi(2) + (r as f64).powi(2);
        }
        assert!(tail > 0.05, "room tail energy {tail}");
        let mut dry = Spatial::new(48000);
        assert_eq!(dry.process(0.0, 0.0), (0.0, 0.0));
    }

    #[test]
    fn orbit_really_moves_between_the_ears() {
        let mut s = Spatial::new(48000);
        s.set(SpatialMode::Orbit, 0.7);
        let (mut min_db, mut max_db) = (f64::MAX, f64::MIN);
        for window in 0..10 {
            let (mut el, mut er) = (1e-9f64, 1e-9f64);
            for i in 0..48_000 {
                let n = ((((window * 48_000 + i) as u32).wrapping_mul(2654435761)) >> 16) as f32 / 65535.0 - 0.5;
                let (l, r) = s.process(n, n);
                el += (l as f64).powi(2);
                er += (r as f64).powi(2);
            }
            let db = 10.0 * (el / er).log10();
            min_db = min_db.min(db);
            max_db = max_db.max(db);
        }
        println!("orbit left/right balance swings {min_db:.1} dB .. {max_db:.1} dB");
        assert!(max_db - min_db > 6.0, "the sound should travel from ear to ear (swing {:.1} dB)", max_db - min_db);
    }
}
