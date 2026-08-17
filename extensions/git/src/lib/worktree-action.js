function normalizedPath(path) {
    return (path ?? "").replace(/\/+$/, "");
}

function sameWorktreePath(left, right) {
    return normalizedPath(left) === normalizedPath(right);
}

export async function runInWorktree(targetPath, currentPath, switchTo, action) {
    const switched = !sameWorktreePath(targetPath, currentPath);
    if (switched)
        await switchTo(targetPath);
    try {
        return await action();
    }
    catch (err) {
        if (switched && currentPath) {
            try {
                await switchTo(currentPath);
            }
            catch {
                // Preserve the original action failure.
            }
        }
        throw err;
    }
}
