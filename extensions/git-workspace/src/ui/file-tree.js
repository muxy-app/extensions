import { cls, h, readPref, writePref } from "@/lib/dom";
import { icon } from "@/lib/icons";

export function buildFileTree(entries) {
    const root = { name: "", path: "", dirs: new Map(), files: [] };
    for (const entry of entries) {
        const parts = entry.path.split("/");
        let node = root;
        for (let i = 0; i < parts.length - 1; i += 1) {
            const name = parts[i];
            const path = node.path ? `${node.path}/${name}` : name;
            let next = node.dirs.get(name);
            if (!next) {
                next = { name, path, dirs: new Map(), files: [] };
                node.dirs.set(name, next);
            }
            node = next;
        }
        node.files.push({ ...entry, name: parts[parts.length - 1] });
    }
    return compact(root);
}

function compact(node) {
    for (const [name, child] of node.dirs) {
        let merged = compact(child);
        while (merged.files.length === 0 && merged.dirs.size === 1) {
            const only = [...merged.dirs.values()][0];
            merged = { name: `${merged.name}/${only.name}`, path: only.path, dirs: only.dirs, files: only.files };
        }
        node.dirs.set(name, merged);
    }
    return node;
}

function sortedDirs(node) {
    return [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function folderRow(dir, depth, expanded, toggle) {
    return h("li", {
        class: "group flex h-[24px] cursor-pointer items-center gap-1.5 pr-2.5 hover:bg-accent",
        style: `padding-left: ${treeIndent(depth)}px`,
        onclick: toggle,
    }, icon("chevronRight", 12, cls("-mr-1.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90"), 2.2), icon("folder", 12, "shrink-0 text-muted-foreground", 1.8), h("span", { class: "min-w-0 flex-1 truncate text-left text-[12px] font-medium text-foreground", title: dir.path }, dir.name));
}

function renderNode(node, depth, opts) {
    const rows = [];
    for (const dir of sortedDirs(node)) {
        const key = `${opts.prefix}${dir.path}`;
        const expanded = readPref(key, "true") !== "false";
        rows.push(folderRow(dir, depth, expanded, () => {
            writePref(key, expanded ? "false" : "true");
            opts.onToggle();
        }));
        if (expanded)
            rows.push(...renderNode(dir, depth + 1, opts));
    }
    for (const file of node.files)
        rows.push(opts.renderLeaf(file, depth));
    return rows;
}

export function treeRows(entries, opts) {
    return renderNode(buildFileTree(entries), 0, opts);
}

export function treeIndent(depth) {
    return 8 + depth * 10;
}
