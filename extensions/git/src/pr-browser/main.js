import "@/shared/base.css";
import "@/shared/controls.css";
import "@/pr-browser/pr-browser.css";
import { PrBrowser } from "@/pr-browser/app";

const root = document.getElementById("root");
if (root) void new PrBrowser(root).start();
