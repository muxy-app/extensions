// Entry for the `quick-run` runScript command. Bundled to dist/quick-run.js
// by vite.quick-run.config.js as a single classic script.
import { quickRun } from "./quick-run.js";

quickRun().catch((err) => console.error("[snippets] quick run failed:", err));
