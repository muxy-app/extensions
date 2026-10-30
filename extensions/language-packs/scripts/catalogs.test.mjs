import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

for (const { language, bundle } of manifest.muxy.localizations) {
  test(`${language}: bundle and catalogs have valid property-list syntax`, {
    skip: process.platform !== "darwin" && "requires macOS plutil",
  }, () => {
    const directory = path.join(root, bundle);
    const catalogs = path.join(directory, `${language}.lproj`);
    const files = [
      path.join(directory, "Info.plist"),
      path.join(catalogs, "Localizable.strings"),
    ];
    const plurals = path.join(catalogs, "Localizable.stringsdict");
    if (fs.existsSync(plurals)) files.push(plurals);
    const result = spawnSync("/usr/bin/plutil", ["-lint", ...files], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });
}
