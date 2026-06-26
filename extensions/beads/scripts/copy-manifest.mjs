import { copyFileSync, cpSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

mkdirSync(dist, { recursive: true });
copyFileSync(resolve(root, "package.json"), resolve(dist, "package.json"));

const icon = resolve(root, "icon.svg");
if (existsSync(icon)) {
  copyFileSync(icon, resolve(dist, "icon.svg"));
}

const screenshots = resolve(root, "screenshots");
if (existsSync(screenshots)) {
  cpSync(screenshots, resolve(dist, "screenshots"), { recursive: true });
}

console.log("package.json, icon.svg, and screenshots copied to dist/");
