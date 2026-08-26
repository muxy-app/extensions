import { HermesProjectBoard } from "@/board/app";
import "@/styles/board.css";

const root = document.getElementById("root");
if (root) new HermesProjectBoard(root).start();
