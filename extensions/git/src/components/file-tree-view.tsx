import { useEffect, useRef, useState } from "react";
import type { GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import "@pierre/trees/web-components";
import { TREE_UNSAFE_CSS } from "@/lib/tree-theme";

interface FileTreeViewProps {
  paths: string[];
  gitStatus: GitStatusEntry[];
  onSelect: (path: string) => void;
  fill?: boolean;
  maxHeight?: number;
}

export function FileTreeView({ paths, gitStatus, onSelect, fill, maxHeight = 360 }: FileTreeViewProps) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const { model } = useFileTree({
    paths,
    gitStatus,
    icons: "standard",
    flattenEmptyDirectories: true,
    initialExpansion: "open",
    itemHeight: 22,
    unsafeCSS: TREE_UNSAFE_CSS,
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

  return <FileTree model={model} style={{ height: fill ? "100%" : height }} />;
}
