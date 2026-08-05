import * as repo from "@/lib/repo";

const FILES_EXTENSION_ID = "files";

function joinPath(base, rel) {
    const root = (base ?? "").replace(/\/+$/, "");
    const relative = rel.replace(/^\/+/, "");
    if (!root)
        return relative;
    return `${root}/${relative}`;
}

export async function openInEditor(relPath) {
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

export async function revealInFinder(relPath) {
    const info = await repo.repoInfo().catch(() => null);
    if (!info?.root)
        return;
    await muxy.exec(["open", "-R", joinPath(info.root, relPath)]).catch(() => undefined);
}
