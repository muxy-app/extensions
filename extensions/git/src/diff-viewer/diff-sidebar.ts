import { DiffTree, type DiffTreeFile } from "./diff-tree";
import { DiffFlatList } from "./diff-flat-list";

export type DiffViewMode = "tree" | "flat";

export class DiffSidebar {
  private tree: DiffTree;
  private flat: DiffFlatList;
  private files: DiffTreeFile[] = [];
  private active = "";

  constructor(
    private host: HTMLElement,
    onSelect: (itemId: string) => void,
    private mode: DiffViewMode,
  ) {
    this.tree = new DiffTree(host, onSelect);
    this.flat = new DiffFlatList(host, onSelect);
  }

  private get current() {
    return this.mode === "tree" ? this.tree : this.flat;
  }

  setMode(mode: DiffViewMode) {
    if (mode === this.mode) return;
    this.current.clear();
    this.mode = mode;
    this.host.dataset.view = mode;
    if (this.files.length) {
      this.current.render(this.files);
      if (this.active) this.current.setActive(this.active);
    }
  }

  render(files: DiffTreeFile[]) {
    this.files = files;
    this.host.dataset.view = this.mode;
    this.current.render(files);
  }

  setActive(itemId: string) {
    this.active = itemId;
    this.current.setActive(itemId);
  }

  clear() {
    this.files = [];
    this.active = "";
    this.current.clear();
  }
}
