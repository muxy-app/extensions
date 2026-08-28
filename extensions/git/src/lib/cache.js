const MAX_ENTRIES = 6;

export function loadCache(storageKey) {
    let entries = [];
    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
        if (Array.isArray(parsed))
            entries = parsed.filter((entry) => Array.isArray(entry) && typeof entry[0] === "string");
    }
    catch {
        entries = [];
    }
    const map = new Map(entries.map(([key, value]) => [key, { value, keep: true }]));
    const persist = () => {
        try {
            const kept = [...map].filter(([, entry]) => entry.keep).slice(-MAX_ENTRIES);
            localStorage.setItem(storageKey, JSON.stringify(kept.map(([key, entry]) => [key, entry.value])));
        }
        catch {
            return;
        }
    };
    return {
        get: (key) => map.get(key)?.value,
        set: (key, value, keep = true) => {
            map.delete(key);
            map.set(key, { value, keep });
            if (keep)
                persist();
        },
    };
}
