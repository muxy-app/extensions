import "@muxy/ui/ui.css";
import "@/styles/global.css";
import "./panel.css";
import { SnippetsPanel } from "./app.js";

const root = document.getElementById("root");
if (root) new SnippetsPanel(root).start();
