const EXT = "database";
const FIND_TIMEOUT = 1000;
let requests = 0;

function findTab(connectionId) {
    requests += 1;
    const requestId = `${Date.now()}-${requests}`;
    return new Promise((resolve) => {
        let unsubscribe = () => undefined;
        let timer;
        const finish = (tabID) => {
            clearTimeout(timer);
            unsubscribe();
            resolve(tabID || null);
        };
        timer = setTimeout(() => finish(null), FIND_TIMEOUT);
        unsubscribe = muxy.events.subscribe(`extension.${EXT}.found-tab`, (payload) => {
            if (payload?.requestId === requestId)
                finish(payload.tabID);
        });
        muxy.events.emit(`extension.${EXT}.find-tab`, { requestId, connectionId }).catch(() => finish(null));
    });
}

export async function openConnection(connectionId) {
    const tabID = await findTab(connectionId);
    if (tabID) {
        try {
            await muxy.tabs.switchTo(tabID);
            return;
        }
        catch {
        }
    }
    await muxy.tabs.open({
        kind: "extensionWebView",
        extension: { id: muxy.extensionID, tabType: "workbench", data: { connectionId } },
    });
}
