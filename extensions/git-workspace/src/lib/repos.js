function normalizePath(path) {
    return path.replace(/\/+$/, "");
}

export function parentDir(path) {
    const clean = normalizePath(path);
    const idx = clean.lastIndexOf("/");
    return idx > 0 ? clean.slice(0, idx) : clean;
}

export function basename(path) {
    const clean = normalizePath(path);
    return clean.slice(clean.lastIndexOf("/") + 1);
}

export async function isRepoContext(path) {
    const res = await muxy
        .exec(["git", "-C", path, "rev-parse", "--show-toplevel"])
        .catch(() => null);
    return res?.exitCode === 0;
}

export async function findRepoDirs(root) {
    const res = await muxy
        .exec([
        "find", root,
        "-maxdepth", "3",
        "(", "-name", "node_modules", "-o", "-name", "Library", "-o", "-name", ".Trash", ")",
        "-prune", "-o", "-name", ".git", "-print",
    ])
        .catch(() => null);
    if (!res?.stdout)
        return [];
    return [...new Set(res.stdout.split("\n").filter(Boolean).map(parentDir))].sort();
}
