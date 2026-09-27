// JSON and JSON Lines records become flat rows: nested objects turn into `a.b` columns,
// lists of numbers stay lists (spectrum columns), and anything else nested becomes text.

export type Flat = Record<string, unknown>;

export function flatten(value: unknown, prefix = '', out: Flat = {}): Flat {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === 'object' && !Array.isArray(v)) { flatten(v, key, out); } else { out[key] = v; }
        }
    } else {
        out[prefix || 'value'] = value;
    }
    return out;
}

/** Rows from a whole JSON document: an array of records, a record of columns, or a record wrapping either. */
export function jsonRows(doc: unknown): Flat[] {
    if (Array.isArray(doc)) {
        if (doc.length && Array.isArray(doc[0]) && (doc[0] as unknown[]).every(v => typeof v === 'string')) {
            const [head, ...rest] = doc as unknown[][];
            return rest.map(r => Object.fromEntries((head as string[]).map((h, i) => [h, r[i]])));
        }
        return doc.map(r => flatten(r));
    }
    if (doc && typeof doc === 'object') {
        const entries = Object.entries(doc as Record<string, unknown>);
        const arrays = entries.filter(([, v]) => Array.isArray(v));
        if (arrays.length === 1 && (arrays[0][1] as unknown[]).some(v => v && typeof v === 'object')) { return jsonRows(arrays[0][1]); }
        if (arrays.length && arrays.length === entries.length) {
            const n = Math.max(...arrays.map(([, v]) => (v as unknown[]).length));
            const rows: Flat[] = [];
            for (let i = 0; i < n; i++) { rows.push(Object.fromEntries(arrays.map(([k, v]) => [k, (v as unknown[])[i]]))); }
            return rows;
        }
        return [flatten(doc)];
    }
    return [{ value: doc }];
}
