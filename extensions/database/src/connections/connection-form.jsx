import { useEffect, useState } from "react";
import { Modal } from "../ui/modal.jsx";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { ENGINES, COLORS, newConnection, saveConnection, listConnections } from "../lib/connections.js";
import { validate, applyPassword, testConnection } from "./form-logic.js";
import { Field, SqliteFields, NetFields, SshSection } from "./form-fields.jsx";

export function ConnectionFormModal({ existing, onSaved, onClose }) {
    const [conn, setConn] = useState(() => (existing ? JSON.parse(JSON.stringify(existing)) : newConnection("sqlite")));
    const [password, setPassword] = useState("");
    const [status, setStatus] = useState(null);
    const [groups, setGroups] = useState([]);
    const isNew = !existing;

    useEffect(() => {
        listConnections().then((all) => setGroups([...new Set(all.map((c) => c.group).filter(Boolean))]));
    }, []);

    const patch = (p) => setConn((prev) => ({ ...prev, ...p }));

    const switchEngine = (engine) => {
        const fresh = newConnection(engine);
        fresh.id = conn.id;
        fresh.name = conn.name;
        fresh.group = conn.group;
        fresh.color = conn.color;
        setConn(fresh);
    };

    const test = async () => {
        setStatus({ ok: true, message: "Testing…" });
        setStatus(await testConnection(conn, password));
    };

    const save = async () => {
        const problem = validate(conn);
        if (problem) {
            toast(problem, "warning");
            return;
        }
        try {
            const next = { ...conn };
            await applyPassword(next, password);
            await saveConnection(next);
            toast("Connection saved", "success");
            onClose();
            onSaved();
        } catch (error) {
            toast(error.message, "warning");
        }
    };

    return (
        <Modal
            icon="database"
            title={isNew ? "New Connection" : `Edit ${conn.name || "Connection"}`}
            onClose={onClose}
            footer={
                <>
                    <button className="btn" onClick={test}>
                        <Icon name="bolt" />
                        Test
                    </button>
                    <div className="flex-1" />
                    <button className="btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={save}>
                        <Icon name="check" />
                        Save
                    </button>
                </>
            }
        >
            <div className="sheet-body">
                {isNew ? (
                    <div className="field">
                        <label>Engine</label>
                        <div className="seg">
                            {Object.entries(ENGINES).map(([engine, def]) => (
                                <button key={engine} className={conn.engine === engine ? "active" : ""} onClick={() => switchEngine(engine)}>
                                    {def.label}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
                <datalist id="db-groups">
                    {groups.map((g) => (
                        <option key={g} value={g} />
                    ))}
                </datalist>
                <Field label="Name" value={conn.name} autoFocus onChange={(v) => patch({ name: v })} />
                <Field label="Group (optional)" value={conn.group} list="db-groups" onChange={(v) => patch({ group: v })} />
                <div className="field">
                    <label>Color</label>
                    <div className="flex items-center gap-[var(--s3)]">
                        {COLORS.map((color) => (
                            <button
                                key={color}
                                className="h-5 w-5 rounded-full"
                                style={{ background: color, outline: conn.color === color ? "2px solid var(--muxy-accent)" : "none", outlineOffset: "2px" }}
                                onClick={() => patch({ color })}
                            />
                        ))}
                    </div>
                </div>
                {conn.engine === "sqlite" ? <SqliteFields conn={conn} patch={patch} /> : <NetFields conn={conn} patch={patch} password={password} setPassword={setPassword} />}
                <SshSection conn={conn} patch={patch} />
            </div>
            {status ? (
                <div
                    className="mx-[var(--s7)] mb-[var(--s5)] rounded-[var(--radius-card)] border px-[var(--s5)] py-[var(--s4)] text-[var(--font-body)]"
                    style={{
                        borderColor: status.ok ? "var(--muxy-diff-add)" : "var(--muxy-diff-remove)",
                        color: status.ok ? "var(--muxy-diff-add)" : "var(--muxy-diff-remove)",
                    }}
                >
                    {status.message}
                </div>
            ) : null}
        </Modal>
    );
}
