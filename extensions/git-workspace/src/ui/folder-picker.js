export async function chooseFolder(initial, prompt = "Choose worktree location") {
    const seed = initial ? ` default location (POSIX file "${initial}")` : "";
    const res = await muxy
        .exec([
        "osascript",
        "-e",
        `POSIX path of (choose folder with prompt "${prompt}"${seed})`,
    ])
        .catch(() => null);
    if (!res || res.exitCode !== 0)
        return null;
    const path = res.stdout.trim().replace(/\/+$/, "");
    return path || null;
}
