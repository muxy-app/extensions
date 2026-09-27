const EXT = "database";
const tabsByConnection = new Map();

function parseData(raw) {
    if (!raw)
        return null;
    if (typeof raw === "object")
        return raw;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}

function connectionOf(payload) {
    if (payload.extensionID !== muxy.extensionID)
        return null;
    if (payload.tabTypeID && payload.tabTypeID !== "workbench")
        return null;
    const data = parseData(payload.data);
    return data?.connectionId || null;
}

muxy.events.subscribe("tab.created", (payload) => {
    const connectionId = connectionOf(payload);
    if (connectionId)
        tabsByConnection.set(connectionId, payload.tabID);
});

muxy.events.subscribe("tab.closed", (payload) => {
    const connectionId = connectionOf(payload);
    if (connectionId) {
        tabsByConnection.delete(connectionId);
        return;
    }
    for (const [id, tabID] of tabsByConnection) {
        if (tabID === payload.tabID)
            tabsByConnection.delete(id);
    }
});

muxy.events.subscribe(`extension.${EXT}.find-tab`, (payload) => {
    const tabID = tabsByConnection.get(payload?.connectionId) || null;
    try {
        muxy.events.emit(`extension.${EXT}.found-tab`, { requestId: payload?.requestId, tabID });
    }
    catch {
    }
});
