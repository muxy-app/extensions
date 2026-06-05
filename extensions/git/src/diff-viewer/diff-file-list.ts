import { h } from "@/lib/dom";
import type { FileEntry } from "@/lib/types";
import { fileRow } from "@/ui/shared";

export type DiffFileStatus =
  | "added"
  | "deleted"
  | "modified"
  | "renamed"
  | "untracked"
  | "ignored";

export interface DiffFile {
  path: string;
  itemId: string;
  status: DiffFileStatus;
}

interface State {
  files: DiffFile[];
  active: string;
}

const STATUS_LABEL: Record<DiffFileStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "U",
  ignored: "I",
};

export class DiffFileListView {
  private host: HTMLElement;
  private onSelect: (itemId: string) => void;
  private state: State = { files: [], active: "" };

  constructor(host: HTMLElement, onSelect: (itemId: string) => void) {
    this.host = host;
    this.onSelect = onSelect;
    this.render();
  }

  setFiles(files: DiffFile[]): void {
    this.state = { files, active: this.state.active };
    this.render();
  }

  setActive(itemId: string): void {
    this.state = { files: this.state.files, active: itemId };
    this.render();
  }

  clear(): void {
    this.state = { files: [], active: "" };
    this.render();
  }

  private render(): void {
    this.host.replaceChildren(
      h(
        "ul",
        { class: "divide-y divide-border" },
        this.state.files.map((file) =>
          fileRow(toEntry(file), {
            active: file.itemId === this.state.active,
            onOpen: () => this.onSelect(file.itemId),
          }),
        ),
      ),
    );
  }
}

function toEntry(file: DiffFile): FileEntry {
  return {
    path: file.path,
    label: STATUS_LABEL[file.status],
    added: null,
    removed: null,
  };
}
