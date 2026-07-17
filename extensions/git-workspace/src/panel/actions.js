import { h } from "@/lib/dom";
import { openUrl } from "@/lib/git";
import { icon } from "@/lib/icons";
import { button, centered, iconButton, menuItem, openFloating } from "@/ui/shared";

const FILTERS = [
    { value: "all", label: "All" },
    { value: "running", label: "Running" },
    { value: "success", label: "Success" },
    { value: "failure", label: "Failed" },
];

export function renderActionsTab(app) {
    if (app.runList.kind === "idle")
        return h("section", { class: "flex min-h-0 flex-1 flex-col" }, h("div", { class: "flex flex-1 items-center justify-center p-4" }, button("Load workflow runs", {
            iconName: "play",
            variant: "outline",
            onClick: () => void app.loadRunList(false),
        })));
    return h("section", { class: "flex min-h-0 flex-1 flex-col" }, h("header", { class: "flex h-[30px] shrink-0 items-center gap-1 border-b border-border pl-2 pr-2" }, renderWorkflowSelect(app), iconButton("Refresh", "refresh", () => void app.loadRunList(true), "ml-auto", app.runListRefreshing)), renderFilterTabs(app), h("div", { class: "min-h-0 flex-1 overflow-y-auto" }, renderRunListBody(app)));
}

function workflowNames(app) {
    if (app.runList.kind !== "ready")
        return [];
    return [...new Set(app.runList.runs.map((run) => run.workflow).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function renderWorkflowSelect(app) {
    const names = workflowNames(app);
    const current = app.runWorkflow && names.includes(app.runWorkflow) ? app.runWorkflow : "";
    return h("button", {
        type: "button",
        class: "flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-[12px] font-semibold text-foreground outline-none hover:bg-accent",
        onclick: (event) => openWorkflowMenu(app, event.currentTarget, names),
    }, icon("play", 12, "text-muted-foreground", 2), h("span", { class: "truncate" }, current || "All workflows"), icon("chevronDown", 12, "text-muted-foreground", 2.5));
}

function openWorkflowMenu(app, anchor, names) {
    const close = openFloating(anchor, h("div", { class: "max-h-72 overflow-auto p-1" }, menuItem("All workflows", null, () => {
        close();
        app.setRunWorkflow("");
    }, { active: !app.runWorkflow }), names.map((name) => menuItem(name, null, () => {
        close();
        app.setRunWorkflow(name);
    }, { active: app.runWorkflow === name }))), { width: 256, align: "start" });
}

function renderFilterTabs(app) {
    return h("div", { class: "flex items-center gap-1 border-b border-border px-2 py-1.5" }, FILTERS.map((filter) => h("button", {
        type: "button",
        class: app.runFilter === filter.value
            ? "rounded bg-accent px-2 py-1 text-[11px] font-medium text-foreground outline-none transition-colors"
            : "rounded px-2 py-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground",
        onclick: () => app.setRunFilter(filter.value),
    }, filter.label)));
}

function renderRunListBody(app) {
    if (app.runList.kind === "loading")
        return centered(icon("loader", 16, "animate-spin", 2), "Loading...");
    if (app.runList.kind === "error")
        return centered(h("span", { class: "max-w-[80%] text-center" }, app.runList.message));
    if (app.runList.kind !== "ready")
        return h("div");
    const runs = app.runList.runs.filter((run) => matchesFilter(run, app.runFilter) && matchesWorkflow(run, app.runWorkflow));
    if (runs.length === 0)
        return centered(icon("play", 20, "", 1.5), `No ${app.runFilter === "all" ? "" : app.runFilter} workflow runs.`);
    return h("ul", {}, runs.map((run) => renderRunRow(app, run)));
}

function matchesFilter(run, filter) {
    if (filter === "all")
        return true;
    return runState(run) === filter;
}

function matchesWorkflow(run, workflow) {
    return !workflow || run.workflow === workflow;
}

function runState(run) {
    if (run.status !== "completed")
        return "running";
    if (run.conclusion === "success")
        return "success";
    if (run.conclusion === "failure" || run.conclusion === "timed_out" || run.conclusion === "startup_failure")
        return "failure";
    if (run.conclusion === "cancelled")
        return "cancelled";
    return "neutral";
}

function runStateIcon(run, size) {
    const state = runState(run);
    if (state === "running")
        return icon("loader", size, "animate-spin text-muted-foreground", 2);
    if (state === "success")
        return icon("check", size, "text-diff-add", 2);
    if (state === "failure")
        return icon("xCircle", size, "text-diff-remove", 2);
    if (state === "cancelled")
        return icon("prClosed", size, "text-muted-foreground", 2);
    return icon("circleDashed", size, "text-muted-foreground", 2);
}

function renderRunRow(app, run) {
    const state = runState(run);
    const pending = app.runRowPending.get(run.id) ?? null;
    const busy = pending !== null;
    const running = state === "running";
    return h("li", { class: "group flex items-center gap-2 border-b border-border px-3 py-1.5" }, busy ? icon("loader", 13, "animate-spin text-muted-foreground", 2) : runStateIcon(run, 13), h("div", { class: "flex min-w-0 flex-1 flex-col" }, h("span", { class: "truncate text-[12px] font-medium text-foreground" }, run.title || run.workflow), h("span", { class: "truncate font-mono text-[10px] text-muted-foreground" }, [run.workflow, run.branch, run.event].filter(Boolean).join(" · "))), h("div", { class: "hidden shrink-0 items-center gap-0.5 group-hover:flex" }, running
        ? iconButton("Cancel run", "xCircle", () => void app.cancelRunRow(run.id), "", busy, "danger")
        : iconButton("Rerun", "refresh", () => void app.rerunRow(run.id, false), "", busy), state === "failure"
        ? iconButton("Rerun failed jobs", "undo", () => void app.rerunRow(run.id, true), "", busy)
        : null, iconButton("Open in browser", "external", () => openUrl(run.url), "", busy)));
}
