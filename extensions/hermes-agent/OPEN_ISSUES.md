# Open issues

## Support Hermes Agent in Muxy SSH workspaces after the native executor is fixed

**Status:** Open

**Target:** Next release after `0.1.0`
**Release impact:** Non-blocking for the documented `0.1.0` beta matrix; Muxy SSH workspaces are explicitly unsupported.

### Problem

On Muxy 1.5.0 (945), an extension command approved inside an SSH workspace fails before Hermes receives a request. Muxy's native remote executor reports `posix_spawn("/usr/bin/ssh", …): ENOENT` even though `/usr/bin/ssh` exists on the Mac. An untouched official ARM64 DMG with the published hash exhibited the same invalid signature/entitlements result as the installed app.

### Safe behavior in `0.1.0`

- The extension displays a bounded unsupported-workspace message.
- It does not move cookies or request bodies into argv, weaken TLS, or add a topology-specific transport workaround.
- Users can run Muxy locally and connect through an operator-owned `ssh -L` forward or a trusted HTTPS Dashboard address.
- The opt-in `npm run qualify:native` command remains available to reproduce and requalify the native path.

### Acceptance criteria

- A supported, valid Muxy build launches the remote command path successfully.
- Two fresh panel sessions and one Muxy restart pass sign-in, saved-session rotation, fresh WebSocket tickets, reconnect, agent controls, operations, schedules, and board create/move.
- Native light/dark, Default/Large scale, narrow/wide, keyboard, accessibility, and reduced-motion checks pass in the SSH workspace.
- Evidence proves no workspace path or remote secret enters Dashboard requests, the bundle, UI, screenshots, or receipts.
- Cleanup proves no owned containers, networks, volumes, processes, listeners, keys, secrets, or temporary roots remain.

Close this issue only after the integrated native qualification gate passes. Do not weaken the criteria to ship support sooner.
