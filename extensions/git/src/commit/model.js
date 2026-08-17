export function changedFileCount(status) {
    const paths = new Set();
    for (const file of [...(status?.stagedFiles ?? []), ...(status?.unstagedFiles ?? [])]) {
        if (file?.path)
            paths.add(file.path);
    }
    return paths.size;
}

export function changesLabel(count) {
    if (count === 0)
        return "No changes to commit";
    return `${count} file${count === 1 ? "" : "s"} will be staged`;
}

export function commitShortcut(event) {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter")
        return null;
    return event.shiftKey ? "commit-and-push" : "commit";
}

export function errorMessage(error) {
    if (error instanceof Error)
        return error.message;
    const text = String(error ?? "").trim();
    return text || "Unknown error";
}
