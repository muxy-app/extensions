import { useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileRow } from "@/components/file-row";

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

const STATUS_LABEL: Record<DiffFileStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "U",
  ignored: "I",
};

interface State {
  files: DiffFile[];
  active: string;
}

function DiffFileList({
  store,
  onSelect,
}: {
  store: DiffFileListView;
  onSelect: (itemId: string) => void;
}) {
  const { files, active } = useSyncExternalStore(store.subscribe, store.getState);
  return (
    <ul className="divide-y divide-border">
      {files.map((file) => (
        <FileRow
          key={file.itemId}
          path={file.path}
          label={STATUS_LABEL[file.status]}
          active={file.itemId === active}
          onOpen={() => onSelect(file.itemId)}
        />
      ))}
    </ul>
  );
}

export class DiffFileListView {
  private root: Root;
  private state: State = { files: [], active: "" };
  private listeners = new Set<() => void>();

  constructor(host: HTMLElement, onSelect: (itemId: string) => void) {
    this.root = createRoot(host);
    this.root.render(<DiffFileList store={this} onSelect={onSelect} />);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(next: State) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  setFiles(files: DiffFile[]) {
    this.set({ files, active: this.state.active });
  }

  setActive(itemId: string) {
    this.set({ files: this.state.files, active: itemId });
  }

  clear() {
    this.set({ files: [], active: "" });
  }
}
