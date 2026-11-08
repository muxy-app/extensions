import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { projectRoot, requireMuxyUi } from "../../scripts/muxy-ui.mjs";

const ui = requireMuxyUi();
const SUBPATHS = { "@muxy/ui": "index.js", "@muxy/ui/ui.css": "ui.css", "@muxy/ui/tokens.css": "tokens.css" };

export async function resolve(specifier, context, next) {
  if (specifier in SUBPATHS) {
    return { url: pathToFileURL(resolvePath(ui, SUBPATHS[specifier])).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    return { url: pathToFileURL(resolvePath(projectRoot, "src", specifier.slice(2))).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.split("?")[0].endsWith(".css")) return { format: "module", source: "export default '';", shortCircuit: true };
  return next(url, context);
}
