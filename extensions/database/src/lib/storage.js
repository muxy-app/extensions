const HISTORY_LIMIT = 300;
const HISTORY_BYTES = 262144;
const DRAFT_BYTES = 131072;

async function read(key, fallback) {
    try {
        const value = await muxy.storage.get(key);
        return value ?? fallback;
    }
    catch {
        return fallback;
    }
}

async function write(key, value) {
    await muxy.storage.set(key, value);
}

export async function getConnections() {
    return read("connections:v1", []);
}

export async function setConnections(list) {
    await write("connections:v1", list);
}

export async function getHistory(connId) {
    return read(`history:${connId}`, []);
}

export async function appendHistory(connId, entry) {
    let list = [entry, ...(await getHistory(connId))];
    if (list.length > HISTORY_LIMIT)
        list = list.slice(0, HISTORY_LIMIT);
    while (JSON.stringify(list).length > HISTORY_BYTES && list.length > 1)
        list = list.slice(0, Math.floor(list.length / 2));
    await write(`history:${connId}`, list);
    return list;
}

export async function clearHistory(connId) {
    await muxy.storage.delete(`history:${connId}`);
}

export async function getSavedQueries() {
    return read("saved-queries:v1", []);
}

export async function setSavedQueries(list) {
    await write("saved-queries:v1", list);
}

export async function getDrafts(connId) {
    return read(`drafts:${connId}`, null);
}

export async function setDrafts(connId, drafts) {
    if (JSON.stringify(drafts).length > DRAFT_BYTES)
        return;
    await write(`drafts:${connId}`, drafts);
}

export async function getUiState(connId) {
    return read(`ui:${connId}`, {});
}

export async function setUiState(connId, state) {
    await write(`ui:${connId}`, state);
}

export async function getTunnels() {
    return read("tunnels:v1", []);
}

export async function setTunnels(list) {
    await write("tunnels:v1", list);
}

export async function removeConnectionData(connId) {
    for (const key of [`history:${connId}`, `drafts:${connId}`, `ui:${connId}`]) {
        try {
            await muxy.storage.delete(key);
        }
        catch {
        }
    }
}

const PREF_DEFAULTS = {
    pageSize: 200,
    queryTimeoutSeconds: 60,
    confirmDestructive: true,
};

export async function getPref(key) {
    try {
        if (muxy.settings?.get) {
            const value = await muxy.settings.get(key);
            if (value !== null && value !== undefined)
                return value;
        }
    }
    catch {
    }
    const prefs = await read("prefs:v1", {});
    return prefs[key] ?? PREF_DEFAULTS[key];
}

export async function setPref(key, value) {
    const prefs = await read("prefs:v1", {});
    prefs[key] = value;
    await write("prefs:v1", prefs);
}
