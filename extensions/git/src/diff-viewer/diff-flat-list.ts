import type { DiffTreeFile } from "./diff-tree";

const STATUS_LETTER: Record<DiffTreeFile["status"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "U",
  ignored: "I",
};

const STATUS_CLASS: Record<DiffTreeFile["status"], string> = {
  added: "s-add",
  untracked: "s-add",
  deleted: "s-del",
  modified: "s-mod",
  renamed: "s-mod",
  ignored: "s-mod",
};

const DOC_ICON = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>`;

function escapeHTML(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class DiffFlatList {
  constructor(
    private host: HTMLElement,
    private onSelect: (itemId: string) => void,
  ) {
    this.host.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(".file-row");
      if (row?.dataset.itemId) this.onSelect(row.dataset.itemId);
    });
  }

  render(files: DiffTreeFile[]) {
    const fragment = document.createDocumentFragment();
    for (const file of files) {
      const name = file.path.split("/").pop() ?? file.path;
      const dir = file.path.slice(0, file.path.length - name.length);
      const cls = STATUS_CLASS[file.status];
      const row = document.createElement("button");
      row.type = "button";
      row.className = "file-row";
      row.dataset.itemId = file.itemId;
      row.innerHTML = `
        <span class="status ${cls}">${STATUS_LETTER[file.status]}</span>
        <span class="doc ${cls}">${DOC_ICON}</span>
        <span class="name" title="${escapeHTML(file.path)}"><span class="name-base">${escapeHTML(name)}</span><span class="name-dir">${escapeHTML(dir)}</span></span>
      `;
      fragment.append(row);
    }
    this.host.replaceChildren(fragment);
  }

  setActive(itemId: string) {
    for (const row of this.host.querySelectorAll<HTMLElement>(".file-row")) {
      const active = row.dataset.itemId === itemId;
      row.classList.toggle("active", active);
      if (active) row.scrollIntoView({ block: "nearest" });
    }
  }

  clear() {
    this.host.replaceChildren();
  }
}
