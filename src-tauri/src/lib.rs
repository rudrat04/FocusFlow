mod audio;
mod awake;
mod dsp;
mod library;
mod loudness;
mod media;
mod ytdl;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

use audio::{Engine, PlayInfo};
use library::{ErrorLogEntry, ImportReport, Library, Playlist, Track};

type Res<T> = Result<T, String>;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct Config {
    library_dir: Option<String>,
}

struct AppState {
    engine: Option<Arc<Engine>>,
    engine_error: Option<String>,
    lib: Arc<Library>,
    data_dir: PathBuf,
    config: Mutex<Config>,
    awake: Mutex<awake::KeepAwake>,
    media: Option<media::Media>,
    hide_on_close: AtomicBool,
    analyzing: AtomicBool,
    ui_mask: std::sync::atomic::AtomicU32,
}

impl AppState {
    fn engine(&self) -> Res<&Arc<Engine>> {
        self.engine
            .as_ref()
            .ok_or_else(|| format!("audio engine unavailable: {}", self.engine_error.clone().unwrap_or_default()))
    }

    fn library_dir(&self) -> PathBuf {
        let cfg = self.config.lock().unwrap();
        match &cfg.library_dir {
            Some(d) if !d.is_empty() => PathBuf::from(d),
            _ => default_library_dir(),
        }
    }
}

fn default_library_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(".")).join("Music").join("FocusFlow")
}

fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

// ------------------------------------------------------------------ engine

#[tauri::command]
async fn engine_play(state: State<'_, AppState>, path: String, start: f64, fade_secs: f32, duration_hint: f64, gain_db: f64) -> Res<PlayInfo> {
    state.engine()?.play(&path, start, fade_secs, duration_hint, gain_db)
}

#[tauri::command]
async fn engine_set_next(state: State<'_, AppState>, path: Option<String>, duration_hint: f64, gain_db: f64) -> Res<()> {
    state.engine()?.set_next(path.as_deref(), duration_hint, gain_db)
}

#[tauri::command]
async fn engine_pause(state: State<'_, AppState>) -> Res<()> {
    state.engine()?.pause();
    Ok(())
}

#[tauri::command]
async fn engine_resume(state: State<'_, AppState>) -> Res<()> {
    state.engine()?.resume();
    Ok(())
}

#[tauri::command]
async fn engine_stop(state: State<'_, AppState>) -> Res<()> {
    state.engine()?.stop();
    Ok(())
}

#[tauri::command]
async fn engine_seek(state: State<'_, AppState>, secs: f64) -> Res<()> {
    state.engine()?.seek(secs)
}

#[tauri::command]
async fn engine_set_volume(state: State<'_, AppState>, volume: f32, muted: bool) -> Res<()> {
    state.engine()?.set_volume(volume, muted);
    Ok(())
}

#[tauri::command]
async fn engine_set_crossfade(state: State<'_, AppState>, secs: f32) -> Res<()> {
    state.engine()?.set_crossfade(secs);
    Ok(())
}

#[tauri::command]
async fn engine_set_spatial(state: State<'_, AppState>, mode: String, amount: f32) -> Res<()> {
    state.engine()?.set_spatial(&mode, amount);
    Ok(())
}

#[tauri::command]
async fn engine_fade_out(state: State<'_, AppState>, secs: f32) -> Res<()> {
    state.engine()?.fade_out_and_stop(secs);
    Ok(())
}

#[tauri::command]
async fn engine_cancel_fade(state: State<'_, AppState>) -> Res<()> {
    state.engine()?.cancel_fade();
    Ok(())
}

/// Each window reports whether it is visible; the engine reports progress often while any is.
#[tauri::command]
async fn engine_set_ui_active(state: State<'_, AppState>, window: String, active: bool) -> Res<()> {
    let bit = if window == "mini" { 2 } else { 1 };
    let mask = if active { state.ui_mask.fetch_or(bit, Ordering::AcqRel) | bit } else { state.ui_mask.fetch_and(!bit, Ordering::AcqRel) & !bit };
    state.engine()?.set_ui_active(mask != 0);
    Ok(())
}

#[tauri::command]
async fn engine_set_resume_after_wake(state: State<'_, AppState>, on: bool) -> Res<()> {
    state.engine()?.set_resume_after_wake(on);
    Ok(())
}

#[tauri::command]
async fn engine_set_normalize(state: State<'_, AppState>, on: bool) -> Res<()> {
    state.engine()?.set_normalize(on);
    Ok(())
}

#[tauri::command]
async fn engine_status(state: State<'_, AppState>) -> Res<serde_json::Value> {
    Ok(serde_json::json!({
        "available": state.engine.is_some(),
        "error": state.engine_error,
        "device": state.engine.as_ref().map(|e| e.device()).unwrap_or_default(),
        "channels": state.engine.as_ref().map(|e| e.channels()).unwrap_or(2),
    }))
}

// ------------------------------------------------------------------ library

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Paths {
    library_dir: String,
    data_dir: String,
}

#[tauri::command]
async fn get_paths(state: State<'_, AppState>) -> Res<Paths> {
    Ok(Paths { library_dir: state.library_dir().to_string_lossy().into(), data_dir: state.data_dir.to_string_lossy().into() })
}

#[tauri::command]
async fn set_library_dir(state: State<'_, AppState>, path: String) -> Res<()> {
    let p = PathBuf::from(&path);
    std::fs::create_dir_all(&p).map_err(|e| format!("cannot use that folder: {e}"))?;
    let mut cfg = state.config.lock().unwrap();
    cfg.library_dir = Some(path);
    let json = serde_json::to_vec_pretty(&*cfg).map_err(|e| e.to_string())?;
    write_atomic(&state.data_dir.join("config.json"), &json).map_err(|e| e.to_string())
}

#[tauri::command]
async fn lib_list_tracks(state: State<'_, AppState>) -> Res<Vec<Track>> {
    state.lib.list_tracks()
}

#[tauri::command]
async fn lib_import(state: State<'_, AppState>, paths: Vec<String>) -> Res<ImportReport> {
    let dir = state.library_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let lib = state.lib.clone();
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || lib.import_paths(&paths, &dir)).await.map_err(|e| e.to_string())
}

/// Imports anything dropped into the library folder by hand.
#[tauri::command]
async fn lib_scan(state: State<'_, AppState>) -> Res<ImportReport> {
    let dir = state.library_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let lib = state.lib.clone();
    tauri::async_runtime::spawn_blocking(move || lib.import_paths(&[dir.clone()], &dir)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn lib_remove(state: State<'_, AppState>, id: i64, delete_file: bool) -> Res<()> {
    state.lib.remove_track(id, delete_file)
}

#[tauri::command]
async fn lib_set_favorite(state: State<'_, AppState>, id: i64, favorite: bool) -> Res<()> {
    state.lib.set_favorite(id, favorite)
}

#[tauri::command]
async fn lib_set_album(state: State<'_, AppState>, ids: Vec<i64>, album: String) -> Res<()> {
    state.lib.set_album(&ids, &album)
}

#[tauri::command]
async fn lib_update_track(state: State<'_, AppState>, id: i64, title: String, artist: String, album: String) -> Res<()> {
    state.lib.update_track(id, &title, &artist, &album)
}

unsafe extern "C" {
    fn pthread_set_qos_class_self_np(qos_class: u32, relative_priority: i32) -> i32;
}
const QOS_CLASS_BACKGROUND: u32 = 0x09;

/// Measures the loudness of tracks that have none, on a background-priority thread (macOS keeps
/// that on the efficiency cores). Emits `analysis` progress and `analysis-done`.
#[tauri::command]
async fn lib_analyze_pending(app: AppHandle, state: State<'_, AppState>) -> Res<()> {
    if state.analyzing.swap(true, Ordering::AcqRel) {
        return Ok(()); // already running
    }
    let lib = state.lib.clone();
    std::thread::Builder::new()
        .name("ff-loudness".into())
        .spawn(move || {
            unsafe { pthread_set_qos_class_self_np(QOS_CLASS_BACKGROUND, 0) };
            let handle = app.clone();
            let total = loudness::analyze_pending(&lib, |done, total| {
                let _ = handle.emit("analysis", serde_json::json!({ "done": done, "total": total }));
                std::thread::sleep(std::time::Duration::from_millis(40)); // be gentle between files
            });
            if let Some(s) = app.try_state::<AppState>() {
                s.analyzing.store(false, Ordering::Release);
            }
            let _ = app.emit("analysis-done", total);
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn lib_get_art(state: State<'_, AppState>, id: i64) -> Res<Option<String>> {
    state.lib.art_data_url(id)
}

#[tauri::command]
async fn lib_refresh_missing(state: State<'_, AppState>) -> Res<usize> {
    state.lib.refresh_missing()
}

#[tauri::command]
async fn lib_mark_missing(state: State<'_, AppState>, id: i64, missing: bool) -> Res<()> {
    state.lib.mark_missing(id, missing)
}

#[tauri::command]
async fn pl_list(state: State<'_, AppState>) -> Res<Vec<Playlist>> {
    state.lib.list_playlists()
}

#[tauri::command]
async fn pl_create(state: State<'_, AppState>, name: String) -> Res<i64> {
    state.lib.create_playlist(&name)
}

#[tauri::command]
async fn pl_rename(state: State<'_, AppState>, id: i64, name: String) -> Res<()> {
    state.lib.rename_playlist(id, &name)
}

#[tauri::command]
async fn pl_delete(state: State<'_, AppState>, id: i64) -> Res<()> {
    state.lib.delete_playlist(id)
}

#[tauri::command]
async fn pl_set_tracks(state: State<'_, AppState>, id: i64, track_ids: Vec<i64>) -> Res<()> {
    state.lib.set_playlist_tracks(id, &track_ids)
}

#[tauri::command]
async fn err_log(state: State<'_, AppState>, track_id: Option<i64>, path: String, message: String) -> Res<()> {
    state.lib.log_error(track_id, &path, &message)
}

#[tauri::command]
async fn err_list(state: State<'_, AppState>) -> Res<Vec<ErrorLogEntry>> {
    state.lib.list_errors()
}

#[tauri::command]
async fn err_clear(state: State<'_, AppState>) -> Res<()> {
    state.lib.clear_errors()
}

// ------------------------------------------------------------------ persistence

fn kv_path(state: &AppState, name: &str) -> Res<PathBuf> {
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("invalid key".into());
    }
    Ok(state.data_dir.join(format!("{name}.json")))
}

#[tauri::command]
async fn kv_load(state: State<'_, AppState>, name: String) -> Res<Option<serde_json::Value>> {
    let p = kv_path(&state, &name)?;
    match std::fs::read(&p) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(v) => Ok(Some(v)),
            Err(_) => {
                // Corrupt file: keep it for inspection and start fresh.
                let _ = std::fs::rename(&p, p.with_extension("corrupt"));
                Ok(None)
            }
        },
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn kv_save(state: State<'_, AppState>, name: String, value: serde_json::Value) -> Res<()> {
    let p = kv_path(&state, &name)?;
    let bytes = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    write_atomic(&p, &bytes).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ system

/// Tells macOS what is playing, so media keys, Bluetooth headsets and Control Center control FocusFlow.
#[tauri::command]
async fn media_set_now_playing(state: State<'_, AppState>, track_id: Option<i64>, playing: bool, loaded: bool, position: f64) -> Res<()> {
    let Some(media) = &state.media else { return Ok(()) };
    let track = match track_id {
        Some(id) => state.lib.get_track(id)?,
        None => None,
    };
    let cover = track_id.and_then(|id| state.lib.art_path(id).ok().flatten());
    media.set_now_playing(
        track.as_ref().map(|t| t.title.as_str()),
        track.as_ref().map(|t| t.artist.as_str()).filter(|s| !s.is_empty()),
        track.as_ref().map(|t| t.album.as_str()).filter(|s| !s.is_empty()),
        track.as_ref().map(|t| t.duration).unwrap_or(0.0),
        cover.as_deref(),
        playing,
        loaded,
        position,
    );
    Ok(())
}

#[tauri::command]
async fn set_keep_awake(state: State<'_, AppState>, on: bool) -> Res<bool> {
    let mut a = state.awake.lock().unwrap();
    a.set(on)?;
    Ok(a.is_active())
}

// ------------------------------------------------------------------ mini-player

/// Opens (or focuses) the small floating player. The window exists only while it is open.
#[tauri::command]
async fn mini_open(app: AppHandle) -> Res<()> {
    if let Some(w) = app.get_webview_window("mini") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "mini", tauri::WebviewUrl::App("index.html".into()))
        .title("FocusFlow")
        .inner_size(400.0, 148.0)
        .resizable(false)
        .maximizable(false)
        .always_on_top(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn mini_close(app: AppHandle) -> Res<()> {
    if let Some(w) = app.get_webview_window("mini") {
        w.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn mini_exists(app: AppHandle) -> Res<bool> {
    Ok(app.get_webview_window("mini").is_some())
}

#[tauri::command]
async fn mini_set_pinned(app: AppHandle, pinned: bool) -> Res<()> {
    if let Some(w) = app.get_webview_window("mini") {
        w.set_always_on_top(pinned).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Shows (or clears) the current song next to the menu-bar icon.
#[tauri::command]
async fn set_tray_title(app: AppHandle, title: Option<String>) -> Res<()> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_title(title).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn set_hide_on_close(state: State<'_, AppState>, on: bool) -> Res<()> {
    state.hide_on_close.store(on, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn quit_app(app: AppHandle) -> Res<()> {
    app.exit(0);
    Ok(())
}

/// Opt-in end-to-end self-test: only active when launched with FOCUSFLOW_SELFTEST_OUT set.
#[tauri::command]
async fn selftest_info() -> Res<Option<serde_json::Value>> {
    Ok(std::env::var("FOCUSFLOW_SELFTEST_OUT").ok().map(|out| {
        serde_json::json!({
            "out": out,
            "media": std::env::var("FOCUSFLOW_SELFTEST_MEDIA").unwrap_or_default(),
            "lib": std::env::var("FOCUSFLOW_SELFTEST_LIB").unwrap_or_default(),
            "bench": std::env::var("FOCUSFLOW_BENCH").unwrap_or_default(),
        })
    }))
}

#[tauri::command]
async fn selftest_write(out: String, text: String) -> Res<()> {
    std::fs::write(out, text).map_err(|e| e.to_string())
}

#[tauri::command]
async fn selftest_remove(path: String) -> Res<()> {
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn yt_tools() -> Res<ytdl::ToolStatus> {
    Ok(ytdl::tool_status())
}

/// Upgrades yt-dlp through Homebrew. Runs only when the user presses "Update yt-dlp".
#[tauri::command]
async fn yt_update() -> Res<String> {
    tauri::async_runtime::spawn_blocking(ytdl::update_ytdlp).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn yt_import(app: AppHandle, state: State<'_, AppState>, url: String, manual_chapters: Option<String>, auto_split: Option<bool>) -> Res<Vec<i64>> {
    let dir = state.library_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let lib = state.lib.clone();
    let a2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let opts = ytdl::Options { manual_chapters: manual_chapters.as_deref(), auto_split: auto_split.unwrap_or(true) };
        ytdl::import(&lib, &dir, &url, &opts, &|p| {
            let _ = a2.emit("yt-progress", p);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ------------------------------------------------------------------ app

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            // FOCUSFLOW_DATA_DIR lets the self-test run against an isolated, throwaway data folder.
            let data_dir = match std::env::var_os("FOCUSFLOW_DATA_DIR") {
                Some(d) => PathBuf::from(d),
                None => app.path().app_data_dir().map_err(|e| e.to_string())?,
            };
            std::fs::create_dir_all(&data_dir)?;
            let config: Config = std::fs::read(data_dir.join("config.json"))
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
            let lib = Arc::new(Library::open(&data_dir.join("library.db"))?);

            let emit_handle = handle.clone();
            let (engine, engine_error) = match Engine::start(Arc::new(move |ev| {
                let _ = emit_handle.emit("engine", ev);
            })) {
                Ok(e) => (Some(Arc::new(e)), None),
                Err(e) => (None, Some(e)),
            };
            let media = match media::Media::start(handle.clone(), engine.clone()) {
                Ok(m) => Some(m),
                Err(e) => {
                    eprintln!("media controls unavailable: {e}");
                    None
                }
            };
            app.manage(AppState {
                engine,
                media,
                engine_error,
                lib,
                data_dir,
                config: Mutex::new(config),
                awake: Mutex::new(awake::KeepAwake::default()),
                hide_on_close: AtomicBool::new(true),
                analyzing: AtomicBool::new(false),
                ui_mask: std::sync::atomic::AtomicU32::new(1),
            });

            let show = MenuItem::with_id(app, "show", "Show FocusFlow", true, None::<&str>)?;
            let mini = MenuItem::with_id(app, "mini", "Mini player", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Play / Pause", true, None::<&str>)?;
            let prev = MenuItem::with_id(app, "prev", "Previous", true, None::<&str>)?;
            let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit FocusFlow", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show, &mini, &sep, &toggle, &prev, &next, &sep, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().ok_or("missing icon")?)
                .icon_as_template(false)
                .tooltip("FocusFlow")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main(app),
                    "mini" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = mini_open(app).await;
                        });
                    }
                    "quit" => app.exit(0),
                    other => {
                        let _ = app.emit("tray-action", other.to_string());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                let hide = window.app_handle().state::<AppState>().hide_on_close.load(Ordering::Relaxed);
                if hide {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            engine_play,
            engine_set_next,
            engine_pause,
            engine_resume,
            engine_stop,
            engine_seek,
            engine_set_volume,
            engine_set_crossfade,
            engine_set_spatial,
            engine_fade_out,
            engine_cancel_fade,
            engine_status,
            engine_set_ui_active,
            engine_set_normalize,
            engine_set_resume_after_wake,
            get_paths,
            set_library_dir,
            lib_list_tracks,
            lib_import,
            lib_scan,
            lib_remove,
            lib_set_favorite,
            lib_set_album,
            lib_get_art,
            lib_analyze_pending,
            lib_update_track,
            lib_refresh_missing,
            lib_mark_missing,
            pl_list,
            pl_create,
            pl_rename,
            pl_delete,
            pl_set_tracks,
            err_log,
            err_list,
            err_clear,
            kv_load,
            kv_save,
            media_set_now_playing,
            set_keep_awake,
            set_hide_on_close,
            mini_open,
            mini_close,
            mini_exists,
            mini_set_pinned,
            set_tray_title,
            quit_app,
            yt_tools,
            yt_update,
            selftest_info,
            selftest_write,
            selftest_remove,
            yt_import,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| match event {
        tauri::RunEvent::Reopen { .. } => show_main(app),
        tauri::RunEvent::Exit => {
            if let Some(s) = app.try_state::<AppState>() {
                let _ = s.awake.lock().map(|mut a| a.set(false));
                if let Some(e) = &s.engine {
                    e.shutdown();
                }
            }
        }
        _ => {}
    });
}
