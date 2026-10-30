/** Create a disposable, self-contained Git demo. Never touches existing folders. */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
const roadmap = `# Roadmap: Harbor Notes

- [x] **Phase 1: Project foundation** - Establish the notes schema and local storage.
- [x] **Phase 2: Search and tags** - Find notes by title, content, and tag.
- [ ] **Phase 3: Shared notebooks** - Invite collaborators and preserve offline edits.
- [ ] **Phase 4: Release readiness** - Verify keyboard access and prepare the launch.

## Phase Details
### Phase 3: Shared notebooks
**Goal:** Share a notebook without losing offline changes.
### Phase 4: Release readiness
**Goal:** Ship a tested, accessible first release.
`;

async function write(root, path, content) {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

export async function writeScenario(root, scenario = "active") {
  const paused = scenario === "paused";
  const failed = scenario === "verification";
  const phase = failed ? 4 : 3;
  const phaseName = failed ? "Release readiness" : "Shared notebooks";
  const status = paused ? "Paused after invitation flow; offline merge tests are next"
    : failed ? "Accessibility review found a keyboard navigation gap"
    : "Notebook sharing plan prepared; implementation is next";
  await rm(join(root, ".planning"), { recursive: true, force: true });
  await write(root, ".planning/PROJECT.md", `# Harbor Notes\n\n## Core Value\nKeep a team's notes searchable and available offline.\n`);
  await write(root, ".planning/ROADMAP.md", roadmap.replace(failed ? "- [ ] **Phase 3:" : "__unused__", "- [x] **Phase 3:"));
  await write(root, ".planning/STATE.md", `---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Collaborative Notebooks
status: ${paused ? "paused" : "active"}
last_updated: "2026-10-18T14:30:00Z"
progress:
  total_phases: 4
  completed_phases: ${failed ? 3 : 2}
  total_plans: 6
  completed_plans: ${failed ? 5 : 3}
---
# Project State

## Current Position
Phase: ${phase} of 4 — ${phaseName}
Plan: ${failed ? "01" : "01 of 02"}
Status: ${status}
Last activity: 2026-10-18 — ${paused ? "Saved collaboration handoff" : failed ? "Completed release verification" : "Prepared sharing implementation plan"}

## Accumulated Context
### Blockers/Concerns
- Offline edits must preserve the original note when a collaborator renames it.
- Invite links use an explicit expiration date.
`);
  await write(root, ".planning/config.json", '{"mode":"interactive","depth":"standard"}\n');
  for (const [dir, title] of [["01-project-foundation", "Project foundation"], ["02-search-and-tags", "Search and tags"]]) {
    const n = dir.slice(0, 2);
    await write(root, `.planning/phases/${dir}/${n}-01-PLAN.md`, `# ${title}\n\nImplement and test the recorded phase goal.\n`);
    await write(root, `.planning/phases/${dir}/${n}-01-SUMMARY.md`, `# ${title} complete\n\nImplementation and tests passed.\n`);
    await write(root, `.planning/phases/${dir}/${n}-VERIFICATION.md`, '---\nstatus: passed\n---\nRecorded acceptance checks passed.\n');
  }
  const collaboration = ".planning/phases/03-shared-notebooks";
  await write(root, `${collaboration}/03-CONTEXT.md`, '# Shared notebooks\n\nUse expiring invites and reconcile offline edits.\n');
  await write(root, `${collaboration}/03-RESEARCH.md`, '# Research\n\nUse stable note IDs when merging collaborators edits.\n');
  await write(root, `${collaboration}/03-01-PLAN.md`, '# Invitation flow\n\nCreate, expire, and accept notebook invitations.\n');
  await write(root, `${collaboration}/03-02-PLAN.md`, '# Offline reconciliation\n\nTest simultaneous rename and edit without data loss.\n');
  if (paused || failed) await write(root, `${collaboration}/03-01-SUMMARY.md`, '# Invitation flow complete\n\nExpiration and acceptance tests passed.\n');
  if (paused) await write(root, `${collaboration}/.continue-here.md`, '---\nphase: 3\ntask: 2\ntotal_tasks: 3\nstatus: paused\nlast_updated: "2026-10-18T14:30:00Z"\n---\n## Next Action\nResume offline reconciliation tests for simultaneous edits.\n');
  if (failed) {
    await write(root, `${collaboration}/03-02-SUMMARY.md`, '# Offline reconciliation complete\n\nSimultaneous edits preserve both notes.\n');
    await write(root, `${collaboration}/03-VERIFICATION.md`, '---\nstatus: passed\n---\nSharing and offline acceptance checks passed.\n');
    await write(root, '.planning/phases/04-release-readiness/04-01-PLAN.md', '# Release acceptance\n\nVerify keyboard navigation and export recovery.\n');
    await write(root, '.planning/phases/04-release-readiness/04-01-SUMMARY.md', '# Release checks complete\n\nExport recovery passed; keyboard acceptance requires a follow-up fix.\n');
    await write(root, '.planning/phases/04-release-readiness/04-VERIFICATION.md', '---\nstatus: failed\n---\nKeyboard focus does not return to the notebook list after closing export.\n');
  }
}

export async function createDemo(destination) {
  const base = resolve(destination);
  await mkdir(base); // Fail rather than overwrite an existing demo.
  const main = join(base, "harbor-notes");
  await mkdir(main);
  git(main, "init", "-b", "main");
  git(main, "config", "user.name", "Harbor Demo");
  git(main, "config", "user.email", "demo@example.invalid");
  await write(main, "README.md", '# Harbor Notes\n\nFictional project for GSD Control Tower demos. No service connections or credentials.\n');
  await write(main, "src/notes.js", 'export const notebook = { title: "Team notebook", offline: true };\n');
  await writeScenario(main);
  git(main, "add", ".");
  git(main, "commit", "-m", "Prepare collaborative notebooks implementation");
  const worktrees = [];
  for (const [scenario, branch] of [["paused", "feature/offline-sync"], ["verification", "release/1.0"]]) {
    const path = join(base, scenario === "paused" ? "offline-sync" : "release-review");
    git(main, "worktree", "add", "-b", branch, path);
    await writeScenario(path, scenario);
    git(path, "add", ".");
    git(path, "commit", "-m", scenario === "paused" ? "Save offline sync handoff" : "Record keyboard accessibility verification gap");
    worktrees.push(path);
  }
  await write(main, "src/notes.js", 'export const notebook = { title: "Shared team notebook", offline: true };\n');
  return { main, worktrees };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await createDemo(process.argv[2] ?? join(tmpdir(), "gsd-control-tower-demo"));
  console.log(JSON.stringify(result, null, 2));
  console.log("Open harbor-notes in Muxy, then register its two worktrees with the Muxy CLI or worktree picker. See demo/README.md.");
}
