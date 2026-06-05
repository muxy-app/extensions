import { active_git_project_path } from "@/lib/project-scope";

let resolved = false;
let cached: string | undefined;
let inflight: Promise<string | undefined> | null = null;

export async function active_project(): Promise<string | undefined> {
  if (resolved) return cached;
  if (!inflight) {
    inflight = active_git_project_path().then((value) => {
      cached = value;
      resolved = true;
      inflight = null;
      return value;
    });
  }
  return inflight;
}

function invalidate_project(): void {
  resolved = false;
  inflight = null;
  cached = undefined;
}

muxy.events.subscribe("project.switched", invalidate_project);
muxy.events.subscribe("worktree.switched", invalidate_project);

let depth = 0;
const listeners = new Set<(busy: boolean) => void>();

export function is_busy(): boolean {
  return depth > 0;
}

export function on_busy_change(fn: (busy: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set_depth(next: number): void {
  const was = depth > 0;
  depth = next;
  const now = depth > 0;
  if (was !== now) for (const fn of listeners) fn(now);
}

export async function run_pinned<T>(fn: (project?: string) => Promise<T>): Promise<T> {
  const project = await active_project();
  set_depth(depth + 1);
  try {
    return await fn(project);
  } finally {
    set_depth(depth - 1);
  }
}
