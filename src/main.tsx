import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

async function boot() {
  // In a plain browser (design preview) there is no Tauri backend; install a small mock.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    await (await import("./dev/mock")).installMock();
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void boot();
