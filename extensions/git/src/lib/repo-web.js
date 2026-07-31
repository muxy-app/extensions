import * as repo from "@/lib/repo";

export function remoteToWebUrl(remote) {
    const url = (remote || "").trim();
    if (!url)
        return "";
    const sshUrl = url.match(/^ssh:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
    if (sshUrl)
        return `https://${sshUrl[1]}/${sshUrl[2]}`;
    const scp = url.match(/^(?:[^@/]+@)([^:/]+):(.+?)(?:\.git)?\/?$/);
    if (scp)
        return `https://${scp[1]}/${scp[2]}`;
    const http = url.match(/^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?\/?$/);
    if (http)
        return `https://${http[1]}`;
    return "";
}

export async function repoWebUrl() {
    return remoteToWebUrl(await repo.remoteUrl());
}
