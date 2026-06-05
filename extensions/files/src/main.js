import "@/styles.css";
import { FilesPanelApp } from "@/panel/files-panel";

const root = document.getElementById("root");
if (root) {
  const app = new FilesPanelApp(root);
  app.start();
  window.addEventListener("pagehide", () => app.dispose(), { once: true });
}
