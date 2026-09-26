// Refreshes the vendored copy of Muxy's own extension-authoring skill, which
// coding agents in this repo read before touching the manifest or runtime.
// The copies are gitignored — run `npm run update-skill` to recreate them.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const SKILL_URL =
  "https://raw.githubusercontent.com/muxy-app/muxy/main/Muxy/Resources/skills/muxy-extension/SKILL.md";
const TARGETS = [".claude/skills/muxy-extension", ".agents/skills/muxy-extension"];

const root = resolve(import.meta.dirname, "..");

const response = await fetch(SKILL_URL);
if (!response.ok) {
  console.error(`Failed to update skill: HTTP ${response.status}`);
  process.exit(1);
}
const skill = await response.text();

for (const target of TARGETS) {
  const dir = resolve(root, target);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skill);
  console.log(`Updated ${join(target, "SKILL.md")}`);
}
