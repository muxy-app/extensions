import { copyFileSync } from "node:fs";

copyFileSync("package.json", "dist/package.json");
