import "@/shared/base.css";
import "@/shared/controls.css";
import "@/create-pr/create-pr.css";
import "@/panel/panel.css";
import { PanelApp } from "@/panel/app";

const root = document.getElementById("root");
if (root) new PanelApp(root).start();
