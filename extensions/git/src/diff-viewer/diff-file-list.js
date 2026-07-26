import { h, readPref, writePref } from "@/lib/dom";
import { fileRow } from "@/ui/shared";
import { treeIndent, treeRows } from "@/ui/file-tree";
const STATUS_LABEL = {
    added: "A",
    deleted: "D",
    modified: "M",
    renamed: "R",
    untracked: "U",
    ignored: "I",
};
const VIEW_KEY = "muxy.git.diff.filetree";
const TREE_PREFIX = "muxy.git.diff.tree.";
export class DiffFileListView {
    host;
    onSelect;
    actions;
    state = { files: [], active: "" };
    constructor(host, onSelect, actions = {}) {
        this.host = host;
        this.onSelect = onSelect;
        this.actions = actions;
        this.render();
    }
    rowActions(file) {
        if (file.label === "D")
            return {};
        return {
            onOpenEditor: this.actions.onOpenEditor
                ? () => this.actions.onOpenEditor(file.path)
                : undefined,
            onReveal: this.actions.onReveal ? () => this.actions.onReveal(file.path) : undefined,
        };
    }
    setFiles(files) {
        this.state = { files, active: this.state.active };
        this.render();
    }
    setActive(itemId) {
        if (this.state.active === itemId)
            return;
        this.state = { files: this.state.files, active: itemId };
        this.syncActive();
    }
    syncActive() {
        for (const row of this.host.querySelectorAll("[data-item-id]")) {
            const active = row.dataset.itemId === this.state.active;
            row.classList.toggle("bg-accent", active);
            if (active)
                row.scrollIntoView({ block: "nearest" });
        }
    }
    clear() {
        this.state = { files: [], active: "" };
        this.render();
    }
    isTree() {
        return readPref(VIEW_KEY, "tree") !== "list";
    }
    toggleView() {
        writePref(VIEW_KEY, this.isTree() ? "list" : "tree");
        this.render();
    }
    render() {
        if (readPref(VIEW_KEY, "tree") !== "list") {
            this.host.replaceChildren(h("ul", { class: "divide-y divide-transparent" }, treeRows(this.state.files.map((file) => toEntry(file)), {
                prefix: TREE_PREFIX,
                onToggle: () => this.render(),
                renderLeaf: (file, depth) => stampRow(fileRow(file, {
                    active: file.itemId === this.state.active,
                    indent: treeIndent(depth),
                    name: file.name,
                    onOpen: () => this.onSelect(file.itemId),
                    ...this.rowActions(file),
                }), file.itemId),
            })));
            return;
        }
        this.host.replaceChildren(h("ul", { class: "divide-y divide-border" }, this.state.files.map((file) => stampRow(fileRow(toEntry(file), {
            active: file.itemId === this.state.active,
            onOpen: () => this.onSelect(file.itemId),
            ...this.rowActions(toEntry(file)),
        }), file.itemId))));
    }
}
function stampRow(row, itemId) {
    row.dataset.itemId = itemId;
    return row;
}
function toEntry(file) {
    return {
        path: file.path,
        itemId: file.itemId,
        label: STATUS_LABEL[file.status],
        added: null,
        removed: null,
    };
}
