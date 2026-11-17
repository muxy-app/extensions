import "@/shared/base.css";
import "@/panel/panel.css";
import { FilesPanel } from "@/panel/panel";

const root = document.getElementById("root");
if (root) {
  const panel = new FilesPanel(root);
  panel.start();
  window.addEventListener("pagehide", () => panel.dispose(), { once: true });
}
