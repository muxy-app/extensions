import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  basename,
  error_message,
  open_externally,
  reveal_in_finder,
  try_action,
} from "@/lib/files";
import { is_markdown } from "@/lib/languages";
import { icon_for } from "@/lib/file-icon";
import { CodeEditor } from "@/editor/code-editor";
import { MarkdownEditor, type MarkdownMode } from "@/editor/markdown-editor";
import { SettingsSheet } from "@/editor/settings-sheet";
import {
  SaveIcon,
  RevealIcon,
  OpenIcon,
  SettingsIcon,
} from "@/editor/icons";
import { use_editor_config } from "@/hooks/use-editor-config";
import {
  clear_editor_state,
  create_editor_state_id,
  write_editor_state,
} from "@/lib/editor-state";

/** Imperative handle every editor child exposes so save() is editor-agnostic. */
export interface EditorHandle {
  getValue(): string;
  /** Open the find panel. No-op if the underlying editor isn't searchable. */
  openSearch(): void;
}

/** Props shared by both editor children. */
export interface EditorChildProps {
  value: string;
  isDark: boolean;
  onDirty: () => void;
  onSave: () => void | Promise<void>;
}

interface EditorData {
  filePath?: string;
  replaceable?: boolean;
}

function read_data(): EditorData {
  return (window.muxy?.data ?? {}) as EditorData;
}

export function Editor() {
  const [data, setData] = useState<EditorData>(read_data);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isDark, setIsDark] = useState(
    () => muxy.theme?.colorScheme === "dark",
  );
  const [showSettings, setShowSettings] = useState(false);
  const [mdMode, setMdMode] = useState<MarkdownMode>("preview");
  const [config, updateConfig] = use_editor_config();
  const editorStateId = useRef(create_editor_state_id());
  const dirtyRef = useRef(false);

  // The mounted child reassigns this ref; save() reads whichever is live.
  const editorRef = useRef<EditorHandle | null>(null);

  // Keep local state in sync with the tab's pushed data.
  useEffect(() => {
    const unsubscribe = muxy.onDataChange((next) => {
      setData((next ?? {}) as EditorData);
    });
    return unsubscribe;
  }, []);

  // Follow the host theme; the editors need only the light/dark base flag.
  useEffect(() => {
    const unsubscribe = muxy.onThemeChange((theme) => {
      setIsDark(theme.colorScheme === "dark");
    });
    return unsubscribe;
  }, []);

  const { filePath } = data;
  const replaceable = data.replaceable !== false;
  const markdown = filePath ? is_markdown(filePath) : false;

  // Reflect the open file in the tab bar (title = file name, icon = file type).
  // Overrides are runtime-only and reset to the manifest default on restart, so
  // we re-assert on every filePath change — which includes the post-restore
  // reload. With no file open, fall back to the manifest "Editor"/default icon.
  useEffect(() => {
    if (!filePath) {
      void muxy.tabs.setTitle("");
      void muxy.tabs.setIcon(null);
      return;
    }
    void muxy.tabs.setTitle(basename(filePath));
    void muxy.tabs.setIcon({ symbol: icon_for(filePath) });
  }, [filePath]);

  const publishEditorState = useCallback(
    (nextDirty = dirtyRef.current) => {
      write_editor_state(editorStateId.current, {
        dirty: nextDirty,
        filePath,
        replaceable,
      });
    },
    [filePath, replaceable],
  );

  useEffect(() => {
    dirtyRef.current = dirty;
    publishEditorState(dirty);
  }, [dirty, publishEditorState]);

  useEffect(() => {
    const heartbeat = window.setInterval(() => publishEditorState(), 2000);
    const clear = () => clear_editor_state(editorStateId.current);
    window.addEventListener("pagehide", clear);
    window.addEventListener("beforeunload", clear);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("beforeunload", clear);
      clear();
    };
  }, [publishEditorState]);

  // Load the file whenever the target path changes. A freshly loaded file is
  // clean; both editors avoid firing onDirty on programmatic value/remount.
  useEffect(() => {
    if (!filePath) {
      setContent(null);
      setError(null);
      setLoading(false);
      dirtyRef.current = false;
      setDirty(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    muxy.files
      .read(filePath)
      .then((file) => {
        if (cancelled) return;
        setContent(file.content);
        dirtyRef.current = false;
        setDirty(false);
        setMdMode("preview");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setContent(null);
        setError(error_message(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    publishEditorState(true);
    setDirty(true);
  }, [publishEditorState]);

  // Explicit save only — never autosave, so we don't race the file.changed watcher.
  const onSave = useCallback(async () => {
    if (!filePath || !editorRef.current || saving) return;
    const next = editorRef.current.getValue();
    setSaving(true);
    const ok = await try_action(
      () => muxy.files.write(filePath, next),
      "Save failed",
    );
    setSaving(false);
    if (ok) {
      dirtyRef.current = false;
      publishEditorState(false);
      setDirty(false);
    }
  }, [filePath, publishEditorState, saving]);

  // Cmd/Ctrl+S anywhere in the tab webview.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (e.shiftKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        void onSave();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onSave]);

  useEffect(() => {
    const unsubscribe = muxy.events.subscribe("command.files-save", () => {
      // Cmd+S is a global Muxy command shortcut, so it fans out to every open
      // editor tab. Only the focused tab should save — visibilityState alone is
      // unreliable for hosted webviews, so gate on actual focus.
      if (!document.hasFocus()) return;
      void onSave();
    });
    return unsubscribe;
  }, [onSave]);

  useEffect(() => {
    const unsubscribe = muxy.events.subscribe("command.files-find", () => {
      // Cmd+F is a global Muxy command shortcut (it never reaches the webview
      // on its own), so it fans out to every open editor tab — gate on focus
      // like save. Markdown Preview has no live editor; flip to Edit first so
      // there's something to search. The mode switch mounts the CodeEditor
      // asynchronously, so defer openSearch to the next frame in that case.
      if (!document.hasFocus()) return;
      if (markdown && mdMode === "preview") {
        setMdMode("edit");
        requestAnimationFrame(() => editorRef.current?.openSearch());
        return;
      }
      editorRef.current?.openSearch();
    });
    return unsubscribe;
  }, [markdown, mdMode]);

  const onReveal = useCallback(() => {
    if (filePath) void reveal_in_finder(filePath);
  }, [filePath]);

  const onOpen = useCallback(() => {
    if (filePath) void open_externally(filePath);
  }, [filePath]);

  if (!filePath) {
    return (
      <div className="editor">
        <div className="editor-empty">No file open</div>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="topbar">
        <div className="editor-title">
          <span className="editor-name">{basename(filePath)}</span>
          {dirty ? <span className="editor-dirty" aria-label="Unsaved" /> : null}
        </div>
        <div className="toolbar-actions">
          {markdown ? (
            <>
              <div className="segmented topbar-segmented" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mdMode === "preview"}
                  className={`segment${mdMode === "preview" ? " segment-active" : ""}`}
                  onClick={() => setMdMode("preview")}
                >
                  Preview
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mdMode === "edit"}
                  className={`segment${mdMode === "edit" ? " segment-active" : ""}`}
                  onClick={() => setMdMode("edit")}
                >
                  Edit
                </button>
              </div>
              <span className="toolbar-divider" />
            </>
          ) : null}
          <button
            className={`tool-button${dirty ? " tool-button-accent" : ""}`}
            type="button"
            aria-label="Save"
            title="Save"
            disabled={!dirty || saving}
            onClick={() => void onSave()}
          >
            <SaveIcon />
          </button>
          <button
            className="tool-button"
            type="button"
            aria-label="Reveal in Finder"
            title="Reveal in Finder"
            onClick={onReveal}
          >
            <RevealIcon />
          </button>
          <button
            className="tool-button"
            type="button"
            aria-label="Open externally"
            title="Open externally"
            onClick={onOpen}
          >
            <OpenIcon />
          </button>
          <span className="toolbar-divider" />
          <button
            className="tool-button"
            type="button"
            aria-label="Editor settings"
            title="Editor settings"
            onClick={() => setShowSettings(true)}
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
      <div className="editor-body">
        {loading ? (
          <div className="editor-status">Loading…</div>
        ) : error ? (
          <div className="editor-status editor-error">{error}</div>
        ) : content === null ? null : markdown ? (
          <MarkdownEditor
            key={filePath}
            ref={editorRef as Ref<EditorHandle>}
            filePath={filePath}
            value={content}
            isDark={isDark}
            config={config}
            mode={mdMode}
            onDirty={markDirty}
            onSave={onSave}
          />
        ) : (
          <CodeEditor
            ref={editorRef as Ref<EditorHandle>}
            filePath={filePath}
            value={content}
            isDark={isDark}
            config={config}
            onDirty={markDirty}
            onSave={onSave}
          />
        )}
      </div>
      {showSettings ? (
        <SettingsSheet
          config={config}
          update={updateConfig}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
    </div>
  );
}
