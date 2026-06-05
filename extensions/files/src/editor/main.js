import "@/styles.css";
import { EditorApp } from "@/editor/editor";

const root = document.getElementById("root");
if (root) {
  const app = new EditorApp(root);
  app.start();
  window.addEventListener("pagehide", () => app.dispose(), { once: true });
}
