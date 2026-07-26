function decodeEntities(text) {
    return text.replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g, (_, name, dec, hex) => {
        if (dec)
            return String.fromCodePoint(Number(dec));
        if (hex)
            return String.fromCodePoint(parseInt(hex, 16));
        return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[name];
    });
}

const FIELD_PATTERN = /<field name="([^"]*)"([^>]*?)\/>|<field name="([^"]*)"[^>]*>([\s\S]*?)<\/field>/g;

export function parseMysqlXml(text) {
    const results = [];
    const resultsets = text.match(/<resultset\b[\s\S]*?<\/resultset>/g) || [];
    for (const chunk of resultsets) {
        const columns = [];
        const seen = new Set();
        const rows = [];
        const rowChunks = chunk.match(/<row>[\s\S]*?<\/row>/g) || [];
        const parsedRows = [];
        for (const rowChunk of rowChunks) {
            const fields = new Map();
            for (const match of rowChunk.matchAll(FIELD_PATTERN)) {
                const selfClosed = match[1] !== undefined;
                const name = decodeEntities(selfClosed ? match[1] : match[3]);
                const value = selfClosed
                    ? (/xsi:nil="true"/.test(match[2]) ? null : "")
                    : decodeEntities(match[4]);
                fields.set(name, value);
                if (!seen.has(name)) {
                    seen.add(name);
                    columns.push({ name });
                }
            }
            parsedRows.push(fields);
        }
        for (const fields of parsedRows)
            rows.push(columns.map((col) => (fields.has(col.name) ? fields.get(col.name) : null)));
        results.push({ columns, rows });
    }
    return results;
}
