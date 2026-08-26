# Disposable qualification lab

This lab is release infrastructure, not deployment guidance. `npm run qualify` exercises the supported `0.1.0` beta matrix—Docker/loopback, an actual operator-owned `ssh -L` forward, and trusted HTTPS/WebSocket—and emits `passed_supported_beta_matrix` only after cleanup is proven. `npm run qualify:native` retains the Muxy SSH-workspace reproducer as an opt-in diagnostic; that topology is explicitly unsupported in `0.1.0`, and its self-authored observations cannot become release evidence. Every path fails closed and removes everything it owns.

Pinned components:

| Component | Version | Digest |
|-----------|---------|--------|
| Hermes Agent | 0.20.2 (`v2026.8.16`) | `sha256:f8f548d87d16634d1ad9e3777280f3f577ba2358703f04e18e74007ffd3621bf` |
| Deterministic model fixture | Same Hermes Python runtime | Same digest |
| LinuxServer OpenSSH | 10.3_p1-r0-ls233 | `sha256:96b9a4d3b5106746d08d43a6911650d4d21f7d5c7f2ac9660e792bdb5e63157c` |
| cloudflared | 2026.8.2 | `sha256:0aa26e284f05e6c77ae375b8c9c11d9eb6a448fb7bcd8d40f31cb6176189eb38` |

The runner creates a mode-0700 temporary root containing a generated password hash, HMAC session secret, SSH key, verifier challenges, task-local Hermes home, and SSH configuration. Raw values and the Quick Tunnel hostname never enter retained receipts. Compose uses a task-unique project label and OS-assigned loopback ports.

The short-lived Cloudflare Quick Tunnel carries disposable model/board/schedule data only. Password authentication on an unrestricted public endpoint remains unsupported; the tunnel exists solely to qualify trusted HTTPS/WebSocket transport mechanics.

Retained receipts contain versions, hashed behavior categories, pass/fail verdicts, and resource-absence cleanup checks. `.qualification/` is ignored and must not be copied into a marketplace contribution.
