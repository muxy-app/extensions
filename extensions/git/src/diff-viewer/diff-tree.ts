import { FileTree, type GitStatus, type GitStatusEntry } from "@pierre/trees";
import "@pierre/trees/web-components";
import { TREE_UNSAFE_CSS } from "@/lib/tree-theme";

export interface DiffTreeFile {
  path: string;
  itemId: string;
  status: GitStatus;
}

export class DiffTree {
  private model: FileTree | null = null;
  private byPath = new Map<string, string>();
  private byItem = new Map<string, string>();
  private suppress = false;

  constructor(
    private host: HTMLElement,
    private onSelect: (itemId: string) => void,
  ) {}

  render(files: DiffTreeFile[]) {
    this.byPath = new Map(files.map((f) => [f.path, f.itemId]));
    this.byItem = new Map(files.map((f) => [f.itemId, f.path]));
    const gitStatus: GitStatusEntry[] = files.map((f) => ({ path: f.path, status: f.status }));

    this.model?.cleanUp();
    this.host.replaceChildren();

    this.model = new FileTree({
      paths: files.map((f) => f.path),
      gitStatus,
      icons: "standard",
      flattenEmptyDirectories: true,
      initialExpansion: "open",
      itemHeight: 22,
      unsafeCSS: TREE_UNSAFE_CSS,
      onSelectionChange: (selected) => {
        if (this.suppress) return;
        const path = selected[selected.length - 1];
        if (!path) return;
        const itemId = this.byPath.get(path);
        if (itemId) this.onSelect(itemId);
      },
    });
    this.model.render({ fileTreeContainer: this.host });
  }

  setActive(itemId: string) {
    const path = this.byItem.get(itemId);
    if (!path || !this.model) return;
    this.suppress = true;
    this.model.getItem(path)?.select();
    this.model.scrollToPath(path, { offset: "nearest" });
    this.suppress = false;
  }

  clear() {
    this.model?.cleanUp();
    this.model = null;
    this.host.replaceChildren();
    this.byPath.clear();
    this.byItem.clear();
  }
}
