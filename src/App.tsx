import { useEffect } from "react";
import { player, usePlayer, type View } from "./lib/player";
import { Scene } from "./components/Scene";
import { Icon, Logo } from "./components/Icons";
import { ImportLink } from "./components/ImportLink";
import { BottomBar } from "./components/BottomBar";
import { NowPlaying } from "./views/NowPlaying";
import { Library } from "./views/Library";
import { Albums } from "./views/Albums";
import { Playlists } from "./views/Playlists";
import { Favorites } from "./views/Favorites";
import { SettingsView } from "./views/Settings";
import { TrackPage } from "./views/TrackPage";
import { maybeRunSelfTest } from "./lib/selftest";
import { api } from "./lib/api";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "now", label: "Now Playing", icon: "now" },
  { id: "library", label: "Songs", icon: "library" },
  { id: "albums", label: "Albums", icon: "album" },
  { id: "playlists", label: "Playlists", icon: "playlists" },
  { id: "favorites", label: "Favorites", icon: "heartNav" },
  { id: "settings", label: "Settings", icon: "gear" },
];

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") return;
      if (t.tagName === "TEXTAREA") return;
      const st = player.getSnapshot();
      const meta = e.metaKey || e.ctrlKey;
      switch (e.code) {
        case "Space": e.preventDefault(); void player.togglePlay(); break;
        case "ArrowRight": e.preventDefault(); if (meta) void player.next(); else void player.seek(st.position + 10); break;
        case "ArrowLeft": e.preventDefault(); if (meta) void player.prev(); else void player.seek(st.position - 10); break;
        case "ArrowUp": if (t.tagName !== "INPUT") { e.preventDefault(); player.setVolume(st.settings.volume + 0.05); } break;
        case "ArrowDown": if (t.tagName !== "INPUT") { e.preventDefault(); player.setVolume(st.settings.volume - 0.05); } break;
        case "KeyM": player.toggleMute(); break;
        case "KeyS": if (!meta) player.toggleShuffle(); break;
        case "KeyR": if (!meta) player.cycleRepeat(); break;
        case "KeyF": {
          const id = st.queue.index >= 0 ? st.queue.items[st.queue.index] : null;
          if (id !== null && !meta) void player.toggleFavorite(id);
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function App() {
  const st = usePlayer();
  useShortcuts();
  // Tell the engine when the window is hidden so it can report progress far less often.
  useEffect(() => {
    const tell = () => void api.engineSetUiActive("main", !document.hidden).catch(() => {});
    document.addEventListener("visibilitychange", tell);
    tell();
    return () => document.removeEventListener("visibilitychange", tell);
  }, []);
  useEffect(() => { void player.init().then(() => maybeRunSelfTest()); }, []);
  const { view, toasts, search } = st;
  const navOn = view === "track" ? "library" : view;

  return (
    <>
      <Scene themeId={st.settings.theme} />
      <div className="drag" data-tauri-drag-region />
      <div className="app">
        <nav className="glass sidebar" aria-label="Sections">
          <div className="brand"><Logo />FocusFlow</div>
          <div className="side-search">
            <Icon name="search" />
            <input placeholder="Search" aria-label="Search your music" value={search} onChange={(e) => player.setSearch(e.target.value)} />
            {search && <button aria-label="Clear search" onClick={() => player.setSearch("")}><Icon name="x" /></button>}
          </div>
          {NAV.map((n) => (
            <button key={n.id} className={`nav ${navOn === n.id ? "on" : ""}`} aria-current={navOn === n.id ? "page" : undefined} onClick={() => player.setView(n.id)}>
              <Icon name={n.icon} />{n.label}
            </button>
          ))}
          <div className="tagline">Better focus.<br />Deeper work.<br />Every hour.</div>
        </nav>

        <main className="main">
          <div className="view">
            {st.engineError && <div className="toast error" style={{ margin: "40px 14px 12px", cursor: "default" }}>Audio engine unavailable: {st.engineError}</div>}
            {!st.ready ? <div className="np2"><div className="np2-main" style={{ justifyContent: "center" }}><div className="np-sub">Loading…</div></div></div> :
              view === "now" ? <NowPlaying /> :
              view === "library" ? <Library /> :
              view === "albums" ? <Albums /> :
              view === "playlists" ? <Playlists /> :
              view === "favorites" ? <Favorites /> :
              view === "track" ? <TrackPage /> : <SettingsView />}
          </div>
        </main>

        <BottomBar />
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} onClick={() => player.dismissToast(t.id)}>{t.text}</div>)}
      </div>
      <ImportLink />
    </>
  );
}
