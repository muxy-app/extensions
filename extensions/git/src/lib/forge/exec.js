export async function run(argv) {
    const res = await muxy.exec(argv);
    if (res.exitCode !== 0)
        throw new Error(res.stderr || res.stdout || `Command failed: ${argv.join(" ")}`);
    return res.stdout;
}

export async function tryRun(argv) {
    try {
        return await run(argv);
    }
    catch {
        return "";
    }
}

export async function runOutput(argv) {
    const res = await muxy.exec(argv).catch(() => null);
    return res?.stdout ?? "";
}
