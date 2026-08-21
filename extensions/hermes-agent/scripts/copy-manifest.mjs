import { cp, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await mkdir(dist, { recursive: true });
await copyFile(resolve(root, "package.json"), resolve(dist, "package.json"));
await copyFile(resolve(root, "README.md"), resolve(dist, "README.md"));
await copyFile(resolve(root, "OPEN_ISSUES.md"), resolve(dist, "OPEN_ISSUES.md"));
await cp(resolve(root, "assets"), resolve(dist, "assets"), { recursive: true });
