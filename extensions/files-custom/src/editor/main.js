// Editor tab bootstrap: start reading the file right away, in parallel with
// whatever view code the file still needs (markdown, PDF, …).

import "@/shared/base.css";
import "./editor.css";
import { read_string, remove_key, watch_key } from "@/shared/prefs";
import { is_binary_kind, kind_of } from "./kinds";
import { EditorApp } from "./app";

const POINTER_KEY = "muxy.files.pointer-over-panel";

const root = document.getElementById("root");
if (root) {
  const path = muxy.data?.filePath || null;
  const kind = kind_of(path);
  const firstRead = path && !is_binary_kind(kind) ? { path, promise: muxy.files.read(path) } : null;
  // Swallow an early rejection here; the app reports it when it awaits the read.
  firstRead?.promise.catch(() => undefined);
  if (kind === "markdown") void import("./viewers/markdown-editor");

  // While the pointer is over the floating files panel, this page must not
  // show its text cursor through it (the panel publishes the flag).
  const html = document.documentElement;
  const syncGuard = () => html.classList.toggle("files-pointer-guard", read_string(POINTER_KEY) === "1");
  const stopGuard = watch_key(POINTER_KEY, syncGuard);
  syncGuard();
  const clearGuard = () => {
    if (read_string(POINTER_KEY) !== "1") return;
    remove_key(POINTER_KEY);
    syncGuard();
  };
  window.addEventListener("mousedown", clearGuard, true);

  const app = new EditorApp(root, { firstRead });
  app.start();
  window.addEventListener(
    "pagehide",
    () => {
      window.removeEventListener("mousedown", clearGuard, true);
      stopGuard();
      app.dispose();
    },
    { once: true },
  );
}
