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

muxy.events.subscribe(`extension.${EXT}.open-connection`, async (payload) => {
    const connectionId = payload?.connectionId;
    if (!connectionId)
        return;
    const existing = tabsByConnection.get(connectionId);
    if (existing) {
        try {
            await muxy.tabs.switchTo(existing);
            return;
        }
        catch {
            tabsByConnection.delete(connectionId);
        }
    }
    try {
        const tabID = await muxy.tabs.open({
            kind: "extensionWebView",
            extension: { id: muxy.extensionID, tabType: "workbench", data: { connectionId } },
        });
        if (tabID)
            tabsByConnection.set(connectionId, tabID);
    }
    catch {
    }
});
