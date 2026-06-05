import { h } from "@/lib/dom";
import { fileRow } from "@/ui/shared";
const STATUS_LABEL = {
    added: "A",
    deleted: "D",
    modified: "M",
    renamed: "R",
    untracked: "U",
    ignored: "I",
};
export class DiffFileListView {
    host;
    onSelect;
    state = { files: [], active: "" };
    constructor(host, onSelect) {
        this.host = host;
        this.onSelect = onSelect;
        this.render();
    }
    setFiles(files) {
        this.state = { files, active: this.state.active };
        this.render();
    }
    setActive(itemId) {
        this.state = { files: this.state.files, active: itemId };
        this.render();
    }
    clear() {
        this.state = { files: [], active: "" };
        this.render();
    }
    render() {
        this.host.replaceChildren(h("ul", { class: "divide-y divide-border" }, this.state.files.map((file) => fileRow(toEntry(file), {
            active: file.itemId === this.state.active,
            onOpen: () => this.onSelect(file.itemId),
        }))));
    }
}
function toEntry(file) {
    return {
        path: file.path,
        label: STATUS_LABEL[file.status],
        added: null,
        removed: null,
    };
}
