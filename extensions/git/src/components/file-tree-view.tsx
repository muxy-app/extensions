import { useEffect, useMemo, useRef, useState } from "react";
import type { GitStatus, GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import "@pierre/trees/web-components";
import { TREE_UNSAFE_CSS } from "@/lib/tree-theme";
import { status_letter } from "@/lib/tree-status";

interface FileTreeViewProps {
  paths: string[];
  gitStatus: GitStatusEntry[];
  onSelect: (path: string) => void;
  onAction?: (path: string) => void;
  staged?: boolean;
  fill?: boolean;
  maxHeight?: number;
}

export function FileTreeView({
  paths,
  gitStatus,
  onSelect,
  onAction,
  staged,
  fill,
  maxHeight = Infinity,
}: FileTreeViewProps) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const statusByPath = useMemo(() => {
    const map = new Map<string, GitStatus>();
    for (const entry of gitStatus) map.set(entry.path, entry.status);
    return map;
  }, [gitStatus]);
  const statusRef = useRef(statusByPath);
  statusRef.current = statusByPath;

  const { model } = useFileTree({
    paths,
    gitStatus,
    icons: "standard",
    flattenEmptyDirectories: true,
    initialExpansion: "open",
    itemHeight: 22,
    unsafeCSS: TREE_UNSAFE_CSS,
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: "button",
        buttonVisibility: "when-needed",
        onOpen: (item, context) => {
          context.close({ restoreFocus: false });
          if (item.kind === "file") onActionRef.current?.(item.path);
        },
      },
    },
    renderRowDecoration: ({ item }) => {
      const status = statusRef.current.get(item.path);
      return status ? { text: status_letter(status), title: status } : null;
    },
    onSelectionChange: (selected: readonly string[]) => {
      const path = selected[selected.length - 1];
      if (path && model.getItem(path)?.isDirectory() === false) onSelectRef.current(path);
    },
  });

  const [height, setHeight] = useState(model.getItemHeight());

  const firstPaths = useRef(true);
  useEffect(() => {
    if (firstPaths.current) firstPaths.current = false;
    else model.resetPaths(paths);
  }, [model, paths]);

  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) firstStatus.current = false;
    else model.setGitStatus(gitStatus);
  }, [model, gitStatus]);

  useEffect(() => {
    if (fill) return;
    const measure = () => {
      const root = model.getFileTreeContainer()?.shadowRoot;
      const scroller = root?.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll]");
      const content = scroller?.scrollHeight ?? 0;
      if (content > 0) setHeight(Math.min(content, maxHeight));
    };
    measure();
    return model.subscribe(measure);
  }, [model, maxHeight, fill]);

  return (
    <FileTree
      model={model}
      data-action={staged ? "unstage" : "stage"}
      style={{ height: fill ? "100%" : height }}
    />
  );
}
