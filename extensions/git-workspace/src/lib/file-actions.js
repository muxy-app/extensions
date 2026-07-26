const FILES_EXTENSION_ID = "files";

function stripTrailingSlash(path) {
    return path.replace(/\/+$/, "");
}

function joinPath(base, rel) {
    const root = stripTrailingSlash(base ?? "");
    const relative = rel.replace(/^\/+/, "");
    if (!root)
        return relative;
    return `${root}/${relative}`;
}

export async function openInEditor(cwd, relPath) {
    try {
        await muxy.tabs.open({
            kind: "extensionWebView",
            extension: {
                id: FILES_EXTENSION_ID,
                tabType: "code-editor",
                data: { filePath: relPath, replaceable: false },
            },
        });
    }
    catch {
        await muxy
            .toast({
            title: "Open in editor",
            body: "Could not open the editor. Is the Files extension installed?",
            variant: "error",
        })
            .catch(() => undefined);
    }
}

export async function revealInFinder(cwd, relPath) {
    await muxy.exec(["open", "-R", joinPath(cwd, relPath)]).catch(() => undefined);
}
