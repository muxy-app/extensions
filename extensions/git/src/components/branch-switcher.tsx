import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, GitBranch, Plus, Trash2 } from "lucide-react";
import { list_branches } from "@/lib/git-branches";
import { try_action, confirm_action } from "@/lib/git";
import { run_pinned } from "@/lib/git-scope";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface BranchSwitcherProps {
  branch: string | null;
  ahead: number;
  behind: number;
}

export function BranchSwitcher({ branch, ahead, behind }: BranchSwitcherProps) {
  const [open, set_open] = useState(false);
  const [current, set_current] = useState<string | null>(null);
  const [branches, set_branches] = useState<string[]>([]);
  const [query, set_query] = useState("");

  async function reload() {
    const list = await list_branches();
    set_current(list.current);
    set_branches(list.branches);
  }

  useEffect(() => {
    void reload();
    const off_project = muxy.events.subscribe("project.switched", () => void reload());
    const off_worktree = muxy.events.subscribe("worktree.switched", () => void reload());
    return () => {
      off_project?.();
      off_worktree?.();
    };
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  async function select(name: string, create: boolean) {
    set_query("");
    set_open(false);
    await try_action(
      () =>
        run_pinned((project) =>
          create
            ? muxy.git.branch.create({ name, project })
            : muxy.git.branch.switchTo({ branch: name, project }),
        ),
      create ? "Could not create branch" : "Could not switch branch",
    );
  }

  async function remove(name: string) {
    const confirmed = await confirm_action({
      title: `Delete branch "${name}"?`,
      message: `This permanently deletes the local branch "${name}".`,
      confirmLabel: "Delete",
      critical: true,
    });
    if (!confirmed) return;
    const ok = await try_action(
      () => run_pinned((project) => muxy.git.branch.delete({ name, force: true, project })),
      "Could not delete branch",
    );
    if (ok) void reload();
  }

  const term = query.trim();
  const exact = branches.includes(term);

  return (
    <Popover open={open} onOpenChange={set_open}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-1.5 px-2.5 text-[12px] text-foreground outline-none hover:bg-accent"
        >
          <GitBranch size={13} strokeWidth={2} className="shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{branch ?? "No branch"}</span>
          {(ahead > 0 || behind > 0) && (
            <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
              {behind > 0 && (
                <span className="flex items-center">
                  <ArrowDown size={10} strokeWidth={2.5} />
                  {behind}
                </span>
              )}
              {ahead > 0 && (
                <span className="flex items-center">
                  <ArrowUp size={10} strokeWidth={2.5} />
                  {ahead}
                </span>
              )}
            </span>
          )}
          <ChevronDown size={12} strokeWidth={2.5} className="ml-auto shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0 text-popover-foreground">
        <Command>
          <CommandInput
            placeholder="Switch or create branch…"
            value={query}
            onValueChange={set_query}
            autoFocus
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <CommandList className="min-h-[9rem]">
            <CommandEmpty>No branches</CommandEmpty>
            {term && !exact && (
              <CommandGroup>
                <CommandItem value={`create-${term}`} onSelect={() => void select(term, true)}>
                  <Plus size={14} className="text-primary" />
                  <span className="truncate">
                    Create branch <span className="font-medium">“{term}”</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {branches.map((name) => (
                <BranchRow
                  key={name}
                  name={name}
                  active={name === current}
                  onSelect={() => void select(name, false)}
                  onDelete={() => void remove(name)}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface BranchRowProps {
  name: string;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function BranchRow({ name, active, onSelect, onDelete }: BranchRowProps) {
  return (
    <CommandItem
      value={name}
      onSelect={() => !active && onSelect()}
      className={cn("group justify-between gap-2", active && "font-semibold text-primary")}
    >
      <span className="flex min-w-0 items-center gap-2">
        {active ? (
          <Check size={13} className="shrink-0 text-primary" />
        ) : (
          <GitBranch size={13} className="shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{name}</span>
      </span>
      {!active && (
        <button
          type="button"
          title="Delete branch"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-diff-remove/15 hover:text-diff-remove group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      )}
    </CommandItem>
  );
}
