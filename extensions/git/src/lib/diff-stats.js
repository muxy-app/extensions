export function diffStats(diff) {
    let additions = 0;
    let deletions = 0;
    let changedFiles = 0;
    for (const line of String(diff ?? "").split("\n")) {
        if (line.startsWith("diff --git "))
            changedFiles += 1;
        else if (line.startsWith("+") && !line.startsWith("+++"))
            additions += 1;
        else if (line.startsWith("-") && !line.startsWith("---"))
            deletions += 1;
    }
    return { changedFiles, additions, deletions };
}
