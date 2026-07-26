import { tryRun } from "./exec.js";

const SCRIPT = ["on run(argv)", "set the clipboard to (item 1 of argv)", "end run"];

export async function copyToClipboard(text) {
    await tryRun(["osascript", ...SCRIPT.flatMap((line) => ["-e", line]), String(text)]);
}
