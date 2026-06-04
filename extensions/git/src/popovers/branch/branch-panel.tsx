import { useEffect, useState } from "react";
import { Check, GitBranch, Plus, Trash2, X } from "lucide-react";
import { list_branches } from "@/lib/git-branches";
import { try_action, exec_git, active_worktree_path } from "@/lib/git";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function BranchPanel() {
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

  async function select(name: string, create: boolean) {
    const ok = await try_action(
      () => (create ? muxy.git.branch.create({ name }) : muxy.git.branch.switchTo({ branch: name })),
      create ? "Could not create branch" : "Could not switch branch",
    );
    if (ok) void muxy.popover.close();
  }

  async function remove(name: string) {
    const ok = await exec_git(
      await active_worktree_path(),
      ["branch", "-D", name],
      "Could not delete branch",
    );
    if (ok) void reload();
  }

  const term = query.trim();
  const exact = branches.includes(term);

  return (
    <div className="w-64 text-popover-foreground">
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
    </div>
  );
}

interface BranchRowProps {
  name: string;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function BranchRow({ name, active, onSelect, onDelete }: BranchRowProps) {
  const [confirming, set_confirming] = useState(false);

  if (confirming) {
    return (
      <CommandItem value={name} onSelect={() => {}} className="justify-between gap-2">
        <span className="min-w-0 truncate text-diff-remove">Delete “{name}”?</span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="Confirm delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex size-5 items-center justify-center rounded text-diff-remove hover:bg-diff-remove/15"
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            title="Cancel"
            onClick={(e) => {
              e.stopPropagation();
              set_confirming(false);
            }}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={13} />
          </button>
        </span>
      </CommandItem>
    );
  }

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
            set_confirming(true);
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-diff-remove/15 hover:text-diff-remove group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      )}
    </CommandItem>
  );
}
