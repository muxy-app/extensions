import { branchNameFromTitle } from "@/lib/pr";
import { cls, h, readPref, writePref } from "@/lib/dom";
import { confirmAction, listBranches, openDiff } from "@/lib/git";
import { icon } from "@/lib/icons";
import type { FileEntry, GitStatus } from "@/lib/types";
import {
  button,
  closeFloating,
  fileRow,
  menuItem,
  openFloating,
  smallIconButton,
  textarea,
} from "@/ui/shared";
import type { GitPanelApp } from "@/panel/app";

const SECTION_PREFIX = "muxy.git.section.";

export function renderBranchSwitcher(app: GitPanelApp, status: GitStatus): HTMLButtonElement {
  return h(
    "button",
    {
      type: "button",
      class: "flex h-8 w-full items-center gap-1.5 px-2.5 text-[12px] text-foreground outline-none hover:bg-accent",
      onclick: (event) => openBranchMenu(app, event.currentTarget as HTMLElement),
    },
    icon("branch", 13, "text-muted-foreground", 2),
    h("span", { class: "truncate font-medium" }, status.branch ?? "No branch"),
    status.ahead > 0 || status.behind > 0
      ? h(
          "span",
          { class: "flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground" },
          status.behind > 0
            ? h("span", { class: "flex items-center" }, icon("arrowDown", 10, "", 2.5), String(status.behind))
            : null,
          status.ahead > 0
            ? h("span", { class: "flex items-center" }, icon("arrowUp", 10, "", 2.5), String(status.ahead))
            : null,
        )
      : null,
    icon("chevronDown", 12, "ml-auto text-muted-foreground", 2.5),
  );
}

export function renderBranchTab(app: GitPanelApp, status: GitStatus): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.appendChild(
    h(
      "section",
      { class: "flex flex-col gap-2 border-b border-border p-2.5" },
      renderCommitBox(app, status),
    ),
  );
  const clean = status.staged.length === 0 && status.unstaged.length === 0;
  fragment.appendChild(
    h(
      "main",
      { class: "flex min-h-0 flex-1 flex-col overflow-auto" },
      renderFileSection(app, {
        id: "staged",
        title: "Staged Changes",
        entries: status.staged,
        staged: true,
        bulkLabel: "Unstage all",
        onBulk: () => void app.unstageAll(),
        onAction: (path) => void app.unstage(path),
      }),
      renderFileSection(app, {
        id: "changes",
        title: "Changes",
        entries: status.unstaged,
        staged: false,
        bulkLabel: "Stage all",
        onBulk: () => void app.stageAll(),
        onAction: (path) => void app.stage(path),
        onDiscard: (path) => void discardOne(app, path),
        onBulkDiscard: () => void discardAll(app, status.unstaged.length),
      }),
      clean ? h("div", { class: "flex flex-col items-center gap-3 px-4 py-7 text-center text-muted-foreground" }, "No changes.") : null,
    ),
  );
  return fragment;
}

function renderCommitBox(app: GitPanelApp, status: GitStatus): HTMLDivElement {
  const disabled = status.staged.length === 0 || app.message.trim() === "" || app.commitBusy !== null;
  const area = textarea(
    app.message,
    "Commit message (Cmd+Enter to commit on branch)",
    1,
    (value) => app.setMessage(value),
    "min-h-[48px]",
  );
  area.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void commit(app);
    }
  });
  return h(
    "div",
    { class: "flex flex-col gap-2" },
    area,
    h(
      "div",
      { class: "flex" },
      button(app.commitBusy === "pull" ? "Pulling..." : app.commitBusy === "push" ? "Pushing..." : "Commit", {
        iconName: app.commitBusy === "pull" ? "arrowDown" : app.commitBusy === "push" ? "arrowUp" : "check",
        loading: app.commitBusy === "commit",
        variant: disabled ? "secondary" : "default",
        disabled,
        className: "flex-1 rounded-l-md rounded-r-none",
        onClick: () => void commit(app),
      }),
      h(
        "button",
        {
          type: "button",
          title: "Pull / Push",
          class: cls(
            "flex h-7 w-6 items-center justify-center rounded-l-none rounded-r-md border-l border-border/40 outline-none transition-colors",
            disabled ? "bg-secondary text-muted-foreground" : "bg-primary text-primary-foreground",
          ),
          onclick: (event) => openSyncMenu(app, event.currentTarget as HTMLElement),
        },
        icon("chevronDown", 12, "", 2.5),
      ),
    ),
  );
}

async function commit(app: GitPanelApp): Promise<void> {
  if (app.commitBusy || app.message.trim() === "") return;
  app.commitBusy = "commit";
  app.render();
  try {
    if (await app.commit(app.message.trim())) {
      app.message = "";
      app.render();
    }
  } finally {
    app.commitBusy = null;
    app.render();
  }
}

function openSyncMenu(app: GitPanelApp, anchor: HTMLElement): void {
  const content = h(
    "div",
    { class: "p-1" },
    menuItem("Pull", "arrowDown", () => {
      closeFloating();
      void runSync(app, "pull");
    }, { loading: app.commitBusy === "pull" }),
    menuItem("Push", "arrowUp", () => {
      closeFloating();
      void runSync(app, "push");
    }, { loading: app.commitBusy === "push" }),
  );
  openFloating(anchor, content, { width: 176, align: "end" });
}

async function runSync(app: GitPanelApp, op: "pull" | "push"): Promise<void> {
  if (app.commitBusy) return;
  app.commitBusy = op;
  app.render();
  try {
    await app.sync(op);
  } finally {
    app.commitBusy = null;
    app.render();
  }
}

function renderFileSection(
  app: GitPanelApp,
  opts: {
    id: string;
    title: string;
    entries: FileEntry[];
    staged: boolean;
    bulkLabel: string;
    onBulk: () => void;
    onAction: (path: string) => void;
    onDiscard?: (path: string) => void;
    onBulkDiscard?: () => void;
  },
): HTMLElement | null {
  if (opts.entries.length === 0) return null;
  const key = `${SECTION_PREFIX}${opts.id}`;
  const open = readPref<"true" | "false">(key, "true") !== "false";
  const toggle = () => {
    writePref(key, open ? "false" : "true");
    app.render();
  };
  return h(
    "section",
    { class: "flex shrink-0 flex-col" },
    h(
      "header",
      { class: "group sticky top-0 z-10 flex h-[26px] shrink-0 items-center bg-background pl-2 pr-2" },
      h(
        "button",
        {
          type: "button",
          class: "flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground",
          onclick: toggle,
        },
        h(
          "span",
          { class: "flex w-4 shrink-0 justify-center" },
          icon("chevronDown", 12, cls("transition-transform", !open && "-rotate-90"), 2.2),
        ),
        h("span", { class: "truncate text-[12px] font-semibold" }, opts.title),
      ),
      h(
        "span",
        { class: "ml-1.5 rounded-full bg-muted-foreground px-1.5 py-px text-[10px] font-bold leading-none text-background" },
        String(opts.entries.length),
      ),
      h(
        "div",
        { class: "ml-auto flex items-center text-muted-foreground opacity-0 group-hover:opacity-100" },
        opts.onBulkDiscard
          ? smallIconButton("Discard all changes", "undo", () => opts.onBulkDiscard?.())
          : null,
        smallIconButton(opts.bulkLabel, opts.staged ? "minus" : "plus", () => opts.onBulk()),
      ),
    ),
    open
      ? h(
          "ul",
          { class: "divide-y divide-border" },
          opts.entries.map((entry) =>
            fileRow(entry, {
              staged: opts.staged,
              onAction: opts.onAction,
              onDiscard: opts.onDiscard,
              onOpen: openDiff,
            }),
          ),
        )
      : null,
  );
}

async function discardOne(app: GitPanelApp, path: string): Promise<void> {
  const ok = await confirmAction({
    title: "Discard changes",
    message: `Are you sure you want to discard changes in ${path}? This cannot be undone.`,
    confirmLabel: "Discard",
    critical: true,
  });
  if (ok) void app.discard(path);
}

async function discardAll(app: GitPanelApp, count: number): Promise<void> {
  const ok = await confirmAction({
    title: "Discard all changes",
    message: `Are you sure you want to discard all ${count} changes? This cannot be undone.`,
    confirmLabel: "Discard All",
    critical: true,
  });
  if (ok) void app.discardAll();
}

function openBranchMenu(app: GitPanelApp, anchor: HTMLElement): void {
  const list = h("div", { class: "max-h-72 min-h-[9rem] overflow-auto p-1" });
  const search = h("input", {
    class: "h-8 w-full border-b border-border bg-transparent px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground",
    placeholder: "Switch or create branch...",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
  });
  const content = h("div", { class: "text-popover-foreground" }, search, list);
  const close = openFloating(anchor, content, { width: 256, align: "start" });
  let branches: string[] = [];
  let current: string | null = null;

  const render = () => {
    list.replaceChildren();
    const term = search.value.trim();
    const visible = term
      ? branches.filter((name) => name.toLowerCase().includes(term.toLowerCase()))
      : branches;
    if (term && !branches.includes(term)) {
      list.appendChild(
        menuItem(`Create branch "${term}"`, "plus", () => {
          close();
          void app.switchBranch(term, true);
        }),
      );
    }
    if (visible.length === 0 && !term) {
      list.appendChild(h("div", { class: "px-2 py-6 text-center text-[12px] text-muted-foreground" }, "No branches"));
    }
    for (const name of visible) {
      const active = name === current;
      const row = h(
        "button",
        {
          type: "button",
          class: cls(
            "group flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12px] outline-none hover:bg-accent",
            active ? "font-semibold text-primary" : "text-foreground",
          ),
          onclick: () => {
            if (active) return;
            close();
            void app.switchBranch(name, false);
          },
        },
        h(
          "span",
          { class: "flex min-w-0 items-center gap-2" },
          active ? icon("check", 13, "text-primary", 2) : icon("branch", 13, "text-muted-foreground", 2),
          h("span", { class: "truncate" }, name),
        ),
        active
          ? null
          : smallIconButton("Delete branch", "trash", (event) => {
              event.stopPropagation();
              void app.deleteBranch(name).then((ok) => {
                if (!ok) return;
                branches = branches.filter((branch) => branch !== name);
                render();
              });
            }, "opacity-0 group-hover:opacity-100 hover:text-diff-remove"),
      );
      list.appendChild(row);
    }
  };

  search.addEventListener("input", render);
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const term = search.value.trim();
    if (!term) return;
    const exact = branches.find((name) => name === term);
    close();
    void app.switchBranch(exact ?? term, !exact);
  });
  setTimeout(() => search.focus(), 0);
  void listBranches().then((result) => {
    current = result.current;
    branches = result.branches;
    render();
  });
}

export function updateCreateTitle(app: GitPanelApp, value: string, branchInput?: HTMLInputElement): void {
  app.createForm.title = value;
  if (!app.createForm.branchEdited) {
    app.createForm.newBranch = value.trim() ? branchNameFromTitle(value) : "";
    if (branchInput) branchInput.value = app.createForm.newBranch;
  }
}
