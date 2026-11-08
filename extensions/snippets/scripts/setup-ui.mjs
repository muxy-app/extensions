#!/usr/bin/env node
// Downloads shared/ui from github.com/muxy-app/extensions into .muxy-ui/ for
// standalone development. Not needed inside the marketplace monorepo.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findMuxyUi, projectRoot } from "./muxy-ui.mjs";

const REPO = "https://github.com/muxy-app/extensions";
const target = resolve(projectRoot, ".muxy-ui");
const git = (...args) => execFileSync("git", args, { stdio: "inherit" });

const found = findMuxyUi();
if (found && !found.startsWith(target)) {
  console.log(`@muxy/ui already available at ${found}`);
  process.exit(0);
}

if (existsSync(resolve(target, ".git"))) {
  git("-C", target, "pull", "--depth", "1", "origin", "main");
} else {
  git("clone", "--depth", "1", "--filter=blob:none", "--sparse", REPO, target);
  git("-C", target, "sparse-checkout", "set", "shared/ui");
}
console.log(`@muxy/ui ready at ${resolve(target, "shared/ui")}`);
