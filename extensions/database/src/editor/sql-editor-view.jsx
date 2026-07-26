import { useEffect, useRef } from "react";
import { createSqlEditor } from "./sql-editor.js";

export function SqlEditorView({ engine, schema, initialDoc, viewRef, onDocChange, onRun, onRunAll }) {
    const hostRef = useRef(null);
    const callbacks = useRef({ onDocChange, onRun, onRunAll });
    callbacks.current = { onDocChange, onRun, onRunAll };

    useEffect(() => {
        const view = createSqlEditor(hostRef.current, {
            engine,
            doc: initialDoc,
            schema,
            onRun: () => callbacks.current.onRun?.(),
            onRunAll: () => callbacks.current.onRunAll?.(),
            onDocChange: (doc) => callbacks.current.onDocChange?.(doc),
        });
        viewRef.current = view;
        view.focus();
        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, []);

    return <div ref={hostRef} className="flex min-h-0 flex-1 flex-col" />;
}
