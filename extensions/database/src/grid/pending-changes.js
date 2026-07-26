export function createChanges(engine, ref, info) {
    const keyColumns = info.primaryKey.length
        ? info.primaryKey
        : info.rowid
            ? ["__rowid"]
            : null;
    return { engine, ref, info, keyColumns, edits: new Map(), deletes: new Map(), inserts: [], insertCounter: 0 };
}

export function isEditable(changes) {
    return changes.keyColumns !== null;
}

export function rowKey(keyValues) {
    return JSON.stringify(keyValues);
}

export function setEdit(changes, keyValues, column, value, original) {
    const key = rowKey(keyValues);
    if (!changes.edits.has(key))
        changes.edits.set(key, { keyValues, cells: new Map(), originals: new Map() });
    const entry = changes.edits.get(key);
    if (!entry.originals.has(column))
        entry.originals.set(column, original);
    if (entry.originals.get(column) === value) {
        entry.cells.delete(column);
        if (!entry.cells.size)
            changes.edits.delete(key);
        return;
    }
    entry.cells.set(column, value);
}

export function getEdit(changes, keyValues, column) {
    const entry = changes.edits.get(rowKey(keyValues));
    if (entry && entry.cells.has(column))
        return { value: entry.cells.get(column), edited: true };
    return { edited: false };
}

export function toggleDelete(changes, keyValues) {
    const key = rowKey(keyValues);
    if (changes.deletes.has(key))
        changes.deletes.delete(key);
    else
        changes.deletes.set(key, keyValues);
}

export function isDeleted(changes, keyValues) {
    return changes.deletes.has(rowKey(keyValues));
}

export function addInsert(changes) {
    const insert = { id: ++changes.insertCounter, cells: new Map() };
    changes.inserts.push(insert);
    return insert;
}

export function removeInsert(changes, id) {
    changes.inserts = changes.inserts.filter((i) => i.id !== id);
}

export function changeCount(changes) {
    let edits = 0;
    for (const entry of changes.edits.values())
        edits += entry.cells.size;
    return edits + changes.deletes.size + changes.inserts.length;
}

export function clearChanges(changes) {
    changes.edits.clear();
    changes.deletes.clear();
    changes.inserts = [];
}
