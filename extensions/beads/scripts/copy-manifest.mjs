import { copyFileSync, cpSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

mkdirSync(dist, { recursive: true });
copyFileSync(resolve(root, "package.json"), resolve(dist, "package.json"));

const assets = resolve(root, "assets");
if (existsSync(assets)) {
  cpSync(assets, resolve(dist, "assets"), { recursive: true });
}

console.log("package.json and assets copied to dist/");
