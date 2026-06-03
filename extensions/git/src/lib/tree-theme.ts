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
  --trees-padding-inline-override: 8px;
  --trees-item-padding-x-override: 4px;
  --trees-item-margin-x-override: 0px;
  --trees-item-row-gap-override: 6px;
  --trees-level-gap-override: 10px;
  --trees-icon-width-override: 16px;
  --trees-git-lane-width-override: 10px;
  --trees-border-radius-override: 4px;
  --trees-scrollbar-gutter-override: 0px;
}

[data-item-section='decoration'] > span {
  padding-inline: 8px 4px;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--trees-item-git-status-color, var(--muxy-foreground-muted));
}

[data-type='context-menu-trigger'] {
  position: relative;
}

[data-type='context-menu-trigger'] > * {
  display: none;
}

[data-type='context-menu-trigger']::after {
  content: '+';
  font-size: 15px;
  font-weight: 500;
  line-height: 1;
}

:host([data-action='unstage']) [data-type='context-menu-trigger']::after {
  content: '\\2212';
}
`;
