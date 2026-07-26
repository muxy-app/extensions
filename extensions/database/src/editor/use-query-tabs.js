import { useCallback, useEffect, useRef, useState } from "react";
import { getDrafts, setDrafts } from "../lib/storage.js";

function seedState(drafts) {
    const tabs = (drafts?.tabs || []).map((t) => ({ ...t, results: null }));
    if (!tabs.length)
        tabs.push({ id: 1, title: "Query 1", sql: "", results: null });
    return {
        tabs,
        activeId: drafts?.activeId && tabs.some((t) => t.id === drafts.activeId) ? drafts.activeId : tabs[0].id,
        counter: Math.max(...tabs.map((t) => t.id)),
        loadedDrafts: Boolean(drafts),
    };
}

export function useQueryTabs(session) {
    const [state, setState] = useState(() => session.queryState || seedState(null));
    const persistTimer = useRef(null);

    if (!session.queryState)
        session.queryState = state;

    useEffect(() => {
        if (session.queryState.loadedDrafts)
            return;
        let stale = false;
        getDrafts(session.conn.id).then((drafts) => {
            if (stale || !drafts)
                return;
            const seeded = seedState(drafts);
            session.queryState = seeded;
            setState(seeded);
        });
        return () => { stale = true; };
    }, [session]);

    const persist = useCallback(
        (next) => {
            session.queryState = next;
            clearTimeout(persistTimer.current);
            persistTimer.current = setTimeout(() => {
                setDrafts(session.conn.id, {
                    tabs: next.tabs.map((t) => ({ id: t.id, title: t.title, sql: t.sql })),
                    activeId: next.activeId,
                }).catch(() => undefined);
            }, 400);
        },
        [session],
    );

    useEffect(() => () => clearTimeout(persistTimer.current), []);

    const update = useCallback(
        (updater, { persistDrafts = false } = {}) => {
            setState((prev) => {
                const next = updater(prev);
                session.queryState = next;
                if (persistDrafts)
                    persist(next);
                return next;
            });
        },
        [session, persist],
    );

    return { state, update };
}
