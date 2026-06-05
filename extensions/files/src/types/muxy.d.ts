export {};

declare global {
  interface MuxyTheme {
    colorScheme: "light" | "dark";
    accent?: string;
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

  type MuxyIcon = string | { symbol: string } | { svg: string };

  interface MuxyOpenExtensionTab {
    kind: "extensionWebView";
    extension: { id: string; tabType: string; singleton?: boolean; data?: Record<string, unknown> };
  }

  /** Options accepted by every muxy.files.* call. Omit `project` to target the active project. */
  interface MuxyFilesOptions {
    project?: string;
  }

  interface MuxyFileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    isIgnored: boolean;
  }

  interface MuxyFileContent {
    path: string;
    content: string;
    size: number;
  }

  interface MuxyFileStat {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
  }

  interface MuxyFiles {
    list(path: string, opts?: MuxyFilesOptions): Promise<MuxyFileEntry[]>;
    read(path: string, opts?: MuxyFilesOptions): Promise<MuxyFileContent>;
    stat(path: string, opts?: MuxyFilesOptions): Promise<MuxyFileStat>;
    write(path: string, content: string, opts?: MuxyFilesOptions): Promise<{ path: string }>;
    mkdir(path: string, opts?: MuxyFilesOptions): Promise<{ path: string }>;
    rename(oldPath: string, newPath: string, opts?: MuxyFilesOptions): Promise<{ path: string }>;
    move(paths: string[], destination: string, opts?: MuxyFilesOptions): Promise<string[]>;
    delete(paths: string[], opts?: MuxyFilesOptions): Promise<void>;
  }

  interface MuxyDialog {
    confirm(opts: {
      title?: string;
      message?: string;
      buttons?: string[];
      default?: string;
      cancel?: string;
      style?: "info" | "warning" | "critical";
    }): Promise<string | null>;
    alert(opts: {
      title?: string;
      message?: string;
      style?: "info" | "warning" | "critical";
    }): Promise<void>;
  }

  interface MuxyBridge {
    extensionID: string;
    data: Record<string, unknown> | null;
    theme?: MuxyTheme;
    onThemeChange(handler: (theme: MuxyTheme) => void): () => void;
    onDataChange(handler: (data: Record<string, unknown> | null) => void): () => void;
    files: MuxyFiles;
    tabs: {
      open(target: MuxyOpenExtensionTab): Promise<void>;
      /** Retitle this tab. An empty string resets to the manifest default. */
      setTitle(title: string): Promise<void>;
      /** Set this tab's icon. null resets to the default extension icon. */
      setIcon(icon: MuxyIcon | null): Promise<void>;
    };
    panels: {
      open(panelID: string, data?: Record<string, unknown>): Promise<void>;
      toggle(panelID: string, data?: Record<string, unknown>): Promise<void>;
      close(panelID: string): Promise<void>;
    };
    topbar: {
      set(opts: { id: string; icon?: MuxyIcon; visible?: boolean }): Promise<void>;
      show(id: string): Promise<void>;
      hide(id: string): Promise<void>;
    };
    dialog: MuxyDialog;
    exec(argv: string[], options?: MuxyExecOptions): Promise<MuxyExecResult>;
    toast(opts: MuxyToastOptions): Promise<void>;
    events: {
      subscribe(name: string, handler: (payload: unknown) => void): () => void;
    };
  }

  interface Window {
    muxy: MuxyBridge;
  }
  const muxy: MuxyBridge;
}
