# Security Policy

## Reporting a vulnerability in the tooling

For a vulnerability in this repo's validation, packaging, signing, or CI — or in
how the Muxy app verifies and installs extensions — **do not open a public
issue.** Use [GitHub's private vulnerability reporting](https://github.com/muxy-app/muxy/security/advisories/new).

Expect acknowledgment within 48 hours and a fix plan within 7 days for confirmed
issues.

## Reporting a malicious or abusive extension

If a **listed extension** behaves maliciously (data exfiltration, unexpected
shell or network use, etc.) or violates policy, file a
[report](.github/ISSUE_TEMPLATE/1-extension-issue.yml). Maintainers triage these
with priority and can unlist the extension by removing its directory, which
drops it from the next published index.

## How integrity is guaranteed

Each extension is signed individually at publish time. **Two** signatures are
produced: one over the extension zip, and one over a metadata document that
binds `name`, `version`, the zip's SHA-256, the declared `permissions`, and a
SHA-256 for each listing asset (icon, screenshots). The desktop app enforces
this trust chain, in order:

1. **Pinned key.** The app bundles Muxy's minisign (Ed25519) public key.
2. **Verify the signed metadata.** Download the metadata document and its
   signature; verify against the pinned key. Reject on failure. **All trusted
   facts are taken from this signed document** — never from unauthenticated API
   fields or headers.
3. **Verify the zip signature** against the pinned key, and require the zip's
   SHA-256 to equal the one in the signed metadata.
4. **Match what was requested.** Require the signed `name`/`version` to equal
   what the app asked to install (rejects downgrade/rollback and cross-listing
   substitution).
5. **Verify listing assets** (icon/screenshots) against the SHA-256s in the
   signed metadata before displaying them.
6. **Consent from signed facts.** Show the user the `permissions` from the signed
   metadata, and cross-check them against the unpacked manifest before installing.
7. **Re-validation.** Unpack to a temporary directory, run the same manifest
   validation as the loader, then install into
   `~/.config/muxy/extensions/<name>/`.

Because both the bytes **and** the facts the user consents to (version,
permissions, asset hashes) are covered by a signature from a key that never
leaves CI, a compromised host or transport cannot substitute bytes, misrepresent
permissions, or roll a user back to an older signed version.

### Signing key

The minisign secret key exists only as a GitHub Actions secret
(`MINISIGN_SECRET_KEY`) used by the publish workflow. It is an **unencrypted
(password-less) key** — the workflow signs with `minisign -W` — so its protection
is the Actions secret store alone. The matching public key is committed as
`minisign.pub` and pinned in the app. The upload to muxy.app is authenticated
with a separate Bearer token, also a GitHub Actions secret (`MUXY_UPLOAD_TOKEN`).

Required safeguards (the key is the entire root of trust):

- **Protected environment.** Scope `MINISIGN_SECRET_KEY` and `MUXY_UPLOAD_TOKEN`
  to a GitHub Actions environment with required reviewers and **no fork access**,
  so no PR-triggered workflow can ever read them. Publish runs only on `main`.
- **No untrusted interpolation.** The publish workflow never expands
  attacker-controlled values into shell (extension names are passed via env and
  matched against a strict allowlist); a CI guard refuses to publish if
  `minisign.pub` is still the placeholder.
- **Rotation.** Rotate on a schedule and immediately on any suspicion of
  exposure. The app pins more than one public key: add the new key to the pin
  set, sign with both for a transition window (muxy.app stores multiple
  signatures per artifact), then retire the old key.

### Compromise, revocation, and exposure window

If `MINISIGN_SECRET_KEY` leaks, an attacker can sign malicious zips that pass the
pinned-key check until users update the app — **the maximum exposure window is
the app's update cadence.** muxy.app cannot revoke the key (it is untrusted in
the threat model). To shrink and detect this:

- **Kill-switch / forced update**, distinct from planned rotation, to push a new
  pinned-key set quickly.
- A **transparency log** (an append-only, signed record of everything ever
  signed) and a **signed revocation list** the app fetches and checks are the
  planned hardening to make a compromise detectable and recoverable without an
  app update. Until then, the exposure window is bounded only by update cadence —
  documented here intentionally.

## What review covers

Every extension PR is reviewed by a maintainer before merge. CI flags
`commands:exec`, a `runScript` command missing `commands:run-script`, network
access, `eval`/`Function`, and minified/obfuscated code for that review.
Extensions run arbitrary JavaScript inside Muxy, so review and least privilege
are the primary defenses — declare only the permissions you use, and ship
readable source.

### Automated malware review

On every push to an extension PR, `.github/workflows/ai-review.yml` asks GitHub
Copilot whether the change is malicious. It looks for exfiltration, remote code,
obfuscation, persistence, backdoors, build-time attacks and prompt injection.
Bugs and quality are out of scope. Deterministic checks also run: binaries,
submodules, symlinks that escape the extension, hidden Unicode,
non-registry dependencies, install scripts, `.npmrc`, and changes outside
`extensions/`.

- **Approved** when Copilot is confident nothing is malicious, it confirms it
  read every changed file, and no deterministic check fires.
- **Changes requested** when anything looks malicious or suspicious. The review
  lists the findings so the author can fix them, or a maintainer can dismiss a
  false positive or block the author.
- **Comment only** when a human must look (tooling changes, oversized PRs) or
  the review could not complete.

Earlier bot approvals are dismissed whenever a later push is not approved. The
check is green only when the bot approves. Copilot is a filter, not a
guarantee: a maintainer still owns the merge.

The job that runs Copilot has a read-only token and never checks out or runs
fork code. Copilot gets only read-only file tools, confined to a directory
holding the PR's files. A separate job, which never sees the model or the fork,
validates the verdict and posts the review.

Spend limits stop push or PR spam from draining Copilot credits:

- Each run waits 90 seconds before doing anything, so a burst of pushes
  collapses into one review.
- Copilot runs at most 30 times per 24 hours for the whole repository and 10
  times per author. Only runs that reached Copilot count, including runs
  cancelled partway through. Owners, members and collaborators are exempt.
- Over a limit, the PR gets a single "paused" notice and Copilot is not run.
- Each review is capped at 30 AI credits.
- **Manual run:** a maintainer adds the `ai-review` label to the PR. The review
  starts immediately, skips the wait and the limits, and removes the label
  when it finishes so it can be added again.

Maintainer setup:

1. Org setting **Copilot → Policies → Copilot CLI → "Allow use of Copilot CLI
   billed to the organization"** (or add a `COPILOT_GITHUB_TOKEN` secret: a
   fine-grained PAT with the *Copilot Requests* permission).
2. Repo setting **Actions → General → Workflow permissions → "Allow GitHub
   Actions to create and approve pull requests"**.
3. Optional repo variables: `AI_REVIEW_MODEL` (pin a model),
   `AI_REVIEW_REASONING_EFFORT`, `AI_REVIEW_MAX_AI_CREDITS` (cost cap per run,
   default 30), `AI_REVIEW_DAILY_LIMIT` (default 30),
   `AI_REVIEW_AUTHOR_DAILY_LIMIT` (default 10; `0` disables either limit),
   `AI_REVIEW_DEBOUNCE_SECONDS` (default 90), and `AI_REVIEW_ESCALATE` (for
   example `@muxy-app/maintainers`, pinged on a malicious verdict).
4. Optionally make **AI security review / Approve or flag** a required status
   check, and turn on "Dismiss stale pull request approvals when new commits
   are pushed".

**SVG listing icons can contain scripts** (`<script>`, `foreignObject`, event
handlers). Wherever an icon is rendered untrusted (the marketplace UI), it must
be rasterized or script-stripped, or served behind a CSP that blocks execution —
do not inline raw author SVG into a privileged context.
