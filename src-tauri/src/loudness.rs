//! Loudness analysis (EBU R128, integrated loudness) so tracks from different sources play at a
//! similar volume. The result is a gain stored per track; playback applies it with smoothing.

use ebur128::{EbuR128, Mode};

use crate::audio::decode_stereo;

/// Where every track is aimed. -16 LUFS is a common level for streaming and podcasts: comfortable
/// for headphones and with headroom for dynamic music.
pub const TARGET_LUFS: f64 = -16.0;
const MAX_CUT_DB: f64 = -14.0;
const MAX_BOOST_DB: f64 = 9.0;
/// Peaks stay below this after a boost, so normalisation never clips.
const PEAK_CEILING: f64 = 0.97;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Analysis {
    pub lufs: f64,
    pub peak: f64,
}

/// Measures a file's integrated loudness and sample peak. `None` for silence or unmeasurable audio.
pub fn analyze(path: &str) -> Result<Option<Analysis>, String> {
    let mut meter: Option<EbuR128> = None;
    let mut err: Option<String> = None;
    decode_stereo(path, |chunk, rate| {
        if err.is_some() {
            return;
        }
        if meter.is_none() {
            match EbuR128::new(2, rate, Mode::I | Mode::SAMPLE_PEAK) {
                Ok(m) => meter = Some(m),
                Err(e) => {
                    err = Some(e.to_string());
                    return;
                }
            }
        }
        if let Some(Err(e)) = meter.as_mut().map(|m| m.add_frames_f32(chunk)) {
            err = Some(e.to_string());
        }
    })?;
    if let Some(e) = err {
        return Err(e);
    }
    let Some(meter) = meter else { return Ok(None) };
    let lufs = meter.loudness_global().map_err(|e| e.to_string())?;
    if !lufs.is_finite() {
        return Ok(None); // silence
    }
    let peak = (0..2).filter_map(|c| meter.sample_peak(c).ok()).fold(0.0f64, f64::max);
    Ok(Some(Analysis { lufs, peak }))
}

/// Gain in dB that brings a track to the target, limited so its peak never exceeds the ceiling.
pub fn gain_db(a: Analysis) -> f64 {
    let wanted = (TARGET_LUFS - a.lufs).clamp(MAX_CUT_DB, MAX_BOOST_DB);
    if wanted <= 0.0 || a.peak <= 0.0 {
        return wanted.min(0.0).max(MAX_CUT_DB);
    }
    let headroom = 20.0 * (PEAK_CEILING / a.peak).log10();
    wanted.min(headroom.max(0.0))
}

/// Measures every track that has no loudness yet. Returns how many were measured.
pub fn analyze_pending(lib: &crate::library::Library, mut progress: impl FnMut(usize, usize)) -> usize {
    let todo = lib.pending_analysis().unwrap_or_default();
    let total = todo.len();
    for (i, (id, path)) in todo.into_iter().enumerate() {
        match analyze(&path) {
            Ok(Some(a)) => {
                let _ = lib.set_loudness(id, Some(a.lufs), gain_db(a));
            }
            _ => {
                let _ = lib.set_loudness(id, None, 0.0);
            }
        }
        progress(i + 1, total);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_wav(path: &std::path::Path, secs: f64, freq: f64, amp: f64) {
        let rate = 44100u32;
        let n = (secs * rate as f64) as u32;
        let mut f = std::fs::File::create(path).unwrap();
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
            let v = amp * (2.0 * std::f64::consts::PI * freq * i as f64 / rate as f64).sin();
            let s = (v * 32767.0) as i16;
            f.write_all(&s.to_le_bytes()).unwrap();
            f.write_all(&s.to_le_bytes()).unwrap();
        }
    }

    fn measure(dir: &std::path::Path, name: &str, amp: f64) -> Analysis {
        let p = dir.join(name);
        write_wav(&p, 6.0, 440.0, amp);
        analyze(p.to_str().unwrap()).unwrap().expect("a tone is measurable")
    }

    #[test]
    fn measures_loudness_in_real_units() {
        let dir = tempfile::tempdir().unwrap();
        // A full-scale-relative sine at 0.1 amplitude is -20 dBFS peak: about -23 LUFS for a stereo sine.
        let quiet = measure(dir.path(), "quiet.wav", 0.1);
        let loud = measure(dir.path(), "loud.wav", 0.4);
        println!("quiet {:.2} LUFS peak {:.3}; loud {:.2} LUFS peak {:.3}", quiet.lufs, quiet.peak, loud.lufs, loud.peak);
        // Four times the amplitude is 12.04 dB louder.
        assert!(((loud.lufs - quiet.lufs) - 12.04).abs() < 0.3, "difference {}", loud.lufs - quiet.lufs);
        assert!((quiet.peak - 0.1).abs() < 0.005 && (loud.peak - 0.4).abs() < 0.005);
    }

    #[test]
    fn gain_brings_different_tracks_to_the_same_loudness() {
        let dir = tempfile::tempdir().unwrap();
        let a = measure(dir.path(), "a.wav", 0.1);
        let b = measure(dir.path(), "b.wav", 0.4);
        let (ga, gb) = (gain_db(a), gain_db(b));
        println!("gains: quiet {ga:+.2} dB, loud {gb:+.2} dB");
        assert!(gb < 0.0 && ga > gb, "the loud track is cut and the quiet one is raised relative to it");
        // After the gain both land on (or, if the peak limits a boost, just under) the target.
        assert!((b.lufs + gb - TARGET_LUFS).abs() < 0.1);
        assert!(a.lufs + ga <= TARGET_LUFS + 0.1);
        assert!(((a.lufs + ga) - (b.lufs + gb)).abs() < 0.5, "normalised loudness differs by {} dB", (a.lufs + ga) - (b.lufs + gb));
    }

    #[test]
    fn a_boost_never_pushes_the_peak_past_the_ceiling() {
        // A very quiet but spiky track: wanting +9 dB is fine, but a 0.5 peak can only be boosted ~5.8 dB.
        let g = gain_db(Analysis { lufs: -30.0, peak: 0.5 });
        assert!((0.5 * 10f64.powf(g / 20.0)) <= 0.9701, "boosted peak {}", 0.5 * 10f64.powf(g / 20.0));
        // A track already near the ceiling is not boosted at all.
        assert!(gain_db(Analysis { lufs: -30.0, peak: 0.98 }) <= 0.0001);
        // Cuts are limited to a sane maximum and are never blocked by the peak.
        assert_eq!(gain_db(Analysis { lufs: -2.0, peak: 1.0 }), MAX_CUT_DB);
        assert!((gain_db(Analysis { lufs: -10.0, peak: 1.0 }) - (-6.0)).abs() < 1e-9);
    }

    #[test]
    fn analysing_a_library_fills_in_every_track_once() {
        let dir = tempfile::tempdir().unwrap();
        write_wav(&dir.path().join("a.wav"), 4.0, 330.0, 0.1);
        write_wav(&dir.path().join("b.wav"), 4.0, 330.0, 0.5);
        write_wav(&dir.path().join("silent.wav"), 4.0, 330.0, 0.0);
        let lib = crate::library::Library::in_memory().unwrap();
        lib.import_paths(&[dir.path().to_path_buf()], dir.path());
        assert!(lib.list_tracks().unwrap().iter().all(|t| t.gain_db.is_none()), "nothing is measured on import");
        let mut seen = Vec::new();
        assert_eq!(analyze_pending(&lib, |d, t| seen.push((d, t))), 3);
        assert_eq!(seen.last(), Some(&(3, 3)));
        let tracks = lib.list_tracks().unwrap();
        assert!(tracks.iter().all(|t| t.gain_db.is_some()));
        let by = |n: &str| tracks.iter().find(|t| t.title.starts_with(n)).unwrap();
        assert!(by("b").gain_db.unwrap() < by("a").gain_db.unwrap(), "the louder file gets less gain");
        assert_eq!(by("silent").gain_db, Some(0.0));
        assert_eq!(by("silent").lufs, None);
        assert_eq!(analyze_pending(&lib, |_, _| {}), 0, "a second pass finds nothing to do");
    }

    #[test]
    fn silence_has_no_loudness() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("silent.wav");
        write_wav(&p, 3.0, 440.0, 0.0);
        assert_eq!(analyze(p.to_str().unwrap()).unwrap(), None);
    }
}
