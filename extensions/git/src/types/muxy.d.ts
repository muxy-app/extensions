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
  extension: { id: string; tabType: string; data?: Record<string, unknown> };
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
  projects: { list(): Promise<MuxyProject[]> };
  tabs: { open(target: MuxyOpenExtensionTab): Promise<void> };
  exec(argv: string[], options?: MuxyExecOptions): Promise<MuxyExecResult>;
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
