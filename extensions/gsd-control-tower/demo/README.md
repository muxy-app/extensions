# Harbor Notes demo

Harbor Notes is a fictional offline notebook app. The generator creates a local Git repository and two linked worktrees with realistic, independent GSD artifacts. No services, credentials, or fabricated agent activity are included.

```sh
npm run demo -- /tmp/harbor-notes-demo
```

The destination must not exist; the generator refuses to overwrite it. Git identity is configured only inside this demo repository. It never changes global Git configuration or registers projects in Muxy automatically.

Open `harbor-notes` in Muxy. To register the two child worktrees explicitly with the bundled CLI:

```sh
muxy project add /tmp/harbor-notes-demo/harbor-notes --name 'Harbor Notes' --reuse
muxy worktree register /tmp/harbor-notes-demo/harbor-notes /tmp/harbor-notes-demo/offline-sync
muxy worktree register /tmp/harbor-notes-demo/harbor-notes /tmp/harbor-notes-demo/release-review
```

If `muxy` is not on PATH, use `/Applications/Muxy.app/Contents/MacOS/muxy` on macOS.

| Worktree | What to demonstrate |
| --- | --- |
| `main` | Two complete phases, current Shared notebooks phase, context/research/two plans, next action, notes, and one changed source file |
| `feature/offline-sync` | Completed invitation plan and saved handoff; the current phase shows Paused |
| `release/1.0` | Three complete phases and a typed failed release verification; the next action calls for resolving verification |

Open **Control Tower: Open Panel** in the command palette. Choose **All projects**, filter by `Harbor Notes`, and inspect each worktree. Open the Shared notebooks phase to inspect artifact chips and plan counts; expand Repository and Sources to inspect the evidence. Use Preferences to exercise project inclusion and refresh intervals, and Diagnostics to check bridge access.

To exercise file events, edit the active demo worktree's `.planning/STATE.md`, save, and watch its recorded status refresh. To exercise branch events, create and switch to a temporary branch within a demo worktree. Agent activity remains genuine: start a supported agent CLI inside the demo's Muxy terminal to see its real lifecycle. The demo never launches an agent or spends API credits automatically.

Select the primary Harbor Notes worktree in Muxy to show all three planning snapshots at once. If a child is selected, Muxy 2.1 redirects the parent selector to that child; Control Tower keeps the primary row visible with an explicit unavailable message until you select primary again. This is an intentional identity safeguard.

Close/reopen the panel and switch between the main and child worktrees to check Muxy's panel restoration and preference persistence. Remote server behavior requires a separate connected server; this demo qualifies local behavior only.

The generated folders are disposable. Remove the demo from Muxy's project list when finished, then remove the generated destination. Keep the demo registered if you want a repeatable presentation environment.
