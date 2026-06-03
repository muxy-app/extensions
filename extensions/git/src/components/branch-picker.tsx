import { useState } from "react";
import { Check, ChevronDown, GitBranch, Plus, Trash2, X } from "lucide-react";
import type { BranchList } from "@/lib/git-branches";
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

interface BranchPickerProps {
  current: string;
  tracking: string;
  loadBranches: () => Promise<BranchList>;
  onCheckout: (name: string, create: boolean) => Promise<boolean>;
  onDeleteBranch: (name: string) => Promise<boolean>;
}

export function BranchPicker({
  current,
  tracking,
  loadBranches,
  onCheckout,
  onDeleteBranch,
}: BranchPickerProps) {
  const [open, set_open] = useState(false);
  const [branches, set_branches] = useState<string[]>([]);
  const [query, set_query] = useState("");

  function reload() {
    void loadBranches().then((list) => set_branches(list.branches));
  }

  function on_open(next: boolean) {
    set_open(next);
    if (next) reload();
    else set_query("");
  }

  async function select(name: string, create: boolean) {
    if (await onCheckout(name, create)) on_open(false);
  }

  async function remove(name: string) {
    if (await onDeleteBranch(name)) reload();
  }

  const term = query.trim();
  const exact = branches.includes(term);

  return (
    <Popover open={open} onOpenChange={on_open}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-6 items-center gap-1 rounded bg-muted px-1.5 text-foreground/85 outline-none"
        >
          <GitBranch className="shrink-0" size={11} strokeWidth={2} />
          <span className="max-w-[120px] truncate text-[10px] font-medium">{current}</span>
          {tracking && <span className="font-mono text-[10px] font-medium text-muted-foreground">{tracking}</span>}
          <ChevronDown className="shrink-0 text-muted-foreground" size={8} strokeWidth={2.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0">
        <Command>
          <CommandInput
            placeholder="Switch or create branch…"
            value={query}
            onValueChange={set_query}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <CommandList>
            <CommandEmpty>No branches</CommandEmpty>
            {term && !exact && (
              <CommandGroup>
                <CommandItem value={`create-${term}`} onSelect={() => void select(term, true)}>
                  <Plus size={14} className="text-primary" />
                  Create branch “{term}”
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
        <Check size={13} className={cn("shrink-0 text-primary", !active && "opacity-0")} />
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
