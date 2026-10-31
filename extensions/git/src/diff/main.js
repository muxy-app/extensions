import "@/shared/base.css";
import "@/shared/controls.css";
import "@/diff/diff.css";
import { DiffApp } from "@/diff/app";

const root = document.getElementById("root");
if (root) void new DiffApp(root).start();
