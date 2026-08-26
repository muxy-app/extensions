import { ControlTowerApp } from "@/panel/app.js";
import "@/styles/global.css";

const root = document.getElementById("root");
if (root) {
  const app = new ControlTowerApp(root);
  app.start();
}
