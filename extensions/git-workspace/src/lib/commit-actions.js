import { alertError, openUrl, runPinned } from "@/lib/git";
import * as cmd from "@/lib/cmd";
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
function commitUrl(remote, hash) {
    const url = remote.trim();
    const ssh = url.match(/git@([^:]+):(.+?)(?:\.git)?$/);
    const https = url.match(/^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/);
    const match = ssh ?? https;
    if (!match)
        return null;
    return `https://${match[1]}/${match[2]}/commit/${hash}`;
}
export async function openCommitInBrowser(commit) {
    try {
        const remote = await runPinned((cwd) => cmd.remoteUrl(cwd));
        if (!remote)
            throw new Error("No remote found");
        const url = commitUrl(remote, commit.hash);
        if (!url)
            throw new Error("Could not parse remote URL");
        openUrl(url);
    }
    catch (err) {
        await alertError("Open in browser failed", err);
    }
}
export async function cherryPickCommit(commit, onDone) {
    try {
        await runPinned((cwd) => cmd.cherryPick(cwd, commit.hash));
        await muxy.toast({ body: `Cherry-picked ${commit.shortHash}`, variant: "success" }).catch(() => undefined);
        onDone();
    }
    catch (err) {
        await alertError("Cherry-pick failed", err);
    }
}
export async function revertCommit(commit, prefill, onDone) {
    try {
        await runPinned((cwd) => cmd.revert(cwd, commit.hash));
        prefill(`Revert: ${commit.subject}`);
        onDone();
    }
    catch (err) {
        await alertError("Revert failed", err);
    }
}
