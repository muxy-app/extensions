export function filterPullRequests(prs, query) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0)
        return prs;
    return prs.filter((pr) => {
        const text = [pr.number, pr.title, pr.author, pr.headBranch, pr.baseBranch].join(" ").toLowerCase();
        return terms.every((term) => text.includes(term));
    });
}

export function prWorktreePath(root, number) {
    const clean = String(root ?? "").replace(/\/+$/, "");
    if (!clean)
        return `pr-${number}`;
    const separator = clean.lastIndexOf("/");
    const parent = separator > 0 ? clean.slice(0, separator) : "/";
    const repository = clean.slice(separator + 1) || "repo";
    const name = `${repository}.pr-${number}`;
    return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

export function checksLabel(checks) {
    if (!checks || checks.status === "none")
        return "";
    if (checks.status === "pending")
        return `${checks.pending || checks.total || 0} running`;
    if (checks.status === "failure")
        return `${checks.failing || checks.total || 0} failing`;
    if (checks.status === "success")
        return `${checks.passing || checks.total || 0} passing`;
    return `${checks.total || 0} checks`;
}

export function selectionMode(event) {
    if (event.key === "Enter")
        return event.shiftKey ? "checkout" : "details";
    return null;
}

export function detailAction(event) {
    if (event.key === "Enter" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey)
        return "open";
    if (!event.metaKey)
        return null;
    if (event.key === "Enter")
        return "merge";
    if (event.key === "Backspace" || event.key === "Delete")
        return "close";
    return null;
}

export function isPrOpen(pr) {
    return String(pr?.state ?? "open").toLowerCase() === "open";
}

export class RequestGate {
    token = 0;
    start() {
        this.token += 1;
        return this.token;
    }
    invalidate() {
        this.token += 1;
    }
    allows(token) {
        return token === this.token;
    }
}

export function isBackShortcut(event) {
    return event.key === "ArrowLeft"
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && !event.shiftKey
        && !isTextInputTarget(event.target);
}

export function isTextInputTarget(target) {
    const tagName = String(target?.tagName ?? "").toLowerCase();
    return tagName === "input" || tagName === "textarea" || target?.isContentEditable === true;
}
