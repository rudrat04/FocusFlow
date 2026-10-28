//! SQLite-backed music library: tracks, playlists, favorites and a playback error log.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{MetadataOptions, StandardTag};

pub const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "alac", "caf", "aif", "aiff"];

pub fn is_audio_file(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub format: String,
    pub size: i64,
    pub sample_rate: i64,
    pub channels: i64,
    pub added_at: i64,
    pub missing: bool,
    pub favorite: bool,
    pub source_url: Option<String>,
    pub has_art: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub track_ids: Vec<i64>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub added: Vec<i64>,
    pub duplicates: usize,
    pub failed: Vec<(String, String)>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ErrorLogEntry {
    pub id: i64,
    pub track_id: Option<i64>,
    pub path: String,
    pub message: String,
    pub at: i64,
}

#[derive(Debug, Clone)]
pub struct ProbeInfo {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u32,
    /// Embedded cover art: (bytes, file extension).
    pub art: Option<(Vec<u8>, &'static str)>,
}

/// Reads container info and tags, then confirms the first packets decode.
pub fn probe_file(path: &Path) -> Result<ProbeInfo, String> {
    let file = File::open(path).map_err(|e| format!("cannot open: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| format!("unsupported or corrupted: {e}"))?;
    let track = format.default_track(TrackType::Audio).ok_or("no audio track")?;
    let params = track.codec_params.as_ref().and_then(|p| p.audio()).ok_or("missing audio parameters")?;
    let sample_rate = params.sample_rate.ok_or("unknown sample rate")?;
    let channels = params.channels.as_ref().map(|c| c.count() as u32).unwrap_or(2);
    let track_id = track.id;
    let mut frames = track.num_frames;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(params, &AudioDecoderOptions::default())
        .map_err(|e| format!("unsupported codec: {e}"))?;

    let (mut title, mut artist, mut album) = (None, None, None);
    let mut art: Option<(Vec<u8>, &'static str)> = None;
    {
        let mut meta = format.metadata();
        if let Some(rev) = meta.skip_to_latest() {
            for t in &rev.media.tags {
                match &t.std {
                    Some(StandardTag::TrackTitle(s)) if title.is_none() => title = Some(s.to_string()),
                    Some(StandardTag::Artist(s)) if artist.is_none() => artist = Some(s.to_string()),
                    Some(StandardTag::Album(s)) if album.is_none() => album = Some(s.to_string()),
                    _ => {}
                }
            }
            if let Some(v) = rev.media.visuals.iter().find(|v| !v.data.is_empty()) {
                let ext = match v.media_type.as_deref() {
                    Some("image/png") => "png",
                    _ => "jpg",
                };
                art = Some((v.data.to_vec(), ext));
            }
        }
    }

    // A file that cannot decode a single packet is treated as unreadable.
    let mut decoded_any = false;
    let mut counted: u64 = 0;
    let need_count = frames.is_none();
    let mut bad = 0;
    loop {
        match format.next_packet() {
            Ok(Some(p)) => {
                if p.track_id != track_id {
                    continue;
                }
                match decoder.decode(&p) {
                    Ok(buf) => {
                        decoded_any = true;
                        counted += buf.frames() as u64;
                    }
                    Err(SymError::DecodeError(_)) | Err(SymError::IoError(_)) => {
                        bad += 1;
                        if !decoded_any && bad > 20 {
                            break;
                        }
                    }
                    Err(_) => break,
                }
                if decoded_any && !need_count {
                    break;
                }
            }
            _ => break,
        }
    }
    if !decoded_any {
        return Err("file contains no decodable audio".into());
    }
    if need_count {
        frames = Some(counted);
    }
    let duration = frames.unwrap_or(0) as f64 / sample_rate as f64;
    Ok(ProbeInfo { title, artist, album, duration, sample_rate, channels, art })
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut f = File::open(path)?;
    let mut h = blake3::Hasher::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().to_hex().to_string())
}

fn title_from_filename(p: &Path) -> String {
    p.file_stem().and_then(|s| s.to_str()).unwrap_or("Untitled").replace('_', " ").trim().to_string()
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub struct Library {
    conn: Mutex<Connection>,
    art_dir: Option<PathBuf>,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  duration REAL NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  sample_rate INTEGER NOT NULL DEFAULT 0,
  channels INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  art_path TEXT
);
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);
CREATE TABLE IF NOT EXISTS favorites (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER,
  path TEXT NOT NULL,
  message TEXT NOT NULL,
  at INTEGER NOT NULL
);
";

const TRACK_COLS: &str = "t.id, t.path, t.title, t.artist, t.album, t.duration, t.format, t.size, \
    t.sample_rate, t.channels, t.added_at, t.missing, (f.track_id IS NOT NULL), t.source_url, (t.art_path IS NOT NULL)";
const TRACK_FROM: &str = "FROM tracks t LEFT JOIN favorites f ON f.track_id = t.id";

fn row_to_track(r: &rusqlite::Row) -> rusqlite::Result<Track> {
    Ok(Track {
        id: r.get(0)?,
        path: r.get(1)?,
        title: r.get(2)?,
        artist: r.get(3)?,
        album: r.get(4)?,
        duration: r.get(5)?,
        format: r.get(6)?,
        size: r.get(7)?,
        sample_rate: r.get(8)?,
        channels: r.get(9)?,
        added_at: r.get(10)?,
        missing: r.get::<_, i64>(11)? != 0,
        favorite: r.get::<_, i64>(12)? != 0,
        source_url: r.get(13)?,
        has_art: r.get::<_, i64>(14)? != 0,
    })
}

type Res<T> = Result<T, String>;
fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

impl Library {
    pub fn open(db_path: &Path) -> Res<Self> {
        if let Some(dir) = db_path.parent() {
            std::fs::create_dir_all(dir).map_err(e)?;
        }
        let art = db_path.parent().map(|d| d.join("art"));
        Self::from_conn(Connection::open(db_path).map_err(e)?, art)
    }

    #[cfg(test)]
    pub fn in_memory() -> Res<Self> {
        Self::from_conn(Connection::open_in_memory().map_err(e)?, None)
    }

    fn from_conn(conn: Connection, art_dir: Option<PathBuf>) -> Res<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").map_err(e)?;
        conn.execute_batch(SCHEMA).map_err(e)?;
        // Databases created by older builds lack the artwork column.
        let _ = conn.execute("ALTER TABLE tracks ADD COLUMN art_path TEXT", []);
        Ok(Self { conn: Mutex::new(conn), art_dir })
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Imports a single file already located at its final path. Duplicate content is skipped.
    pub fn add_file(&self, path: &Path, source_url: Option<&str>, title_override: Option<&str>, album_override: Option<&str>) -> Res<Option<i64>> {
        let info = probe_file(path)?;
        let hash = hash_file(path).map_err(e)?;
        let size = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
        let path_s = path.to_string_lossy().to_string();
        let conn = self.db();
        let dup: Option<i64> = conn
            .query_row("SELECT id FROM tracks WHERE hash = ?1 OR path = ?2", params![hash, path_s], |r| r.get(0))
            .optional()
            .map_err(e)?;
        if dup.is_some() {
            return Ok(None);
        }
        let title = title_override
            .map(String::from)
            .or(info.title.clone().filter(|t| !t.trim().is_empty()))
            .unwrap_or_else(|| title_from_filename(path));
        let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_uppercase();
        conn.execute(
            "INSERT INTO tracks (path, hash, title, artist, album, duration, format, size, sample_rate, channels, added_at, source_url)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                path_s,
                hash,
                title,
                info.artist.unwrap_or_default(),
                album_override.map(String::from).or(info.album).unwrap_or_default(),
                info.duration,
                ext,
                size,
                info.sample_rate,
                info.channels,
                now(),
                source_url
            ],
        )
        .map_err(e)?;
        let id = conn.last_insert_rowid();
        if let (Some((bytes, ext)), Some(dir)) = (&info.art, &self.art_dir) {
            let _ = std::fs::create_dir_all(dir);
            let target = dir.join(format!("{hash}.{ext}"));
            if std::fs::write(&target, bytes).is_ok() {
                let _ = conn.execute("UPDATE tracks SET art_path = ?1 WHERE id = ?2", params![target.to_string_lossy(), id]);
            }
        }
        Ok(Some(id))
    }

    pub fn set_art(&self, ids: &[i64], path: &Path) -> Res<()> {
        let conn = self.db();
        for id in ids {
            conn.execute("UPDATE tracks SET art_path = ?1 WHERE id = ?2 AND art_path IS NULL", params![path.to_string_lossy(), id]).map_err(e)?;
        }
        Ok(())
    }

    pub fn art_path(&self, id: i64) -> Res<Option<String>> {
        Ok(self.db().query_row("SELECT art_path FROM tracks WHERE id = ?1", params![id], |r| r.get(0)).optional().map_err(e)?.flatten())
    }

    /// Artwork as a `data:` URL, or None when the track has none (or the file vanished).
    pub fn art_data_url(&self, id: i64) -> Res<Option<String>> {
        use base64::Engine as _;
        let path: Option<String> = self
            .db()
            .query_row("SELECT art_path FROM tracks WHERE id = ?1", params![id], |r| r.get(0))
            .optional()
            .map_err(e)?
            .flatten();
        let Some(path) = path else { return Ok(None) };
        let Ok(bytes) = std::fs::read(&path) else { return Ok(None) };
        let mime = if path.to_ascii_lowercase().ends_with("png") { "image/png" } else { "image/jpeg" };
        Ok(Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))))
    }

    pub fn update_track(&self, id: i64, title: &str, artist: &str, album: &str) -> Res<()> {
        let title = title.trim();
        if title.is_empty() {
            return Err("a song needs a title".into());
        }
        self.db().execute("UPDATE tracks SET title = ?1, artist = ?2, album = ?3 WHERE id = ?4", params![title, artist.trim(), album.trim(), id]).map_err(e)?;
        Ok(())
    }

    pub fn set_album(&self, ids: &[i64], album: &str) -> Res<()> {
        // An empty name clears the album (used when a track is removed from an album).
        let album = album.trim();
        let conn = self.db();
        for id in ids {
            conn.execute("UPDATE tracks SET album = ?1 WHERE id = ?2", params![album, id]).map_err(e)?;
        }
        Ok(())
    }

    /// Imports paths (files or folders). Files outside `library_dir` are copied into `library_dir/Imported`.
    pub fn import_paths(&self, paths: &[PathBuf], library_dir: &Path) -> ImportReport {
        let mut report = ImportReport::default();
        let mut files: Vec<PathBuf> = Vec::new();
        for p in paths {
            if p.is_dir() {
                for entry in walkdir::WalkDir::new(p).follow_links(true).into_iter().filter_map(|x| x.ok()) {
                    if entry.file_type().is_file() && is_audio_file(entry.path()) {
                        files.push(entry.path().to_path_buf());
                    }
                }
            } else if p.is_file() {
                if is_audio_file(p) {
                    files.push(p.clone());
                } else {
                    report.failed.push((p.to_string_lossy().into(), "not a supported audio format".into()));
                }
            } else {
                report.failed.push((p.to_string_lossy().into(), "file not found".into()));
            }
        }
        files.sort();
        for f in files {
            let target = if f.starts_with(library_dir) { f.clone() } else { unique_copy_target(&f, &library_dir.join("Imported")) };
            if target != f {
                // Probe before copying so unreadable files never land in the library.
                if let Err(err) = probe_file(&f) {
                    report.failed.push((f.to_string_lossy().into(), err));
                    continue;
                }
                // Skip the copy entirely when identical content is already imported.
                if let Ok(h) = hash_file(&f) {
                    let exists: bool = self
                        .db()
                        .query_row("SELECT 1 FROM tracks WHERE hash = ?1", params![h], |_| Ok(true))
                        .optional()
                        .ok()
                        .flatten()
                        .unwrap_or(false);
                    if exists {
                        report.duplicates += 1;
                        continue;
                    }
                }
                if let Some(dir) = target.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                if let Err(err) = std::fs::copy(&f, &target) {
                    report.failed.push((f.to_string_lossy().into(), format!("copy failed: {err}")));
                    continue;
                }
            }
            match self.add_file(&target, None, None, None) {
                Ok(Some(id)) => report.added.push(id),
                Ok(None) => {
                    report.duplicates += 1;
                    if target != f {
                        let _ = std::fs::remove_file(&target);
                    }
                }
                Err(err) => {
                    if target != f {
                        let _ = std::fs::remove_file(&target);
                    }
                    report.failed.push((f.to_string_lossy().into(), err));
                }
            }
        }
        report
    }

    pub fn list_tracks(&self) -> Res<Vec<Track>> {
        let conn = self.db();
        let mut st = conn
            .prepare(&format!("SELECT {TRACK_COLS} {TRACK_FROM} ORDER BY t.artist COLLATE NOCASE, t.album COLLATE NOCASE, t.title COLLATE NOCASE"))
            .map_err(e)?;
        let rows = st.query_map([], row_to_track).map_err(e)?.collect::<Result<Vec<_>, _>>().map_err(e)?;
        Ok(rows)
    }

    pub fn get_track(&self, id: i64) -> Res<Option<Track>> {
        let conn = self.db();
        conn.query_row(&format!("SELECT {TRACK_COLS} {TRACK_FROM} WHERE t.id = ?1"), params![id], row_to_track)
            .optional()
            .map_err(e)
    }

    /// Re-checks every file on disk and flags missing ones. Returns how many are missing.
    pub fn refresh_missing(&self) -> Res<usize> {
        let conn = self.db();
        let mut st = conn.prepare("SELECT id, path, missing FROM tracks").map_err(e)?;
        let rows: Vec<(i64, String, i64)> =
            st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(e)?.filter_map(|x| x.ok()).collect();
        drop(st);
        let mut missing = 0;
        for (id, path, was) in rows {
            let gone = !Path::new(&path).exists();
            if gone {
                missing += 1;
            }
            if gone != (was != 0) {
                conn.execute("UPDATE tracks SET missing = ?1 WHERE id = ?2", params![gone as i64, id]).map_err(e)?;
            }
        }
        Ok(missing)
    }

    pub fn mark_missing(&self, id: i64, missing: bool) -> Res<()> {
        self.db().execute("UPDATE tracks SET missing = ?1 WHERE id = ?2", params![missing as i64, id]).map_err(e)?;
        Ok(())
    }

    pub fn remove_track(&self, id: i64, delete_file: bool) -> Res<()> {
        let conn = self.db();
        let path: Option<String> =
            conn.query_row("SELECT path FROM tracks WHERE id = ?1", params![id], |r| r.get(0)).optional().map_err(e)?;
        conn.execute("DELETE FROM tracks WHERE id = ?1", params![id]).map_err(e)?;
        if delete_file {
            if let Some(p) = path {
                let _ = std::fs::remove_file(p);
            }
        }
        Ok(())
    }

    pub fn set_favorite(&self, id: i64, fav: bool) -> Res<()> {
        let conn = self.db();
        if fav {
            conn.execute("INSERT OR IGNORE INTO favorites (track_id) VALUES (?1)", params![id]).map_err(e)?;
        } else {
            conn.execute("DELETE FROM favorites WHERE track_id = ?1", params![id]).map_err(e)?;
        }
        Ok(())
    }

    // ------------------------------------------------------------ playlists

    pub fn create_playlist(&self, name: &str) -> Res<i64> {
        let name = name.trim();
        if name.is_empty() {
            return Err("playlist name cannot be empty".into());
        }
        let conn = self.db();
        conn.execute("INSERT INTO playlists (name, created_at) VALUES (?1, ?2)", params![name, now()]).map_err(e)?;
        Ok(conn.last_insert_rowid())
    }

    pub fn rename_playlist(&self, id: i64, name: &str) -> Res<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err("playlist name cannot be empty".into());
        }
        self.db().execute("UPDATE playlists SET name = ?1 WHERE id = ?2", params![name, id]).map_err(e)?;
        Ok(())
    }

    pub fn delete_playlist(&self, id: i64) -> Res<()> {
        self.db().execute("DELETE FROM playlists WHERE id = ?1", params![id]).map_err(e)?;
        Ok(())
    }

    /// Replaces a playlist's contents (order preserved, duplicates and unknown ids dropped).
    pub fn set_playlist_tracks(&self, id: i64, track_ids: &[i64]) -> Res<()> {
        let mut conn = self.db();
        let tx = conn.transaction().map_err(e)?;
        tx.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", params![id]).map_err(e)?;
        let mut seen = std::collections::HashSet::new();
        let mut pos = 0;
        for &t in track_ids {
            let exists: bool = tx.query_row("SELECT 1 FROM tracks WHERE id = ?1", params![t], |_| Ok(true)).optional().map_err(e)?.unwrap_or(false);
            if exists && seen.insert(t) {
                tx.execute("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1,?2,?3)", params![id, t, pos]).map_err(e)?;
                pos += 1;
            }
        }
        tx.commit().map_err(e)
    }

    pub fn list_playlists(&self) -> Res<Vec<Playlist>> {
        let conn = self.db();
        let mut st = conn.prepare("SELECT id, name FROM playlists ORDER BY created_at, id").map_err(e)?;
        let lists: Vec<(i64, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(e)?.filter_map(|x| x.ok()).collect();
        let mut out = Vec::new();
        for (id, name) in lists {
            let mut st2 = conn.prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position").map_err(e)?;
            let ids = st2.query_map(params![id], |r| r.get(0)).map_err(e)?.filter_map(|x| x.ok()).collect();
            out.push(Playlist { id, name, track_ids: ids });
        }
        Ok(out)
    }

    // ------------------------------------------------------------ error log

    pub fn log_error(&self, track_id: Option<i64>, path: &str, message: &str) -> Res<()> {
        let conn = self.db();
        conn.execute("INSERT INTO error_log (track_id, path, message, at) VALUES (?1,?2,?3,?4)", params![track_id, path, message, now()]).map_err(e)?;
        conn.execute("DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT 500)", []).map_err(e)?;
        Ok(())
    }

    pub fn list_errors(&self) -> Res<Vec<ErrorLogEntry>> {
        let conn = self.db();
        let mut st = conn.prepare("SELECT id, track_id, path, message, at FROM error_log ORDER BY id DESC LIMIT 100").map_err(e)?;
        let rows = st
            .query_map([], |r| Ok(ErrorLogEntry { id: r.get(0)?, track_id: r.get(1)?, path: r.get(2)?, message: r.get(3)?, at: r.get(4)? }))
            .map_err(e)?
            .filter_map(|x| x.ok())
            .collect();
        Ok(rows)
    }

    pub fn clear_errors(&self) -> Res<()> {
        self.db().execute("DELETE FROM error_log", []).map_err(e)?;
        Ok(())
    }

    pub fn has_source_url(&self, url: &str) -> bool {
        self.db()
            .query_row("SELECT 1 FROM tracks WHERE source_url = ?1 LIMIT 1", params![url], |_| Ok(true))
            .optional()
            .ok()
            .flatten()
            .unwrap_or(false)
    }
}

fn unique_copy_target(src: &Path, dir: &Path) -> PathBuf {
    let name = src.file_name().map(|n| n.to_os_string()).unwrap_or_else(|| "track".into());
    let mut target = dir.join(&name);
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("track").to_string();
    let ext = src.extension().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    target
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_wav(path: &Path, secs: f64, freq: f64) {
        let rate = 22050u32;
        let n = (secs * rate as f64) as u32;
        let mut f = File::create(path).unwrap();
        let data_len = n * 2;
        f.write_all(b"RIFF").unwrap();
        f.write_all(&(36 + data_len).to_le_bytes()).unwrap();
        f.write_all(b"WAVEfmt ").unwrap();
        f.write_all(&16u32.to_le_bytes()).unwrap();
        f.write_all(&1u16.to_le_bytes()).unwrap();
        f.write_all(&1u16.to_le_bytes()).unwrap();
        f.write_all(&rate.to_le_bytes()).unwrap();
        f.write_all(&(rate * 2).to_le_bytes()).unwrap();
        f.write_all(&2u16.to_le_bytes()).unwrap();
        f.write_all(&16u16.to_le_bytes()).unwrap();
        f.write_all(b"data").unwrap();
        f.write_all(&data_len.to_le_bytes()).unwrap();
        for i in 0..n {
            let s = ((2.0 * std::f64::consts::PI * freq * i as f64 / rate as f64).sin() * 8000.0) as i16;
            f.write_all(&s.to_le_bytes()).unwrap();
        }
    }

    #[test]
    fn imports_files_and_folders_and_skips_duplicates() {
        let src = tempfile::tempdir().unwrap();
        let lib_dir = tempfile::tempdir().unwrap();
        write_wav(&src.path().join("a.wav"), 1.0, 220.0);
        write_wav(&src.path().join("b.wav"), 1.5, 330.0);
        std::fs::copy(src.path().join("a.wav"), src.path().join("a_copy.wav")).unwrap();
        std::fs::write(src.path().join("notes.txt"), "hi").unwrap();

        let lib = Library::in_memory().unwrap();
        let r = lib.import_paths(&[src.path().to_path_buf()], lib_dir.path());
        assert_eq!(r.added.len(), 2, "{r:?}");
        assert_eq!(r.duplicates, 1);
        let tracks = lib.list_tracks().unwrap();
        assert_eq!(tracks.len(), 2);
        assert!(tracks.iter().all(|t| Path::new(&t.path).starts_with(lib_dir.path())));
        assert!((tracks.iter().map(|t| t.duration).fold(0.0, f64::max) - 1.5).abs() < 0.05);

        // Re-importing the same folder adds nothing.
        let r2 = lib.import_paths(&[src.path().to_path_buf()], lib_dir.path());
        assert!(r2.added.is_empty());
    }

    #[test]
    fn corrupt_and_missing_files_are_reported_not_imported() {
        let src = tempfile::tempdir().unwrap();
        let lib_dir = tempfile::tempdir().unwrap();
        let bad = src.path().join("broken.mp3");
        std::fs::write(&bad, vec![7u8; 5000]).unwrap();
        let lib = Library::in_memory().unwrap();
        let r = lib.import_paths(&[bad.clone(), src.path().join("nope.flac")], lib_dir.path());
        assert!(r.added.is_empty());
        assert_eq!(r.failed.len(), 2);
        assert!(lib.list_tracks().unwrap().is_empty());
    }

    #[test]
    fn detects_files_that_disappear() {
        let src = tempfile::tempdir().unwrap();
        let lib_dir = tempfile::tempdir().unwrap();
        write_wav(&src.path().join("a.wav"), 1.0, 220.0);
        let lib = Library::in_memory().unwrap();
        let r = lib.import_paths(&[src.path().join("a.wav")], lib_dir.path());
        let t = lib.get_track(r.added[0]).unwrap().unwrap();
        std::fs::remove_file(&t.path).unwrap();
        assert_eq!(lib.refresh_missing().unwrap(), 1);
        assert!(lib.get_track(t.id).unwrap().unwrap().missing);
    }

    #[test]
    fn playlists_and_favorites_persist_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("lib.db");
        let media = tempfile::tempdir().unwrap();
        write_wav(&media.path().join("a.wav"), 1.0, 220.0);
        write_wav(&media.path().join("b.wav"), 1.0, 330.0);
        write_wav(&media.path().join("c.wav"), 1.0, 440.0);
        let ids;
        let pid;
        {
            let lib = Library::open(&db).unwrap();
            ids = lib.import_paths(&[media.path().to_path_buf()], media.path()).added;
            assert_eq!(ids.len(), 3);
            pid = lib.create_playlist("  Deep Work ").unwrap();
            lib.set_playlist_tracks(pid, &[ids[2], ids[0], ids[2], 9999]).unwrap();
            lib.set_favorite(ids[1], true).unwrap();
            lib.rename_playlist(pid, "Focus").unwrap();
        }
        let lib = Library::open(&db).unwrap();
        let pls = lib.list_playlists().unwrap();
        assert_eq!(pls.len(), 1);
        assert_eq!(pls[0].name, "Focus");
        assert_eq!(pls[0].track_ids, vec![ids[2], ids[0]]);
        assert!(lib.get_track(ids[1]).unwrap().unwrap().favorite);
        lib.set_favorite(ids[1], false).unwrap();
        assert!(!lib.get_track(ids[1]).unwrap().unwrap().favorite);
        lib.remove_track(ids[0], false).unwrap();
        assert_eq!(lib.list_playlists().unwrap()[0].track_ids, vec![ids[2]]);
        lib.delete_playlist(pid).unwrap();
        assert!(lib.list_playlists().unwrap().is_empty());
        assert!(lib.create_playlist("   ").is_err());
    }

    #[test]
    fn albums_can_be_assigned_and_artwork_roundtrips() {
        let media = tempfile::tempdir().unwrap();
        write_wav(&media.path().join("a.wav"), 1.0, 220.0);
        write_wav(&media.path().join("b.wav"), 1.0, 330.0);
        let lib = Library::in_memory().unwrap();
        let ids = lib.import_paths(&[media.path().to_path_buf()], media.path()).added;
        lib.set_album(&ids, " Night Drive ").unwrap();
        assert!(lib.list_tracks().unwrap().iter().all(|t| t.album == "Night Drive"));
        lib.set_album(&ids[..1], "   ").unwrap();
        assert_eq!(lib.list_tracks().unwrap().iter().filter(|t| t.album.is_empty()).count(), 1, "blank clears the album");
        lib.set_album(&ids[..1], "Night Drive").unwrap();
        assert!(!lib.list_tracks().unwrap()[0].has_art);
        let img = media.path().join("cover.jpg");
        std::fs::write(&img, [0xFF, 0xD8, 0xFF, 0xD9]).unwrap();
        lib.set_art(&ids, &img).unwrap();
        assert!(lib.list_tracks().unwrap().iter().all(|t| t.has_art));
        assert!(lib.art_data_url(ids[0]).unwrap().unwrap().starts_with("data:image/jpeg;base64,"));
        std::fs::remove_file(&img).unwrap();
        assert_eq!(lib.art_data_url(ids[0]).unwrap(), None);
    }

    #[test]
    fn songs_can_be_renamed() {
        let media = tempfile::tempdir().unwrap();
        write_wav(&media.path().join("a.wav"), 1.0, 220.0);
        let lib = Library::in_memory().unwrap();
        let id = lib.import_paths(&[media.path().join("a.wav")], media.path()).added[0];
        lib.update_track(id, "  Midnight Piano ", " Me ", "Quiet Hours").unwrap();
        let t = lib.get_track(id).unwrap().unwrap();
        assert_eq!((t.title.as_str(), t.artist.as_str(), t.album.as_str()), ("Midnight Piano", "Me", "Quiet Hours"));
        assert!(lib.update_track(id, "   ", "", "").is_err());
    }

    #[test]
    fn error_log_roundtrip() {
        let lib = Library::in_memory().unwrap();
        lib.log_error(None, "/x.mp3", "decode failed").unwrap();
        assert_eq!(lib.list_errors().unwrap().len(), 1);
        lib.clear_errors().unwrap();
        assert!(lib.list_errors().unwrap().is_empty());
    }
}
