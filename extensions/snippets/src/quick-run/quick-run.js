// Quick run: Muxy's native picker to choose a snippet, native prompts for its
// variables, then the snippet's default action. Runs as a `runScript` command.
import * as C from "@/lib/core.js";
import * as B from "@/lib/bridge.js";

const VERBS = { run: "Ran", insert: "Inserted", tab: "Opened" };

/** Picker rows, most recently used first. The subtitle is searchable too. */
export function pickerItems(state) {
  return C.rank(state, "", 100000).map(({ snippet, group }) => ({
    id: snippet.id,
    title: snippet.name,
    subtitle: `${group.name} · ${C.splitLines(snippet.command).join(" ⏎ ")}`,
  }));
}

/**
 * Asks for each variable with a native prompt. An empty answer keeps the last
 * used value or the default shown as the placeholder. Returns null when cancelled.
 */
export async function askVariables(snippet, prompt) {
  const initial = C.initialValues(snippet);
  const values = {};
  for (const v of C.parseVars(snippet.command)) {
    const fallback = initial[v.name] || "";
    const answer = await prompt({
      title: `${snippet.name}: ${v.name}`,
      placeholder: fallback ? `${fallback} (leave empty to use)` : "required",
    });
    if (answer == null) return null;
    values[v.name] = answer.trim() === "" ? fallback : answer;
  }
  return values;
}

export async function quickRun() {
  const state = await B.load();
  const item = await B.pick({
    placeholder: "Run a snippet…",
    emptyLabel: "No snippets yet. Add some in the Snippets panel.",
    noMatchLabel: "No matching snippets",
    items: pickerItems(state),
  });
  const snippet = item && state.snippets.find((s) => s.id === item.id);
  if (!snippet) return null;

  const values = C.parseVars(snippet.command).length ? await askVariables(snippet, B.prompt) : {};
  if (!values) return null;
  const missing = C.missingVars(snippet.command, values);
  if (missing.length) {
    await B.toast("Snippet not sent", `Missing: ${missing.join(", ")}`);
    return null;
  }

  try {
    const res = await B.execute(snippet, values, snippet.action, "focused");
    await B.save(C.recordUse(state, snippet.id, values));
    await B.toast(`${VERBS[snippet.action]} “${snippet.name}”`, `in ${res.where}`);
    return { snippet, values };
  } catch (err) {
    await B.toast("Snippet not sent", err.message || String(err));
    return null;
  }
}
