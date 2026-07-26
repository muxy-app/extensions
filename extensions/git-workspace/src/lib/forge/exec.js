export async function run(argv, cwd) {
    const res = await muxy.exec(argv, { cwd });
    if (res.exitCode !== 0)
        throw new Error(res.stderr || res.stdout || `Command failed: ${argv.join(" ")}`);
    return res.stdout;
}

export async function tryRun(argv, cwd) {
    try {
        return await run(argv, cwd);
    }
    catch {
        return "";
    }
}
