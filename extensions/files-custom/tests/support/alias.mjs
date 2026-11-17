// Lets tests import app modules that use Vite's "@/..." alias for src/.
import { registerHooks } from "node:module";

const SRC = new URL("../../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const path = specifier.slice(2);
      return next(new URL(path.endsWith(".js") ? path : `${path}.js`, SRC).href, context);
    }
    return next(specifier, context);
  },
});
