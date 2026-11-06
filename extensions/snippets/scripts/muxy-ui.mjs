// Locates @muxy/ui (shared/ui from github.com/muxy-app/extensions).
//
// Inside the marketplace monorepo it is ../../shared/ui, exactly like every other
// extension. In a standalone checkout of this repo, `npm run setup:ui` fetches it
// into .muxy-ui/ (git-ignored). MUXY_UI_DIR overrides both.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const projectRoot = resolve(import.meta.dirname, "..");

export const candidates = [
  process.env.MUXY_UI_DIR && resolve(process.env.MUXY_UI_DIR),
  resolve(projectRoot, "../../shared/ui"),
  resolve(projectRoot, ".muxy-ui/shared/ui"),
].filter(Boolean);

export function findMuxyUi() {
  return candidates.find((dir) => existsSync(resolve(dir, "ui.css"))) || null;
}

export function requireMuxyUi() {
  const dir = findMuxyUi();
  if (!dir) {
    throw new Error(
      "@muxy/ui not found. Run `npm run setup:ui` (or set MUXY_UI_DIR). Looked in:\n  " + candidates.join("\n  "),
    );
  }
  return dir;
}
