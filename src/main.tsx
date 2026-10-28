import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MiniApp } from "./MiniApp";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";

async function boot() {
  // In a plain browser (design preview) there is no Tauri backend; install a small mock.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    await (await import("./dev/mock")).installMock();
  }
  const mini = new URLSearchParams(location.search).has("mini") || (() => { try { return getCurrentWindow().label === "mini"; } catch { return false; } })();
  if (mini) document.body.classList.add("mini-body");
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {mini ? <MiniApp /> : <App />}
    </React.StrictMode>,
  );
}
void boot().then(() => {
  if (import.meta.env.DEV && !location.search.includes("mini")) void import("./dev/shots").then((m) => m.run());
});
