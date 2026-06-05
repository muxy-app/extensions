import { GitPanelApp } from "@/panel/app";
import "@/styles/global.css";

const root = document.getElementById("root");
if (root) new GitPanelApp(root).start();
