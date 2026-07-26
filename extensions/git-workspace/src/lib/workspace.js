import { baseWorktreePath } from "@/lib/git";
import { basename, findRepoDirs, isRepoContext, parentDir } from "@/lib/repos";

export { basename, parentDir } from "@/lib/repos";

const ROOT_KEY = "muxy.gitws.root:";

function normalizePath(path) {
    return path.replace(/\/+$/, "");
}

function relPath(root, path) {
    const prefix = normalizePath(root) + "/";
    return path.startsWith(prefix) ? path.slice(prefix.length) : basename(path);
}

export async function workspaceRoot() {
    const base = await baseWorktreePath();
    if (!base)
        return undefined;
    const saved = localStorage.getItem(ROOT_KEY + normalizePath(base));
    if (saved)
        return saved;
    return (await isRepoContext(base)) ? parentDir(base) : base;
}

export async function setWorkspaceRoot(path) {
    const base = await baseWorktreePath();
    if (!base)
        return;
    if (path)
        localStorage.setItem(ROOT_KEY + normalizePath(base), normalizePath(path));
    else
        localStorage.removeItem(ROOT_KEY + normalizePath(base));
}

async function repoDetails(root, path) {
    const res = await muxy
        .exec(["git", "-C", path, "--no-optional-locks", "status", "--porcelain", "-b"])
        .catch(() => null);
    const lines = res?.exitCode === 0 ? res.stdout.split("\n").filter(Boolean) : [];
    const head = lines[0] ?? "";
    const branch = head.startsWith("## ") ? head.slice(3).split("...")[0] : "";
    return {
        path,
        name: basename(path),
        rel: relPath(root, path),
        branch,
        dirty: Math.max(0, lines.length - 1),
    };
}

export async function listRepos(root) {
    const paths = await findRepoDirs(root);
    return Promise.all(paths.map((path) => repoDetails(root, path)));
}
