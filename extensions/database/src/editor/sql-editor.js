import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { sql, PostgreSQL, MySQL, MariaSQL, SQLite } from "@codemirror/lang-sql";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { muxyTheme } from "./editor-theme.js";

const DIALECTS = { postgres: PostgreSQL, mysql: MySQL, mariadb: MariaSQL, sqlite: SQLite };

export function createSqlEditor(parent, { engine, doc = "", schema = {}, onRun, onRunAll, onDocChange }) {
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc,
            extensions: [
                lineNumbers(),
                highlightActiveLineGutter(),
                history(),
                drawSelection(),
                highlightActiveLine(),
                highlightSelectionMatches(),
                closeBrackets(),
                autocompletion(),
                keymap.of([
                    { key: "Mod-Enter", run: () => (onRun ? (onRun(), true) : false) },
                    { key: "Shift-Mod-Enter", run: () => (onRunAll ? (onRunAll(), true) : false) },
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...historyKeymap,
                    ...searchKeymap,
                    ...completionKeymap,
                    indentWithTab,
                ]),
                sql({ dialect: DIALECTS[engine] || SQLite, schema, upperCaseKeywords: true }),
                muxyTheme(),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged && onDocChange)
                        onDocChange(update.state.doc.toString());
                }),
            ],
        }),
    });
    return view;
}

export function selectedSql(view) {
    const range = view.state.selection.main;
    if (!range.empty)
        return view.state.sliceDoc(range.from, range.to);
    return null;
}

export function insertSql(view, text) {
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
    });
    view.focus();
}
