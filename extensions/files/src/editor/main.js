import "@/styles.css";
import { EditorApp } from "@/editor/editor";
import { publish_pointer_over_panel, watch_pointer_over_panel } from "@/lib/pointer-guard";

const root = document.getElementById("root");
if (root) {
  const app = new EditorApp(root);
  app.start();
  const stopPointerGuard = watch_pointer_over_panel((over) => {
    document.documentElement.classList.toggle("files-pointer-guard", over);
  });
  const clearPointerGuard = () => publish_pointer_over_panel(false);
  window.addEventListener("mousedown", clearPointerGuard, true);
  window.addEventListener("pagehide", () => {
    window.removeEventListener("mousedown", clearPointerGuard, true);
    stopPointerGuard();
    app.dispose();
  }, { once: true });
}
