#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildOutputDir,
  extensionDir,
  listExtensionNames,
  packageJSONPath,
  readPackageManifest,
  referencedBuildFiles,
  resolveInside,
} from "./lib/paths.mjs";

const BUILD_TIMEOUT_MS = 5 * 60 * 1000;

function fail(name, message) {
  console.log(`::error::[${name}] ${message}`);
}

function run(command, args, cwd, env) {
  execFileSync(command, args, {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
    timeout: BUILD_TIMEOUT_MS,
    env,
  });
}

// Build a single extension: install the locked dependency tree without running
// any lifecycle scripts (the key supply-chain mitigation), then run the Vite
// `build` script. Returns true on success.
function buildExtension(name) {
  const dir = extensionDir(name);

  if (!fs.existsSync(packageJSONPath(dir))) {
    fail(name, "package.json not found");
    return false;
  }
  if (!fs.existsSync(path.join(dir, "package-lock.json"))) {
    fail(name, "package-lock.json is required (run `npm install` and commit the lockfile)");
    return false;
  }

  let pkg;
  try {
    pkg = readPackageManifest(dir);
  } catch (err) {
    fail(name, `package.json is not valid JSON: ${err.message}`);
    return false;
  }
  if (!pkg.scripts.build) {
    fail(name, "package.json must define a `build` script (e.g. \"vite build\")");
    return false;
  }

  try {
    // Install with registry access but no lifecycle scripts.
    run("npm", ["ci", "--ignore-scripts"], dir, process.env);
    // Run the build with npm in offline mode so it can't pull additional
    // packages at build time. This constrains npm's own network use; it is a
    // speed-bump, not a sandbox (build tooling can still make network calls).
    run("npm", ["run", "build"], dir, { ...process.env, npm_config_offline: "true" });
  } catch (err) {
    fail(name, `build failed: ${err.message}`);
    return false;
  }

  const distDir = path.join(dir, buildOutputDir);
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    fail(name, `build did not produce a '${buildOutputDir}/' directory`);
    return false;
  }

  // Muxy reads the manifest from a `package.json` inside the installed build
  // output. Each extension's own `build` script copies it into `dist/` (so any
  // build path produces a complete dist); fail loudly if one forgot to.
  if (!fs.existsSync(packageJSONPath(distDir))) {
    fail(name, `build did not emit 'package.json' into '${buildOutputDir}/' — append the manifest copy to the extension's build script`);
    return false;
  }

  // Every file the muxy block references must exist in the build output.
  let ok = true;
  for (const relative of referencedBuildFiles(pkg.muxy)) {
    const { resolved, inside } = resolveInside(distDir, relative);
    if (!inside) {
      fail(name, `referenced file '${relative}' escapes the build output directory`);
      ok = false;
      continue;
    }
    if (!fs.existsSync(resolved)) {
      fail(name, `referenced file '${relative}' is missing from '${buildOutputDir}/' after build`);
      ok = false;
    }
  }
  return ok;
}

function main() {
  const names = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const targets = names.length > 0 ? names : listExtensionNames();

  if (targets.length === 0) {
    console.log("No extensions to build.");
    return;
  }

  let failed = 0;
  for (const name of targets) {
    console.log(`building ${name}...`);
    if (buildExtension(name)) {
      console.log(`✓ ${name}`);
    } else {
      failed += 1;
      console.log(`✗ ${name}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} extension(s) failed to build.`);
    process.exit(1);
  }
  console.log(`\nAll ${targets.length} extension(s) built.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
