// Lets Node load the extension's source the way Vite does: resolves the `@/`
// and `@muxy/ui` aliases and turns CSS imports into empty modules.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
