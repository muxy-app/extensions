export const TREE_UNSAFE_CSS = `
:host {
  --trees-bg-override: transparent;
  --trees-fg-override: var(--muxy-foreground);
  --trees-fg-muted-override: var(--muxy-foreground-muted);
  --trees-accent-override: var(--muxy-accent);
  --trees-border-color-override: transparent;
  --trees-bg-muted-override: var(--muxy-hover);
  --trees-selected-bg-override: var(--muxy-surface);
  --trees-selected-fg-override: var(--muxy-foreground);
  --trees-indent-guide-bg-override: var(--muxy-border);
  --trees-scrollbar-thumb-override: var(--muxy-border);
  --trees-focus-ring-color-override: transparent;
  --trees-focus-ring-width-override: 0px;

  --trees-git-added-color-override: var(--muxy-diff-add);
  --trees-git-untracked-color-override: var(--muxy-diff-add);
  --trees-git-modified-color-override: var(--muxy-accent);
  --trees-git-renamed-color-override: var(--muxy-accent);
  --trees-git-deleted-color-override: var(--muxy-diff-remove);

  --trees-font-size-override: 12px;
  --trees-font-family-override: var(--muxy-font-family, system-ui);
  --trees-padding-inline-override: 4px;
  --trees-item-padding-x-override: 4px;
  --trees-item-margin-x-override: 2px;
  --trees-item-row-gap-override: 4px;
  --trees-level-gap-override: 8px;
  --trees-icon-width-override: 14px;
  --trees-git-lane-width-override: 10px;
  --trees-border-radius-override: 4px;
  --trees-scrollbar-gutter-override: 0px;
}
`;
