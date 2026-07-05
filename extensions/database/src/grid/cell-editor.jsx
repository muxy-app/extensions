import { useRef, useState } from "react";

export function editorKind(type) {
    const t = (type || "").toLowerCase();
    if (/bool|tinyint\(1\)/.test(t))
        return "bool";
    if (/int|serial|numeric|decimal|real|double|float|money/.test(t))
        return "number";
    return "text";
}

function BoolEditor({ value, nullable, onCommit, onCancel }) {
    const selected = value === null ? " null" : /^(1|t|true)$/i.test(String(value)) ? "true" : "false";
    return (
        <select
            autoFocus
            defaultValue={selected}
            onChange={(e) => onCommit(e.target.value === " null" ? null : e.target.value === "true")}
            onBlur={onCancel}
            onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        >
            <option value="true">true</option>
            <option value="false">false</option>
            {nullable ? <option value=" null">NULL</option> : null}
        </select>
    );
}

function TextEditor({ value, nullable, onCommit, onCancel }) {
    const nullBtnRef = useRef(null);
    const [text, setText] = useState(value === null ? "" : String(value));
    return (
        <div className="grid-cell-editor">
            <input
                type="text"
                className="mono"
                autoFocus
                value={text}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        onCommit(text);
                    } else if (e.key === "Escape") {
                        onCancel();
                    }
                }}
                onBlur={(e) => {
                    if (e.relatedTarget === nullBtnRef.current)
                        return;
                    onCommit(text);
                }}
            />
            {nullable ? (
                <button
                    ref={nullBtnRef}
                    className="icon-btn"
                    title="Set NULL"
                    onClick={() => onCommit(null)}
                >
                    ∅
                </button>
            ) : null}
        </div>
    );
}

export function CellEditor({ type, value, nullable, onCommit, onCancel }) {
    if (editorKind(type) === "bool")
        return <BoolEditor value={value} nullable={nullable} onCommit={onCommit} onCancel={onCancel} />;
    return <TextEditor value={value} nullable={nullable} onCommit={onCommit} onCancel={onCancel} />;
}
