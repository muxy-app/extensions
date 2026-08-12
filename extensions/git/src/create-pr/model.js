export function isDefaultBranch(currentBranch, defaultBranch) {
    return !!currentBranch && currentBranch === defaultBranch;
}

export function canSubmitCreatePr({ ready, busy, currentBranch, defaultBranch, newBranch, title }) {
    if (!ready || busy || !currentBranch || !title.trim())
        return false;
    return !isDefaultBranch(currentBranch, defaultBranch) || !!newBranch.trim();
}

export function createPrFieldLocks(busy, branchPrepared) {
    return {
        metadata: busy,
        sourceBranch: busy || branchPrepared,
    };
}

export function branchOptions(branches, currentBranch, selectedBranch) {
    const options = [...new Set((branches ?? []).filter((name) => name && name !== currentBranch))];
    if (selectedBranch && !options.includes(selectedBranch))
        options.unshift(selectedBranch);
    return options;
}

export function createPrShortcut(event) {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key !== "Enter")
        return false;
    return true;
}

export function repositoryHint(changeCount) {
    if (changeCount === 0)
        return "The branch will be pushed before creating the pull request";
    return `${changeCount} changed file${changeCount === 1 ? "" : "s"} will be committed with this title`;
}
