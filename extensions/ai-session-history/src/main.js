import { SessionsPanel } from "@/panel/app";
import "@/styles/global.css";

const root = document.getElementById("root");
if (root) {
  const app = new SessionsPanel(root);
  app.start();
  window.addEventListener("pagehide", () => app.dispose(), { once: true });
}
