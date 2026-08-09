import { TodosPanel } from "@/panel/app";
import "@/styles/global.css";

const root = document.querySelector("#root");
if (root) new TodosPanel(root).start();
