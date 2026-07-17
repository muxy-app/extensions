import * as cmd from "@/lib/cmd";
import { activeWorktreePath } from "@/lib/git";

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
    const cwd = await activeWorktreePath();
    return remoteToWebUrl(await cmd.remoteUrl(cwd));
}
