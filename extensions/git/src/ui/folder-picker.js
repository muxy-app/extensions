export async function chooseFolder(initial) {
    const seed = initial ? ` default location (POSIX file "${initial}")` : "";
    const res = await muxy
        .exec([
        "osascript",
        "-e",
        `POSIX path of (choose folder with prompt "Choose worktree location"${seed})`,
    ])
        .catch(() => null);
    if (!res || res.exitCode !== 0)
        return null;
    const path = res.stdout.trim().replace(/\/+$/, "");
    return path || null;
}
