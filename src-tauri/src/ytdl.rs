//! Imports audio from a video link with the user's own `yt-dlp` + `ffmpeg`, splitting by the
//! video's chapters (or pasted timestamps) into separate MP3 tracks. For personal use with
//! content you are allowed to keep.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

use crate::library::Library;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub url: String,
    pub stage: String,
    pub percent: Option<f32>,
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub ytdlp: Option<String>,
    pub ffmpeg: Option<String>,
    /// How many days old this yt-dlp release is (its version is its release date).
    pub ytdlp_age_days: Option<i64>,
    /// Old enough that downloads are likely to break; a one-click update is offered.
    pub ytdlp_outdated: bool,
    /// yt-dlp was installed with Homebrew, so FocusFlow can update it for you.
    pub can_update: bool,
}

/// yt-dlp downloads start failing when YouTube changes; releases older than this are flagged.
const OUTDATED_AFTER_DAYS: i64 = 45;

/// Days since 1970-01-01 for a calendar date (proleptic Gregorian).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Age in days of a yt-dlp version such as "2026.10.26" (a trailing ".1" revision is ignored).
pub fn version_age_days(version: &str, today_days_since_epoch: i64) -> Option<i64> {
    let mut it = version.trim().split('.');
    let (y, m, d): (i64, i64, i64) = (it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
    if !(2000..2200).contains(&y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(today_days_since_epoch - days_from_civil(y, m, d))
}

fn today_days() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64 / 86_400).unwrap_or(0)
}

fn brew_path() -> Option<PathBuf> {
    ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].iter().map(PathBuf::from).find(|p| p.exists())
}

const SEARCH_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/opt/local/bin"];

pub fn find_tool(name: &str) -> Option<PathBuf> {
    for d in SEARCH_DIRS {
        let p = Path::new(d).join(name);
        if p.exists() {
            return Some(p);
        }
    }
    std::env::var_os("PATH").and_then(|paths| std::env::split_paths(&paths).map(|d| d.join(name)).find(|p| p.exists()))
}

fn tool_path_env() -> String {
    let mut parts: Vec<String> = SEARCH_DIRS.iter().map(|s| s.to_string()).collect();
    if let Ok(p) = std::env::var("PATH") {
        parts.push(p);
    }
    parts.join(":")
}

pub fn tool_status() -> ToolStatus {
    let version = |name: &str, arg: &str| -> Option<String> {
        let p = find_tool(name)?;
        let out = Command::new(p).arg(arg).env("PATH", tool_path_env()).output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        Some(s.lines().next().unwrap_or("").trim().to_string())
    };
    let ytdlp = version("yt-dlp", "--version");
    let age = ytdlp.as_deref().and_then(|v| version_age_days(v, today_days()));
    let installed_by_brew = find_tool("yt-dlp").map(|p| p.starts_with("/opt/homebrew") || p.starts_with("/usr/local")).unwrap_or(false);
    ToolStatus { ytdlp, ffmpeg: version("ffmpeg", "-version"), ytdlp_age_days: age, ytdlp_outdated: age.map(|a| a > OUTDATED_AFTER_DAYS).unwrap_or(false), can_update: installed_by_brew && brew_path().is_some() }
}

/// Upgrades yt-dlp with Homebrew. Only called when the user presses the button.
pub fn update_ytdlp() -> Result<String, String> {
    let brew = brew_path().ok_or("Homebrew was not found, so FocusFlow can't update yt-dlp for you. Run: brew upgrade yt-dlp")?;
    let out = Command::new(brew)
        .args(["upgrade", "yt-dlp"])
        .env("PATH", tool_path_env())
        .env("HOMEBREW_NO_ENV_HINTS", "1")
        .output()
        .map_err(|e| format!("could not start Homebrew: {e}"))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if !out.status.success() {
        let line = text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("brew failed");
        return Err(format!("Update failed: {line}"));
    }
    Ok(if text.contains("already installed") || text.trim().is_empty() { "yt-dlp is already up to date.".into() } else { "yt-dlp was updated.".into() })
}

pub fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { ' ' } else { c })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_matches('.').trim();
    let mut s: String = trimmed.chars().take(100).collect();
    if s.is_empty() {
        s = "Untitled".into();
    }
    s
}

/// Parses lines such as `0:00 Intro`, `[12:34] - Title`, `1:02:03 | Title` into (seconds, title).
pub fn parse_timestamps(text: &str) -> Vec<(f64, String)> {
    let mut out: Vec<(f64, String)> = Vec::new();
    for line in text.lines() {
        let line = line.trim().trim_start_matches(|c: char| "[(•-*>".contains(c) || c.is_whitespace());
        let token: String = line.chars().take_while(|c| c.is_ascii_digit() || *c == ':').collect();
        if !token.contains(':') {
            continue;
        }
        let parts: Vec<&str> = token.split(':').collect();
        if parts.len() > 3 || parts.iter().any(|p| p.is_empty()) {
            continue;
        }
        let nums: Option<Vec<f64>> = parts.iter().map(|p| p.parse::<f64>().ok()).collect();
        let Some(nums) = nums else { continue };
        let secs = nums.iter().fold(0.0, |acc, n| acc * 60.0 + n);
        let rest = line[token.len()..]
            .trim_start_matches(|c: char| ")]-–—|:.·• \t".contains(c))
            .trim();
        let title = if rest.is_empty() { format!("Track {}", out.len() + 1) } else { rest.to_string() };
        if out.last().map(|(t, _)| secs > *t).unwrap_or(true) {
            out.push((secs, title));
        }
    }
    out
}

fn strip_number_prefix(stem: &str) -> String {
    let t = stem.trim();
    let digits: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() && digits.len() <= 3 {
        let rest = t[digits.len()..].trim_start_matches(|c: char| " -–.)_".contains(c)).trim();
        if !rest.is_empty() {
            return rest.to_string();
        }
    }
    t.to_string()
}

/// Shortest track the auto-detection will produce; shorter gaps between cuts are merged away.
const MIN_SEGMENT: f64 = 45.0;

pub struct Options<'a> {
    pub manual_chapters: Option<&'a str>,
    /// Look for track boundaries when the video has no chapters.
    pub auto_split: bool,
}

type Marks = Vec<(f64, String)>;

/// `https://music.youtube.com/playlist?list=...` and similar: every entry becomes its own track.
pub fn is_playlist_url(url: &str) -> bool {
    let has_list = url.contains("list=");
    let has_video = url.contains("v=") || url.contains("youtu.be/");
    (has_list && !has_video) || url.contains("/playlist?")
}

/// Marks from timestamps found in free text (a description or a comment). Needs a believable list:
/// at least three increasing marks, none beyond the video's length.
pub fn marks_from_text(text: &str, duration: Option<f64>) -> Option<Marks> {
    let mut marks = parse_timestamps(text);
    if let Some(d) = duration {
        marks.retain(|(t, _)| *t < d);
    }
    if marks.len() < 3 {
        return None;
    }
    if marks[0].0 >= 30.0 {
        marks.insert(0, (0.0, "Intro".into()));
    }
    Some(marks)
}

/// Picks the comment with the longest believable tracklist.
pub fn marks_from_comments(info: &serde_json::Value, duration: Option<f64>) -> Option<Marks> {
    info["comments"]
        .as_array()?
        .iter()
        .filter_map(|c| c["text"].as_str())
        .filter_map(|t| marks_from_text(t, duration))
        .max_by_key(|m| m.len())
}

/// Turns silence gaps into cut points: one in the middle of each gap, no track shorter than `MIN_SEGMENT`.
pub fn cuts_from_silences(silences: &[(f64, f64)], total: f64) -> Vec<f64> {
    let mut cuts: Vec<f64> = Vec::new();
    let mut last = 0.0;
    for (start, end) in silences {
        let mid = (start + end) / 2.0;
        if mid - last >= MIN_SEGMENT && total - mid >= MIN_SEGMENT {
            cuts.push(mid);
            last = mid;
        }
    }
    cuts
}

pub fn marks_from_cuts(cuts: &[f64]) -> Option<Marks> {
    if cuts.is_empty() {
        return None;
    }
    let mut marks = vec![(0.0, "Track 1".to_string())];
    for (i, c) in cuts.iter().enumerate() {
        marks.push((*c, format!("Track {}", i + 2)));
    }
    Some(marks)
}

/// Runs ffmpeg's silence detector and returns (start, end) pairs.
fn detect_silences(ffmpeg: &Path, audio: &Path, noise_db: i32, min_len: f64, path_env: &str) -> Vec<(f64, f64)> {
    let out = Command::new(ffmpeg)
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(audio)
        .args(["-af", &format!("silencedetect=noise={noise_db}dB:d={min_len}"), "-f", "null", "-"])
        .env("PATH", path_env)
        .output();
    let Ok(out) = out else { return Vec::new() };
    let text = String::from_utf8_lossy(&out.stderr);
    let mut result = Vec::new();
    let mut start: Option<f64> = None;
    for line in text.lines() {
        if let Some(rest) = line.split("silence_start:").nth(1) {
            start = rest.trim().split_whitespace().next().and_then(|v| v.parse().ok());
        } else if let Some(rest) = line.split("silence_end:").nth(1) {
            if let (Some(s), Some(e)) = (start.take(), rest.trim().split_whitespace().next().and_then(|v| v.parse::<f64>().ok())) {
                result.push((s, e));
            }
        }
    }
    result
}

/// Cuts `full` into one MP3 per mark inside `folder`. Returns (path, title) per track.
pub fn split_marks(ffmpeg: &Path, full: &Path, folder: &Path, marks: &[(f64, String)], total: Option<f64>, path_env: &str) -> Result<Vec<(PathBuf, String)>, String> {
    let mut parts = Vec::new();
    for (i, (start, name)) in marks.iter().enumerate() {
        let end = marks.get(i + 1).map(|m| m.0).or(total);
        let target = folder.join(format!("{:02} - {}.mp3", i + 1, sanitize(name)));
        let mut c = Command::new(ffmpeg);
        c.args(["-y", "-loglevel", "error", "-i"]).arg(full).arg("-ss").arg(format!("{start}"));
        if let Some(e) = end {
            c.arg("-to").arg(format!("{e}"));
        }
        c.args(["-c:a", "libmp3lame", "-q:a", "0"]).arg(&target).env("PATH", path_env);
        let st = c.status().map_err(|e| e.to_string())?;
        if !st.success() {
            return Err(format!("ffmpeg could not cut \"{name}\""));
        }
        parts.push((target, name.clone()));
    }
    Ok(parts)
}

pub fn import(lib: &Library, library_dir: &Path, url: &str, opts: &Options, progress: &dyn Fn(Progress)) -> Result<Vec<i64>, String> {
    let report = |stage: &str, percent: Option<f32>, message: &str| {
        progress(Progress { url: url.to_string(), stage: stage.into(), percent, message: message.into() })
    };
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("that does not look like a link".into());
    }
    if lib.has_source_url(url) {
        return Err("this link has already been imported".into());
    }
    let ytdlp = find_tool("yt-dlp").ok_or("yt-dlp is not installed. Run: brew install yt-dlp")?;
    let ffmpeg = find_tool("ffmpeg").ok_or("ffmpeg is not installed. Run: brew install ffmpeg")?;
    let path_env = tool_path_env();
    let tools = Tools { ytdlp, ffmpeg, path_env };
    if is_playlist_url(url) {
        import_playlist(lib, library_dir, url, &tools, &report)
    } else {
        import_video(lib, library_dir, url, opts, &tools, &report)
    }
}

struct Tools {
    ytdlp: PathBuf,
    ffmpeg: PathBuf,
    path_env: String,
}

type Report<'a> = &'a dyn Fn(&str, Option<f32>, &str);

// ---------------------------------------------------------------- failures and retries

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// Private, removed or region-blocked.
    Unavailable,
    /// YouTube wants a sign-in (age check or bot check).
    SignIn,
    /// A network hiccup: worth retrying.
    Network,
    /// Rate limiting or a blocked request (HTTP 403/429).
    Blocked,
    /// yt-dlp cannot read YouTube's current page: usually an out-of-date yt-dlp.
    Outdated,
    Other,
}

pub fn classify(stderr: &str) -> Failure {
    let t = stderr.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| t.contains(n));
    if has(&["sign in to confirm", "confirm you’re not a bot", "confirm you're not a bot", "age-restricted", "login required", "this video requires login"]) {
        Failure::SignIn
    } else if has(&["video unavailable", "private video", "has been removed", "this video is not available", "no longer available", "has been terminated", "members-only", "not available in your country", "blocked it in your country"]) {
        Failure::Unavailable
    } else if has(&["unable to extract", "nsig extraction failed", "signature extraction failed", "player response", "unsupported url", "requested format is not available"]) {
        Failure::Outdated
    } else if has(&["http error 403", "http error 429", "too many requests"]) {
        Failure::Blocked
    } else if has(&["timed out", "temporary failure in name resolution", "connection reset", "connection refused", "network is unreachable", "urlopen error", "remote end closed", "http error 500", "http error 502", "http error 503", "http error 504", "nodename nor servname"]) {
        Failure::Network
    } else {
        Failure::Other
    }
}

/// A plain-English message for a failure (with yt-dlp's own last error line appended for the unknown kind).
pub fn explain(kind: Failure, stderr: &str) -> String {
    let last = stderr.lines().rev().find(|l| l.contains("ERROR")).unwrap_or("yt-dlp failed").trim();
    match kind {
        Failure::Unavailable => "That video isn't available: it may be private, removed, or blocked in your country.".into(),
        Failure::SignIn => "YouTube is asking for a sign-in for this video (an age check or a bot check). FocusFlow doesn't use your account, so try a different link.".into(),
        Failure::Network => "Network problem while downloading. Check your connection and try again.".into(),
        Failure::Blocked => "YouTube is limiting or blocking this request (HTTP 403/429). Wait a few minutes and try again; updating yt-dlp can also help.".into(),
        Failure::Outdated => "yt-dlp could not read YouTube's current page. This usually means yt-dlp is out of date: use “Update yt-dlp” and try again.".into(),
        Failure::Other => format!("{last} (if this keeps happening, update yt-dlp)"),
    }
}

/// Extra yt-dlp arguments for the second try after a blocked/outdated failure: ask YouTube for the
/// page through different player clients. Unknown client names are ignored by yt-dlp.
const ALTERNATE_CLIENTS: [&str; 2] = ["--extractor-args", "youtube:player_client=web_safari,android_vr,tv"];

/// Runs `attempt` (given extra arguments) with a retry policy: network errors are retried up to
/// twice after a pause; blocked/outdated failures get one retry through alternate clients; sign-in and
/// unavailable failures are final. `note` reports what is happening; `pause` sleeps.
pub fn with_retries<T>(
    mut attempt: impl FnMut(&[&str]) -> Result<T, String>,
    note: &dyn Fn(&str),
    pause: &dyn Fn(Duration),
) -> Result<T, String> {
    let mut network_tries = 0;
    let mut tried_alternate = false;
    let mut extra: &[&str] = &[];
    loop {
        let err = match attempt(extra) {
            Ok(v) => return Ok(v),
            Err(e) => e,
        };
        let kind = classify(&err);
        match kind {
            Failure::Network if network_tries < 2 => {
                network_tries += 1;
                note(&format!("Network problem, retrying ({network_tries} of 2)…"));
                pause(Duration::from_secs(2 + 3 * network_tries as u64));
            }
            Failure::Outdated | Failure::Blocked if !tried_alternate => {
                tried_alternate = true;
                extra = &ALTERNATE_CLIENTS;
                note("YouTube refused that request. Trying again another way…");
                pause(Duration::from_secs(2));
            }
            _ => return Err(explain(kind, &err)),
        }
    }
}

fn run_ytdlp_json(tools: &Tools, args: &[&str], extra: &[&str], url: &str) -> Result<serde_json::Value, String> {
    let out = Command::new(&tools.ytdlp).args(args).args(extra).arg(url).env("PATH", &tools.path_env).output().map_err(|e| format!("could not start yt-dlp: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("ERROR: unreadable video info: {e}"))
}

fn ytdlp_json(tools: &Tools, args: &[&str], url: &str, note: &dyn Fn(&str)) -> Result<serde_json::Value, String> {
    with_retries(|extra| run_ytdlp_json(tools, args, extra, url), note, &std::thread::sleep)
}

/// One download attempt; returns yt-dlp's stderr text on failure so it can be classified.
fn run_download_once(mut cmd: Command, on_line: &mut dyn FnMut(&str)) -> Result<(), String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("ERROR: could not start yt-dlp: {e}"))?;
    let stderr = child.stderr.take();
    let err_thread = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(s) = stderr {
            for l in BufReader::new(s).lines().map_while(Result::ok) {
                text.push_str(&l);
                text.push('\n');
            }
        }
        text
    });
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            on_line(&line);
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let errs = err_thread.join().unwrap_or_default();
    if !status.success() {
        return Err(if errs.trim().is_empty() { "ERROR: download failed".into() } else { errs });
    }
    Ok(())
}

/// Runs a download with retries. `make` builds the command, given any extra arguments for this attempt.
fn run_download(make: &dyn Fn(&[&str]) -> Command, note: &dyn Fn(&str), mut on_line: impl FnMut(&str)) -> Result<(), String> {
    with_retries(|extra| run_download_once(make(extra), &mut on_line), note, &std::thread::sleep)
}

fn percent_of(line: &str) -> Option<f32> {
    line.strip_prefix("[download]")?.trim().split('%').next()?.trim().parse::<f32>().ok()
}

fn import_video(lib: &Library, library_dir: &Path, url: &str, opts: &Options, tools: &Tools, report: Report) -> Result<Vec<i64>, String> {
    report("info", None, "Reading video details…");
    let note = |m: &str| report("info", None, m);
    let info = ytdlp_json(tools, &["--no-playlist", "--skip-download", "--dump-single-json"], url, &note)?;
    let title = info["title"].as_str().unwrap_or("Untitled").to_string();
    let id = info["id"].as_str().unwrap_or("video").to_string();
    let total = info["duration"].as_f64();
    let has_chapters = info["chapters"].as_array().map(|c| !c.is_empty()).unwrap_or(false);

    let folder = library_dir.join("YouTube").join(format!("{} [{}]", sanitize(&title), id));
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let full = folder.join("full.mp3");

    report("download", Some(0.0), "Downloading audio…");
    let make = |extra: &[&str]| {
        let mut cmd = Command::new(&tools.ytdlp);
        cmd.args(["--no-playlist", "-x", "--audio-format", "mp3", "--audio-quality", "0", "--no-mtime", "--newline"])
            .args(["--write-thumbnail", "--convert-thumbnails", "jpg"])
            .arg("--ffmpeg-location")
            .arg(&tools.ffmpeg)
            .arg("-o")
            .arg(folder.join("full.%(ext)s"))
            .arg("-o")
            .arg(format!("thumbnail:{}", folder.join("cover.%(ext)s").display()))
            .args(extra);
        if has_chapters {
            cmd.arg("--split-chapters").arg("-o").arg(format!("chapter:{}", folder.join("%(section_number)02d - %(section_title).120B.%(ext)s").display()));
        }
        cmd.arg(url).env("PATH", &tools.path_env);
        cmd
    };
    run_download(&make, &|m| report("download", None, m), |line| {
        if let Some(p) = percent_of(line) {
            report("download", Some(p), "Downloading audio…");
        } else if line.contains("ExtractAudio") || line.contains("Destination") {
            report("convert", None, "Converting to MP3…");
        } else if line.contains("SplitChapters") {
            report("split", None, "Splitting into tracks…");
        }
    })?;
    if !full.exists() {
        return Err("download finished but no audio file was produced".into());
    }

    let mut parts: Vec<(PathBuf, String)> = Vec::new();
    if has_chapters {
        let mut files: Vec<PathBuf> = std::fs::read_dir(&folder)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p != &full && p.extension().and_then(|x| x.to_str()) == Some("mp3"))
            .collect();
        files.sort();
        for f in files {
            let name = f.file_stem().and_then(|s| s.to_str()).map(strip_number_prefix).unwrap_or_default();
            parts.push((f, name));
        }
        report("split", None, &format!("Found {} chapters", parts.len()));
    } else {
        // No chapters: look for the track list elsewhere, from the most to the least reliable source.
        let mut plan: Option<(Marks, &str)> = opts.manual_chapters.map(parse_timestamps).filter(|m| m.len() > 1).map(|m| (m, "your timestamps"));
        if plan.is_none() && opts.auto_split {
            report("detect", None, "No chapters. Looking for a track list…");
            plan = info["description"].as_str().and_then(|d| marks_from_text(d, total)).map(|m| (m, "the description"));
        }
        if plan.is_none() && opts.auto_split {
            report("detect", None, "Checking the top comments for a track list…");
            let args = ["--no-playlist", "--skip-download", "--write-comments", "--dump-single-json", "--extractor-args", "youtube:max_comments=80,80,0,0,0;comment_sort=top"];
            if let Ok(with_comments) = ytdlp_json(tools, &args, url, &|_| {}) {
                plan = marks_from_comments(&with_comments, total).map(|m| (m, "a comment"));
            }
        }
        if plan.is_none() && opts.auto_split {
            report("detect", None, "Listening for gaps between tracks…");
            let dur = total.unwrap_or(0.0);
            for (noise, gap) in [(-38, 1.5), (-32, 0.8)] {
                let silences = detect_silences(&tools.ffmpeg, &full, noise, gap, &tools.path_env);
                if let Some(m) = marks_from_cuts(&cuts_from_silences(&silences, dur)) {
                    plan = Some((m, "silence between tracks"));
                    break;
                }
            }
        }
        if let Some((marks, source)) = plan {
            report("split", None, &format!("Found {} tracks from {source}. Splitting…", marks.len()));
            parts = split_marks(&tools.ffmpeg, &full, &folder, &marks, total, &tools.path_env)?;
        } else if opts.auto_split {
            report("detect", None, "Could not find track boundaries; keeping it as one track.");
        }
    }

    report("import", None, "Adding to library…");
    let mut added = Vec::new();
    if parts.is_empty() {
        if let Some(id) = lib.add_file(&full, Some(url), Some(&title), Some(&title))? {
            added.push(id);
        }
    } else {
        for (p, name) in &parts {
            match lib.add_file(p, Some(url), Some(name), Some(&title)) {
                Ok(Some(id)) => added.push(id),
                Ok(None) => {}
                Err(e) => report("warn", None, &format!("Skipped {}: {e}", p.display())),
            }
        }
        let _ = std::fs::remove_file(&full);
    }
    let cover = folder.join("cover.jpg");
    if cover.exists() && !added.is_empty() {
        let _ = lib.set_art(&added, &cover);
    }
    report("done", Some(100.0), &format!("Added {} track(s)", added.len()));
    Ok(added)
}

/// An album or playlist link (YouTube Music): each entry is downloaded as its own track.
fn import_playlist(lib: &Library, library_dir: &Path, url: &str, tools: &Tools, report: Report) -> Result<Vec<i64>, String> {
    report("info", None, "Reading playlist…");
    let info = ytdlp_json(tools, &["--flat-playlist", "--skip-download", "--dump-single-json"], url, &|m| report("info", None, m))?;
    let title = info["title"].as_str().unwrap_or("Playlist").trim_start_matches("Album - ").to_string();
    let id = info["id"].as_str().unwrap_or("playlist").to_string();
    let count = info["entries"].as_array().map(|e| e.len()).unwrap_or(0);
    if count == 0 {
        return Err("that playlist has no videos".into());
    }
    let folder = library_dir.join("YouTube").join(format!("{} [{}]", sanitize(&title), id));
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let template = folder.join("%(playlist_index)02d - %(title).120B.%(ext)s");

    report("download", Some(0.0), &format!("Downloading {count} tracks…"));
    let make = |extra: &[&str]| {
        let mut cmd = Command::new(&tools.ytdlp);
        cmd.args(["--yes-playlist", "--ignore-errors", "-x", "--audio-format", "mp3", "--audio-quality", "0", "--no-mtime", "--newline"])
            .args(["--write-thumbnail", "--convert-thumbnails", "jpg"])
            .arg("--ffmpeg-location")
            .arg(&tools.ffmpeg)
            .arg("-o")
            .arg(&template)
            .arg("-o")
            .arg(format!("thumbnail:{}", template.display()))
            .args(extra)
            .arg(url)
            .env("PATH", &tools.path_env);
        cmd
    };
    let (mut item, mut total) = (1usize, count);
    run_download(&make, &|m| report("download", None, m), |line| {
        if let Some(rest) = line.strip_prefix("[download] Downloading item ") {
            let mut it = rest.split(" of ");
            if let (Some(a), Some(b)) = (it.next().and_then(|x| x.trim().parse().ok()), it.next().and_then(|x| x.trim().parse().ok())) {
                item = a;
                total = b;
                report("download", Some(((item - 1) as f32 / total as f32) * 100.0), &format!("Downloading track {item} of {total}…"));
            }
        } else if let Some(p) = percent_of(line) {
            report("download", Some((((item - 1) as f32 + p / 100.0) / total as f32) * 100.0), &format!("Downloading track {item} of {total}…"));
        } else if line.contains("ExtractAudio") {
            report("convert", None, &format!("Converting track {item} of {total}…"));
        }
    })?;

    report("import", None, "Adding to library…");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&folder)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("mp3"))
        .collect();
    files.sort();
    let mut added = Vec::new();
    for f in files {
        let name = f.file_stem().and_then(|s| s.to_str()).map(strip_number_prefix).unwrap_or_default();
        match lib.add_file(&f, Some(url), Some(&name), Some(&title)) {
            Ok(Some(id)) => {
                let art = f.with_extension("jpg");
                if art.exists() {
                    let _ = lib.set_art(&[id], &art);
                }
                added.push(id);
            }
            Ok(None) => {}
            Err(e) => report("warn", None, &format!("Skipped {}: {e}", f.display())),
        }
    }
    report("done", Some(100.0), &format!("Added {} of {count} tracks", added.len()));
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_timestamp_styles() {
        let t = parse_timestamps("Tracklist:\n0:00 Opening\n[03:15] - Second Piece\n1:02:03 | Finale\n12:xx nope\n(4:00) Out of order\n");
        assert_eq!(t.len(), 3, "out-of-order mark is dropped");
        assert_eq!(t[0], (0.0, "Opening".into()));
        assert_eq!(t[1], (195.0, "Second Piece".into()));
        assert_eq!(t[2], (3723.0, "Finale".into()));
    }

    #[test]
    fn drops_non_increasing_marks() {
        let t = parse_timestamps("5:00 A\n2:00 B\n6:00 C");
        assert_eq!(t.iter().map(|x| x.0).collect::<Vec<_>>(), vec![300.0, 360.0]);
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize("A/B: C?*"), "A B C");
        assert_eq!(sanitize("..."), "Untitled");
    }

    #[test]
    fn strips_number_prefix() {
        assert_eq!(strip_number_prefix("03 - Night Sky"), "Night Sky");
        assert_eq!(strip_number_prefix("2001 Odyssey"), "2001 Odyssey");
    }

    #[test]
    fn rejects_non_links_before_touching_anything() {
        let lib = Library::in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let r = import(&lib, dir.path(), "not a url", &Options { manual_chapters: None, auto_split: true }, &|_| {});
        assert!(r.is_err());
    }

    #[test]
    fn detects_playlist_links() {
        assert!(is_playlist_url("https://music.youtube.com/playlist?list=OLAK5uy_abc"));
        assert!(is_playlist_url("https://www.youtube.com/playlist?list=PL123"));
        assert!(!is_playlist_url("https://www.youtube.com/watch?v=abc123"));
        assert!(!is_playlist_url("https://www.youtube.com/watch?v=abc123&list=PL123"));
        assert!(!is_playlist_url("https://youtu.be/abc123?list=PL123"));
    }

    #[test]
    fn description_needs_a_believable_track_list() {
        let good = "Mix of calm piano\n0:00 First\n3:30 Second\n7:10 Third\n11:00 Fourth";
        let m = marks_from_text(good, Some(900.0)).unwrap();
        assert_eq!(m.len(), 4);
        assert_eq!(m[1], (210.0, "Second".into()));
        assert!(marks_from_text("0:00 Intro\n1:00 Outro", Some(900.0)).is_none(), "two marks is not a track list");
        assert!(marks_from_text(good, Some(300.0)).is_none() || marks_from_text(good, Some(300.0)).unwrap().len() < 4, "marks past the end are dropped");
        let late = marks_from_text("2:00 A\n5:00 B\n9:00 C", Some(900.0)).unwrap();
        assert_eq!(late[0], (0.0, "Intro".into()), "audio before the first mark is kept as an intro");
    }

    #[test]
    fn picks_the_longest_tracklist_comment() {
        let info = serde_json::json!({ "comments": [
            { "text": "great mix!! 1:00 is my favourite" },
            { "text": "0:00 A\n2:00 B\n4:00 C" },
            { "text": "Tracklist\n0:00 A\n2:00 B\n4:00 C\n6:00 D\n8:00 E" },
        ]});
        assert_eq!(marks_from_comments(&info, Some(900.0)).unwrap().len(), 5);
        assert!(marks_from_comments(&serde_json::json!({ "comments": [{ "text": "nice" }] }), None).is_none());
        assert!(marks_from_comments(&serde_json::json!({}), None).is_none());
    }

    #[test]
    fn silence_cuts_respect_minimum_track_length() {
        // Gaps at 100 s, 120 s (too close to the last cut), 300 s and 590 s (too close to the end of a 600 s file).
        let cuts = cuts_from_silences(&[(99.0, 101.0), (119.0, 121.0), (299.0, 301.0), (589.0, 591.0)], 600.0);
        assert_eq!(cuts, vec![100.0, 300.0]);
        assert!(marks_from_cuts(&[]).is_none());
        assert_eq!(marks_from_cuts(&cuts).unwrap().iter().map(|m| m.1.clone()).collect::<Vec<_>>(), vec!["Track 1", "Track 2", "Track 3"]);
    }

    /// Real ffmpeg: a file of three tones separated by silence is found and split into three tracks.
    #[test]
    fn finds_and_splits_tracks_separated_by_silence() {
        let (Some(ffmpeg), Some(_)) = (find_tool("ffmpeg"), Some(())) else { return };
        let env = tool_path_env();
        let dir = tempfile::tempdir().unwrap();
        let full = dir.path().join("full.mp3");
        // 60 s tone, 3 s silence, 70 s tone, 3 s silence, 55 s tone.
        let filter = "sine=frequency=220:duration=60[a];anullsrc=r=44100:cl=stereo,atrim=duration=3[s1];sine=frequency=330:duration=70[b];anullsrc=r=44100:cl=stereo,atrim=duration=3[s2];sine=frequency=440:duration=55[c];[a]aformat=sample_rates=44100:channel_layouts=stereo[a2];[b]aformat=sample_rates=44100:channel_layouts=stereo[b2];[c]aformat=sample_rates=44100:channel_layouts=stereo[c2];[a2][s1][b2][s2][c2]concat=n=5:v=0:a=1";
        let st = Command::new(&ffmpeg).args(["-y", "-loglevel", "error", "-filter_complex", filter, "-b:a", "64k"]).arg(&full).env("PATH", &env).status().unwrap();
        assert!(st.success(), "could not synthesise the test file");
        let total = 191.0;
        let silences = detect_silences(&ffmpeg, &full, -38, 1.5, &env);
        assert_eq!(silences.len(), 2, "found {silences:?}");
        let cuts = cuts_from_silences(&silences, total);
        assert_eq!(cuts.len(), 2);
        assert!((cuts[0] - 61.5).abs() < 1.5 && (cuts[1] - 134.5).abs() < 2.0, "cuts {cuts:?}");
        let marks = marks_from_cuts(&cuts).unwrap();
        let parts = split_marks(&ffmpeg, &full, dir.path(), &marks, Some(total), &env).unwrap();
        assert_eq!(parts.len(), 3);
        for (p, _) in &parts {
            assert!(p.exists() && std::fs::metadata(p).unwrap().len() > 10_000, "{p:?}");
        }
        // The library can import the pieces and sees sensible durations.
        let lib = Library::in_memory().unwrap();
        let ids: Vec<i64> = parts.iter().filter_map(|(p, n)| lib.add_file(p, Some("https://example.test/v"), Some(n), Some("Mix")).unwrap()).collect();
        assert_eq!(ids.len(), 3);
        let durs: Vec<f64> = lib.list_tracks().unwrap().iter().map(|t| t.duration).collect();
        let sum: f64 = durs.iter().sum();
        assert!((sum - total).abs() < 12.0, "durations {durs:?}");
    }

    // ------------------------------------------------------------ health and retries

    #[test]
    fn yt_dlp_version_age_is_computed_from_its_date() {
        let today = days_from_civil(2026, 10, 28);
        assert_eq!(version_age_days("2026.10.26", today), Some(2));
        assert_eq!(version_age_days("2026.09.01", today), Some(57));
        assert_eq!(version_age_days("2025.10.28", today), Some(365));
        assert_eq!(version_age_days("2026.10.26.1\n", today), Some(2), "a revision suffix and whitespace are fine");
        assert_eq!(version_age_days("nightly", today), None);
        assert_eq!(version_age_days("1999.01.01", today), None);
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1) - days_from_civil(2000, 2, 28), 2, "2000 was a leap year");
    }

    #[test]
    fn real_error_text_is_classified() {
        let cases = [
            ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser", Failure::SignIn),
            ("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate", Failure::SignIn),
            ("ERROR: [youtube] abc: Video unavailable. This video is not available", Failure::Unavailable),
            ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", Failure::Unavailable),
            ("ERROR: [youtube] abc: This video has been removed by the uploader", Failure::Unavailable),
            ("ERROR: [youtube] abc: nsig extraction failed: Some formats may be missing", Failure::Outdated),
            ("ERROR: Unable to extract initial player response; please report this issue", Failure::Outdated),
            ("ERROR: unable to download video data: HTTP Error 403: Forbidden", Failure::Blocked),
            ("ERROR: HTTP Error 429: Too Many Requests", Failure::Blocked),
            ("ERROR: Unable to download webpage: <urlopen error [Errno 8] nodename nor servname provided, or not known>", Failure::Network),
            ("ERROR: unable to download video data: The read operation timed out", Failure::Network),
            ("ERROR: something nobody has seen before", Failure::Other),
        ];
        for (text, want) in cases {
            assert_eq!(classify(text), want, "{text}");
        }
        assert!(explain(Failure::SignIn, "").contains("sign-in"));
        assert!(explain(Failure::Outdated, "").contains("Update yt-dlp"));
        assert!(explain(Failure::Other, "ERROR: weird thing").contains("ERROR: weird thing"));
    }

    #[test]
    fn network_errors_are_retried_then_succeed() {
        let calls = std::cell::Cell::new(0);
        let pauses = std::cell::RefCell::new(Vec::new());
        let notes = std::cell::RefCell::new(Vec::new());
        let r = with_retries(
            |extra| {
                calls.set(calls.get() + 1);
                assert!(extra.is_empty(), "network retries keep the same arguments");
                if calls.get() < 3 { Err("ERROR: The read operation timed out".to_string()) } else { Ok("done") }
            },
            &|m| notes.borrow_mut().push(m.to_string()),
            &|d| pauses.borrow_mut().push(d),
        );
        assert_eq!(r, Ok("done"));
        assert_eq!(calls.get(), 3);
        assert_eq!(pauses.borrow().len(), 2);
        assert!(notes.borrow()[0].contains("retrying (1 of 2)"));
    }

    #[test]
    fn persistent_network_failure_gives_up_with_a_friendly_message() {
        let calls = std::cell::Cell::new(0);
        let r: Result<(), String> = with_retries(|_| { calls.set(calls.get() + 1); Err("ERROR: connection reset by peer".into()) }, &|_| {}, &|_| {});
        assert_eq!(calls.get(), 3, "one try plus two retries");
        assert!(r.unwrap_err().starts_with("Network problem"));
    }

    #[test]
    fn blocked_or_outdated_failures_retry_once_through_alternate_clients() {
        let seen = std::cell::RefCell::new(Vec::<Vec<String>>::new());
        let r: Result<(), String> = with_retries(
            |extra| { seen.borrow_mut().push(extra.iter().map(|s| s.to_string()).collect()); Err("ERROR: nsig extraction failed".into()) },
            &|_| {},
            &|_| {},
        );
        let seen = seen.borrow();
        assert_eq!(seen.len(), 2, "exactly one more attempt");
        assert!(seen[0].is_empty());
        assert_eq!(seen[1][0], "--extractor-args");
        assert!(seen[1][1].starts_with("youtube:player_client="));
        assert!(r.unwrap_err().contains("Update yt-dlp"), "after the retry the user is told to update");
    }

    #[test]
    fn sign_in_and_unavailable_are_final_and_not_retried() {
        for text in ["ERROR: Sign in to confirm you're not a bot", "ERROR: Video unavailable"] {
            let calls = std::cell::Cell::new(0);
            let r: Result<(), String> = with_retries(|_| { calls.set(calls.get() + 1); Err(text.to_string()) }, &|_| {}, &|_| panic!("must not wait"));
            assert_eq!(calls.get(), 1, "{text}");
            assert!(r.is_err());
        }
    }
}
