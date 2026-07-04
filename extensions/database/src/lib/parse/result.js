export function makeResult({ columns = [], rows = [], affectedRows = null, commandTag = "", durationMs = 0, truncated = false }) {
    return { columns, rows, affectedRows, commandTag, durationMs, truncated };
}

export function fromObjects(objects) {
    if (!objects.length)
        return makeResult({});
    const names = Object.keys(objects[0]);
    const rows = objects.map((obj) => names.map((name) => normalizeValue(obj[name])));
    return makeResult({ columns: names.map((name) => ({ name })), rows });
}

function normalizeValue(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "object")
        return JSON.stringify(value);
    return String(value);
}

export function parseJsonStream(text) {
    const values = [];
    let index = 0;
    const length = text.length;
    while (index < length) {
        while (index < length && /\s/.test(text[index]))
            index++;
        if (index >= length)
            break;
        const parsed = parseOne(text, index);
        if (!parsed)
            break;
        values.push(parsed.value);
        index = parsed.end;
    }
    return values;
}

function parseOne(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (ch === "\\")
                escaped = true;
            else if (ch === '"')
                inString = false;
            continue;
        }
        if (ch === '"')
            inString = true;
        else if (ch === "[" || ch === "{")
            depth++;
        else if (ch === "]" || ch === "}") {
            depth--;
            if (depth === 0) {
                try {
                    return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 };
                }
                catch {
                    return null;
                }
            }
        }
    }
    return null;
}
