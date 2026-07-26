import { useEffect, useState } from "react";

export function ScopeSelects({ session, onScopeChange }) {
    const [databases, setDatabases] = useState(null);
    const [schemas, setSchemas] = useState(null);
    const caps = session.driver.capabilities;

    useEffect(() => {
        let stale = false;
        (async () => {
            try {
                if (caps.databases) {
                    const list = await session.driver.listDatabases(session.ctx);
                    const current = session.ctx.database || session.conn.net?.database || "";
                    if (current && !list.includes(current))
                        list.unshift(current);
                    if (!stale)
                        setDatabases(list);
                }
                if (caps.schemas) {
                    const list = await session.driver.listSchemas(session.ctx);
                    const current = session.ctx.schema || "public";
                    if (!list.includes(current))
                        list.unshift(current);
                    if (!stale)
                        setSchemas(list);
                }
            } catch {
                return;
            }
        })();
        return () => { stale = true; };
    }, [session]);

    const currentDb = session.ctx.database || session.conn.net?.database || "";
    const currentSchema = session.ctx.schema || "public";

    return (
        <div className="flex items-center gap-[var(--s3)]">
            {caps.databases && databases ? (
                <select title="Database" value={currentDb} onChange={(e) => onScopeChange({ database: e.target.value })}>
                    {!currentDb ? (
                        <option value="" disabled>
                            database…
                        </option>
                    ) : null}
                    {databases.map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
                </select>
            ) : null}
            {caps.schemas && schemas ? (
                <select title="Schema" value={currentSchema} onChange={(e) => onScopeChange({ schema: e.target.value })}>
                    {schemas.map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
                </select>
            ) : null}
        </div>
    );
}
