const cache = new Map();

const HINTS = {
    sqlite3: "sqlite3 ships with macOS; on Linux install the sqlite3 package",
    psql: "brew install libpq && brew link --force libpq",
    pg_dump: "brew install libpq && brew link --force libpq",
    mysql: "brew install mysql-client && brew link --force mysql-client",
    mysqldump: "brew install mysql-client && brew link --force mysql-client",
    mariadb: "brew install mariadb",
    "mariadb-dump": "brew install mariadb",
    ssh: "ssh ships with macOS and Linux",
};

export async function which(binary) {
    if (cache.has(binary))
        return cache.get(binary);
    const res = await muxy.exec(["/usr/bin/which", binary], { timeoutMs: 10000 });
    const path = res.exitCode === 0 ? res.stdout.trim().split("\n")[0] : null;
    cache.set(binary, path);
    return path;
}

export async function detect(binary) {
    const path = await which(binary);
    return { available: !!path, path, installHint: HINTS[binary] || `install ${binary}` };
}

export async function firstAvailable(binaries) {
    for (const binary of binaries) {
        if (await which(binary))
            return binary;
    }
    return null;
}

export function resetDetection() {
    cache.clear();
}
