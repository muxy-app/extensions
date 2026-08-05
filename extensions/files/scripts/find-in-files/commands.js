import {
  OUTPUT_LINE_LIMIT,
  SEARCH_EXIT_MARKER,
  SEARCH_TIMEOUT_MS,
} from "./constants.js";
import { pattern_stdin } from "./query.js";

export function rg_request(variants, options) {
  return search_request(rg_argv(options), variants);
}

export function grep_request(variants, options) {
  return search_request(grep_argv(options), variants);
}

function search_request(argv, variants) {
  return {
    argv: bounded_argv(argv),
    stdin: pattern_stdin(variants),
    timeoutMs: SEARCH_TIMEOUT_MS,
  };
}

function bounded_argv(argv) {
  // execAsync has no line-limit option. Keep the query out of the shell string,
  // cap stdout with a fixed pipeline, and report the search command's status on
  // stderr so runner.js can still distinguish no matches from real failures.
  const script =
    `{ "$@"; search_status=$?; ` +
    `printf '\\n${SEARCH_EXIT_MARKER}%s\\n' "$search_status" >&2; } ` +
    `| head -n ${OUTPUT_LINE_LIMIT}`;
  return ["sh", "-c", script, "find-in-files", ...argv];
}

function rg_argv(options) {
  return [
    "rg",
    "-n",
    "--null",
    "--no-config",
    "--color",
    "never",
    "--no-messages",
    "--threads",
    "2",
    "--max-filesize",
    "512K",
    "--max-count",
    "3",
    "--glob",
    "!node_modules/**",
    "--glob",
    "!.git/**",
    "--glob",
    "!dist/**",
    "--glob",
    "!build/**",
    "--glob",
    "!.build/**",
    "--glob",
    "!coverage/**",
    "--glob",
    "!.next/**",
    "--glob",
    "!.omo/**",
    "--glob",
    "!**/package-lock.json",
    "--glob",
    "!**/pnpm-lock.yaml",
    "--glob",
    "!**/yarn.lock",
    "--glob",
    "!**/bun.lockb",
    "--glob",
    "!**/*.map",
    "--glob",
    "!**/*.min.js",
    "--glob",
    "!**/*.{png,jpg,jpeg,gif,webp,svg,wasm}",
    ...rg_flags(options),
    "-f",
    "-",
    "--",
    ".",
  ];
}

function grep_argv(options) {
  return [
    "grep",
    ...grep_flags(options),
    "-m",
    "3",
    "--exclude-dir=node_modules",
    "--exclude-dir=.git",
    "--exclude-dir=dist",
    "--exclude-dir=build",
    "--exclude-dir=.build",
    "--exclude-dir=coverage",
    "--exclude-dir=.next",
    "--exclude-dir=.omo",
    "--exclude=package-lock.json",
    "--exclude=pnpm-lock.yaml",
    "--exclude=yarn.lock",
    "--exclude=bun.lockb",
    "--exclude=*.map",
    "--exclude=*.min.js",
    "--exclude=*.png",
    "--exclude=*.jpg",
    "--exclude=*.jpeg",
    "--exclude=*.gif",
    "--exclude=*.webp",
    "--exclude=*.svg",
    "--exclude=*.wasm",
    "-f",
    "-",
    "--",
    ".",
  ];
}

function rg_flags(options) {
  const flags = [];
  if (!options.caseSensitive) flags.push("-i");
  if (options.wholeWord) flags.push("-w");
  if (!options.regex) flags.push("-F");
  return flags;
}

function grep_flags(options) {
  return [
    "-rnI",
    "--color=never",
    !options.caseSensitive ? "-i" : "",
    options.wholeWord ? "-w" : "",
    options.regex ? "-E" : "-F",
  ].filter(Boolean);
}
