import { execFileSync } from "node:child_process";
import { INDEX_BRANCH, INDEX_FILE } from "./marketplace-index.mjs";

const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

// Hands the workflow token to git through GIT_CONFIG_* variables, the same
// header actions/checkout would persist, without putting it in argv or on disk.
export function gitAuthEnv(token, env = process.env) {
  if (!token) return { ...env };
  const index = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10) || 0;
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return {
    ...env,
    GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: "http.https://github.com/.extraheader",
    [`GIT_CONFIG_VALUE_${index}`]: `AUTHORIZATION: basic ${basic}`,
  };
}

function git(cwd, env, args, input) {
  return execFileSync("git", args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  }).trim();
}

function tryGit(cwd, env, args) {
  try {
    return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

// Writes `content` as the branch's index file with git plumbing, so the
// checked-out tree and HEAD are never touched. A missing branch is created as
// an orphan; an unchanged file makes no commit and no push.
export function commitIndexBranch({
  cwd,
  content,
  env = process.env,
  remote = "origin",
  branch = INDEX_BRANCH,
  file = INDEX_FILE,
  message = "Update extension index",
}) {
  const gitEnv = {
    GIT_AUTHOR_NAME: BOT_NAME,
    GIT_AUTHOR_EMAIL: BOT_EMAIL,
    GIT_COMMITTER_NAME: BOT_NAME,
    GIT_COMMITTER_EMAIL: BOT_EMAIL,
    ...env,
  };
  const ref = `refs/heads/${branch}`;
  const remoteHead = git(cwd, gitEnv, ["ls-remote", "--heads", remote, ref]);

  let parent = null;
  let entries = [];
  if (remoteHead) {
    git(cwd, gitEnv, ["fetch", "--quiet", "--no-tags", remote, ref]);
    parent = git(cwd, gitEnv, ["rev-parse", "FETCH_HEAD^{commit}"]);
    if (tryGit(cwd, gitEnv, ["show", `${parent}:${file}`]) === content) {
      return { changed: false, commit: parent };
    }
    entries = git(cwd, gitEnv, ["ls-tree", parent])
      .split("\n")
      .filter((line) => line && line.split("\t")[1] !== file);
  }

  const blob = git(cwd, gitEnv, ["hash-object", "-w", "--stdin"], content);
  entries.push(`100644 blob ${blob}\t${file}`);
  const tree = git(cwd, gitEnv, ["mktree"], `${entries.join("\n")}\n`);
  const parentArgs = parent ? ["-p", parent] : [];
  const commit = git(cwd, gitEnv, ["commit-tree", tree, ...parentArgs, "-m", message]);
  git(cwd, gitEnv, ["push", "--quiet", remote, `${commit}:${ref}`]);
  return { changed: true, commit };
}
