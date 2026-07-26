#!/usr/bin/env node
// Analyses one or more local extensions and prints a short Markdown security
// report. The pull_request_target workflow uses security-comment-ci.mjs
// instead, which fetches PR files through the GitHub API without checking out
// or executing fork code.

import fs from "node:fs";
import path from "node:path";
import {
  extensionsDir,
  extensionDir,
  listExtensionNames,
  packageJSONPath,
} from "./lib/paths.mjs";
import {
  analyseExtensionData,
  isScannableSourcePath,
  renderSecurityComment,
} from "./lib/security-report.mjs";

function collectScriptFiles(dir) {
  const files = [];
  let skippedSourceFiles = 0;

  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(dir, fullPath).split(path.sep).join("/");

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") {
          walk(fullPath);
        }
        continue;
      }
      if (!isScannableSourcePath(relativePath)) continue;
      if (!entry.isFile()) {
        skippedSourceFiles += 1;
        continue;
      }
      files.push({
        path: relativePath,
        content: fs.readFileSync(fullPath, "utf8"),
      });
    }
  };

  walk(dir);
  return { files, skippedSourceFiles };
}

function analyseLocalExtension(name) {
  const dir = extensionDir(name);
  const packagePath = packageJSONPath(dir);
  if (!fs.existsSync(packagePath)) return null;

  const packageJSON = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const { files, skippedSourceFiles } = collectScriptFiles(dir);
  return analyseExtensionData({
    name,
    packageJSON,
    files,
    skippedSourceFiles,
  });
}

function targets(argv) {
  const explicit = argv.filter((argument) => !argument.startsWith("-"));
  return explicit.length > 0 ? explicit : listExtensionNames();
}

function main() {
  if (!fs.existsSync(extensionsDir)) {
    process.stdout.write(`${renderSecurityComment([])}\n`);
    return;
  }
  const extensions = targets(process.argv.slice(2))
    .map(analyseLocalExtension)
    .filter(Boolean);
  process.stdout.write(`${renderSecurityComment(extensions)}\n`);
}

main();
