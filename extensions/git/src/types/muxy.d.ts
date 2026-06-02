export {};

interface MuxyProject {
  path: string;
  isActive?: boolean;
}

interface MuxyExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

interface MuxyExecOptions {
  cwd?: string;
  timeoutMs?: number;
}

interface MuxyToastOptions {
  title?: string;
  body: string;
  variant?: "success" | "error" | "info" | "warning";
}

interface MuxyOpenExtensionTab {
  kind: "extensionWebView";
  extension: { id: string; tabType: string; singleton?: boolean; data?: Record<string, unknown> };
}

interface MuxyWorktree {
  id: string;
  name: string;
  path: string;
  branch?: string | null;
  isPrimary: boolean;
}

interface MuxyTheme {
  colorScheme: "light" | "dark";
  accent?: string;
}

interface MuxyBridge {
  extensionID: string;
  data?: Record<string, unknown>;
  theme?: MuxyTheme;
  onThemeChange?(handler: (theme: MuxyTheme) => void): void;
  onDataChange?(handler: (data: Record<string, unknown>) => void): void;
  projects: { list(): Promise<MuxyProject[]> };
  worktrees: {
    list(project?: string): Promise<MuxyWorktree[]>;
    switchTo(identifier: string, project?: string): Promise<void>;
    refresh(project?: string): Promise<void>;
  };
  tabs: { open(target: MuxyOpenExtensionTab): Promise<void> };
  panels: {
    open(panelID: string, data?: Record<string, unknown>): Promise<void>;
    toggle(panelID: string, data?: Record<string, unknown>): Promise<void>;
    close(panelID: string): Promise<void>;
  };
  exec(argv: string[], options?: MuxyExecOptions): Promise<MuxyExecResult>;
  exec(options: { shell: string; cwd?: string; timeoutMs?: number }): Promise<MuxyExecResult>;
  toast(opts: MuxyToastOptions): Promise<void>;
  notifications: {
    notify(opts: { title: string; body: string }): Promise<void>;
    toast(opts: MuxyToastOptions): Promise<void>;
  };
  events: {
    subscribe(name: string, handler: (payload: unknown) => void): () => void;
    unsubscribe(name: string, handler: (payload: unknown) => void): void;
  };
}

declare global {
  interface Window {
    muxy: MuxyBridge;
  }
  const muxy: MuxyBridge;
}
