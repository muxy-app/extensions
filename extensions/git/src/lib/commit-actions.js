import { activeWorktreePath, alertError, openUrl, runPinned } from "@/lib/git";
export async function copyHash(commit) {
    try {
        await navigator.clipboard.writeText(commit.hash);
    }
    catch {
        const ok = await muxy
            .exec({ shell: `printf %s ${JSON.stringify(commit.hash)} | pbcopy` })
            .then((r) => r.exitCode === 0)
            .catch(() => false);
        if (!ok) {
            await alertError("Copy failed", "Could not copy commit hash");
            return;
        }
    }
    await muxy.toast({ body: `Copied ${commit.shortHash}`, variant: "success" }).catch(() => undefined);
}
function githubCommitUrl(remote, hash) {
    const url = remote.trim();
    const ssh = url.match(/git@([^:]+):(.+?)(?:\.git)?$/);
    const https = url.match(/^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/);
    const match = ssh ?? https;
    if (!match)
        return null;
    return `https://${match[1]}/${match[2]}/commit/${hash}`;
}
export async function openCommitOnGithub(commit) {
    try {
        const cwd = await activeWorktreePath();
        const res = await muxy.exec(["git", "remote", "get-url", "origin"], { cwd });
        if (res.exitCode !== 0)
            throw new Error(res.stderr.trim() || "No remote found");
        const url = githubCommitUrl(res.stdout, commit.hash);
        if (!url)
            throw new Error("Could not parse remote URL");
        openUrl(url);
    }
    catch (err) {
        await alertError("Open on GitHub failed", err);
    }
}
export async function cherryPickCommit(commit, onDone) {
    try {
        await runPinned((project) => muxy.git.cherryPick({ hash: commit.hash, project }));
        await muxy.toast({ body: `Cherry-picked ${commit.shortHash}`, variant: "success" }).catch(() => undefined);
        onDone();
    }
    catch (err) {
        await alertError("Cherry-pick failed", err);
    }
}
export async function revertCommit(commit, prefill, onDone) {
    try {
        const cwd = await activeWorktreePath();
        const res = await muxy.exec(["git", "revert", "--no-commit", commit.hash], { cwd });
        if (res.exitCode !== 0)
            throw new Error(res.stderr.trim() || "Revert failed");
        prefill(`Revert: ${commit.subject}`);
        onDone();
    }
    catch (err) {
        await alertError("Revert failed", err);
    }
}
