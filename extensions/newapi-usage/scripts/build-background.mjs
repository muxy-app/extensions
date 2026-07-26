import { copyFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

// Copy background.js to dist
await mkdir(dist, { recursive: true });
await copyFile(
	resolve(root, "src/background.js"),
	resolve(dist, "background.js"),
);

// Copy assets/ to dist/assets/
const srcAssets = resolve(root, "src/assets");
const distAssets = resolve(dist, "assets");
try {
	const files = await readdir(srcAssets);
	await mkdir(distAssets, { recursive: true });
	for (const f of files) {
		await copyFile(resolve(srcAssets, f), resolve(distAssets, f));
	}
	console.log(`✅ ${files.length} asset(s) copied to dist/assets/`);
} catch {
	// src/assets may not exist
}

console.log("✅ background.js copied to dist/");
