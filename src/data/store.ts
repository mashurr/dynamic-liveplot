// Column store for one source. Rows are numbered from the start of the file; when the
// row budget is exceeded the oldest whole chunks are dropped and `offset` moves forward.

import type { ColumnDelta, ColumnInfo, Kind } from './protocol';

// Small enough that one chunk of a 10,000-column file stays within the cell budget
const CHUNK = 4096;
export const ARRAY_HISTORY = 1000;
export const DEFAULT_BUDGET_CELLS = 50_000_000;
export const DEFAULT_BUDGET_ROWS = 1_000_000;

interface Column {
    name: string;
    kind: Kind;
}

class NumColumn implements Column {
    chunks: Float64Array[] = [];
    constructor(public name: string, public kind: 'num' | 'time') {}
    set(row: number, v: number) {
        const c = Math.floor(row / CHUNK);
        while (this.chunks.length <= c) { this.chunks.push(new Float64Array(CHUNK).fill(NaN)); }
        this.chunks[c][row - c * CHUNK] = v;
    }
    get(row: number): number { const c = this.chunks[Math.floor(row / CHUNK)]; return c ? c[row % CHUNK] : NaN; }
    slice(from: number, to: number): Float64Array {
        const out = new Float64Array(to - from);
        for (let r = from; r < to;) {
            const c = Math.floor(r / CHUNK), start = r - c * CHUNK, n = Math.min(CHUNK - start, to - r);
            const chunk = this.chunks[c];
            if (chunk) { out.set(chunk.subarray(start, start + n), r - from); } else { out.fill(NaN, r - from, r - from + n); }
            r += n;
        }
        return out;
    }
    drop(chunks: number) { for (let i = 0; i < chunks; i++) { (this.chunks as (Float64Array | undefined)[])[i] = undefined; } }
}

class TextColumn implements Column {
    kind = 'text' as const;
    chunks: Int32Array[] = [];
    dict: string[] = [];
    index = new Map<string, number>();
    sentDict = 0;
    constructor(public name: string) {}
    code(v: string | null): number {
        if (v === null) { return -1; }
        let c = this.index.get(v);
        if (c === undefined) { c = this.dict.length; this.dict.push(v); this.index.set(v, c); }
        return c;
    }
    set(row: number, v: string | null) {
        const c = Math.floor(row / CHUNK);
        while (this.chunks.length <= c) { this.chunks.push(new Int32Array(CHUNK).fill(-1)); }
        this.chunks[c][row - c * CHUNK] = this.code(v);
    }
    slice(from: number, to: number): Int32Array {
        const out = new Int32Array(to - from);
        for (let r = from; r < to;) {
            const c = Math.floor(r / CHUNK), start = r - c * CHUNK, n = Math.min(CHUNK - start, to - r);
            const chunk = this.chunks[c];
            if (chunk) { out.set(chunk.subarray(start, start + n), r - from); } else { out.fill(-1, r - from, r - from + n); }
            r += n;
        }
        return out;
    }
    drop(chunks: number) { for (let i = 0; i < chunks; i++) { (this.chunks as (Int32Array | undefined)[])[i] = undefined; } }
}

class ArrayColumn implements Column {
    kind = 'array' as const;
    items: { row: number; values: Float64Array }[] = [];
    constructor(public name: string) {}
    set(row: number, v: Float64Array | null) {
        if (!v) { return; }
        this.items.push({ row, values: v });
        if (this.items.length > ARRAY_HISTORY * 1.25) { this.items.splice(0, this.items.length - ARRAY_HISTORY); }
    }
    since(from: number) { return this.items.filter(i => i.row >= from).slice(-ARRAY_HISTORY); }
}

type AnyColumn = NumColumn | TextColumn | ArrayColumn;
export type Cell = number | string | Float64Array | null;

export class Store {
    columns: AnyColumn[] = [];
    rows = 0;
    offset = 0;
    sent = 0;
    private budgetRows: number;
    private budgetCells: number;

    constructor(budgetCells = DEFAULT_BUDGET_CELLS, budgetRows = DEFAULT_BUDGET_ROWS) {
        this.budgetCells = budgetCells;
        this.budgetRows = budgetRows;
    }

    schema(): ColumnInfo[] { return this.columns.map(c => ({ name: c.name, kind: c.kind })); }

    addColumn(name: string, kind: Kind): number {
        const col = kind === 'text' ? new TextColumn(name) : kind === 'array' ? new ArrayColumn(name) : new NumColumn(name, kind);
        this.columns.push(col);
        return this.columns.length - 1;
    }

    /** Rows kept before trimming: the smaller of the row budget and cells ÷ width, in whole chunks. */
    keep(): number {
        return this.keepFor(this.columns.filter(c => c.kind !== 'array').length);
    }

    /** Append one row; `cells` lines up with `columns`. */
    append(cells: Cell[]) {
        const row = this.rows;
        for (let i = 0; i < this.columns.length; i++) {
            const col = this.columns[i], v = cells[i];
            if (col instanceof NumColumn) { col.set(row, typeof v === 'number' ? v : NaN); }
            else if (col instanceof TextColumn) { col.set(row, typeof v === 'string' ? v : null); }
            else { col.set(row, v instanceof Float64Array ? v : null); }
        }
        this.rows++;
        if (this.rows - this.offset > this.keep() + CHUNK) { this.trim(); }
    }

    private trim() {
        const target = this.rows - this.keep();
        const dropChunks = Math.floor(target / CHUNK);
        if (dropChunks * CHUNK <= this.offset) { return; }
        for (const c of this.columns) { if (!(c instanceof ArrayColumn)) { c.drop(dropChunks); } }
        this.offset = dropChunks * CHUNK;
    }

    /** Turn a number column into a text column, keeping its values as written numbers. */
    widenToText(index: number) {
        const old = this.columns[index];
        if (!(old instanceof NumColumn)) { return; }
        const col = new TextColumn(old.name);
        for (let r = this.offset; r < this.rows; r++) { const v = old.get(r); col.set(r, Number.isNaN(v) ? null : String(v)); }
        this.columns[index] = col;
    }

    /** Values for every column from `from` (or the oldest kept row) up to the newest row. */
    delta(from: number): { first: number; count: number; columns: ColumnDelta[] } {
        const first = Math.max(from, this.offset), to = this.rows;
        const columns: ColumnDelta[] = this.columns.map(c => {
            if (c instanceof NumColumn) { return { name: c.name, kind: c.kind, values: c.slice(first, to) }; }
            if (c instanceof TextColumn) {
                const d: ColumnDelta = { name: c.name, kind: 'text', codes: c.slice(first, to), dictStart: c.sentDict, dict: c.dict.slice(c.sentDict) };
                c.sentDict = c.dict.length;
                return d;
            }
            const items = c.since(first);
            const lengths = Int32Array.from(items, i => i.values.length);
            const packed = new Float64Array(lengths.reduce((s, n) => s + n, 0));
            let at = 0;
            for (const i of items) { packed.set(i.values, at); at += i.values.length; }
            return { name: c.name, kind: 'array', packed, lengths, arrayRows: Float64Array.from(items, i => i.row) };
        });
        return { first, count: Math.max(0, to - first), columns };
    }

    /** Rows the budget allows for a given number of columns. */
    keepFor(width: number): number {
        const rows = Math.min(this.budgetRows, Math.floor(this.budgetCells / Math.max(1, width)));
        return Math.max(CHUNK, Math.ceil(rows / CHUNK) * CHUNK);
    }

    /** Keep one row in `k` (an overview that needs a wider stride). Only valid while nothing was trimmed. */
    thin(k: number) {
        const n = Math.ceil(this.rows / k);
        this.columns = this.columns.map(c => {
            if (c instanceof NumColumn) { const o = new NumColumn(c.name, c.kind); for (let r = 0; r < n; r++) { o.set(r, c.get(r * k)); } return o; }
            if (c instanceof TextColumn) {
                const o = new TextColumn(c.name), codes = c.slice(0, this.rows);
                for (let r = 0; r < n; r++) { const code = codes[r * k]; o.set(r, code < 0 ? null : c.dict[code]); }
                return o;
            }
            const o = new ArrayColumn(c.name);
            o.items = c.items.filter(i => i.row % k === 0).map(i => ({ row: i.row / k, values: i.values }));
            return o;
        });
        this.rows = n;
        this.offset = 0;
        this.resend();
    }

    /** Forget what was sent, so the next delta carries every kept row and the whole dictionary. */
    resend() {
        this.sent = 0;
        for (const c of this.columns) { if (c instanceof TextColumn) { c.sentDict = 0; } }
    }
}
