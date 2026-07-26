const DEFAULT_TIMEOUT = 60000;

export class ExecError extends Error {
    constructor(message, res = {}) {
        super(message);
        this.stderr = res.stderr || "";
        this.stdout = res.stdout || "";
        this.exitCode = res.exitCode ?? -1;
    }
}

function fail(argv, res) {
    const detail = (res.stderr || res.stdout || "").trim();
    throw new ExecError(detail || `Command failed: ${argv[0]}`, res);
}

export async function run(argv, opts = {}) {
    const res = await muxy.exec(argv, { timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT });
    if (res.exitCode !== 0)
        fail(argv, res);
    return res.stdout;
}

export async function tryRun(argv, opts = {}) {
    try {
        return await run(argv, opts);
    }
    catch {
        return null;
    }
}
