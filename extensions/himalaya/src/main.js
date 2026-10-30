import "@muxy/ui/ui.css";
import "@/styles/global.css";
import { MailPanel } from "@/panel/app";

const root = document.getElementById("root");
if (root) new MailPanel(root).start();
