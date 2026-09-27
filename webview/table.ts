// The view's copy of a source, rebuilt from the worker's schema and row deltas.

import type { ColumnDelta, ColumnInfo, Format, Kind } from '../src/data/protocol';

export class Col {
    num: Float64Array = new Float64Array(0);
    codes: Int32Array = new Int32Array(0);
    dict: string[] = [];
    arrays: { row: number; values: Float64Array }[] = [];
    constructor(readonly name: string, readonly kind: Kind) {}
}

const ARRAY_HISTORY = 1000;

export class Table {
    columns: Col[] = [];
    private byName = new Map<string, Col>();
    /** Absolute row stored at index 0 of every column buffer. */
    private base = 0;
    /** One past the newest absolute row. */
    rows = 0;
    /** Oldest absolute row the worker still keeps. */
    offset = 0;
    file = '';
    format: Format = 'csv';
    /** Bumped on every change, so views can skip work when nothing moved. */
    version = 0;
    schemaVersion = 0;

    get start(): number { return Math.max(this.offset, this.base); }
    get length(): number { return Math.max(0, this.rows - this.start); }

    info(): ColumnInfo[] { return this.columns.map(c => ({ name: c.name, kind: c.kind })); }
    col(name: string): Col | undefined { return this.byName.get(name); }

    applySchema(file: string, format: Format, columns: ColumnInfo[]) {
        this.file = file;
        this.format = format;
        this.columns = columns.map(c => new Col(c.name, c.kind));
        this.byName = new Map(this.columns.map(c => [c.name, c]));
        this.base = 0; this.rows = 0; this.offset = 0;
        this.version++; this.schemaVersion++;
    }

    applyRows(first: number, count: number, dropped: number, deltas: ColumnDelta[]) {
        if (this.rows === 0 && first > 0) { this.base = first; }
        const end = first + count;
        const need = end - this.base;
        for (const d of deltas) {
            const c = this.byName.get(d.name);
            if (!c) { continue; }
            if (d.values) {
                if (c.num.length < need) { const b = new Float64Array(Math.max(need, c.num.length * 2, 1024)).fill(NaN); b.set(c.num); c.num = b; }
                c.num.set(d.values, first - this.base);
            }
            if (d.codes) {
                if (d.dict) { for (let k = 0; k < d.dict.length; k++) { c.dict[(d.dictStart ?? 0) + k] = d.dict[k]; } }
                if (c.codes.length < need) { const b = new Int32Array(Math.max(need, c.codes.length * 2, 1024)).fill(-1); b.set(c.codes); c.codes = b; }
                c.codes.set(d.codes, first - this.base);
            }
            if (d.packed && d.lengths && d.arrayRows) {
                let at = 0;
                for (let k = 0; k < d.lengths.length; k++) { c.arrays.push({ row: d.arrayRows[k], values: d.packed.subarray(at, at + d.lengths[k]) }); at += d.lengths[k]; }
                if (c.arrays.length > ARRAY_HISTORY * 1.25) { c.arrays.splice(0, c.arrays.length - ARRAY_HISTORY); }
            }
        }
        this.rows = Math.max(this.rows, end);
        this.offset = dropped;
        if (this.offset - this.base > 65536 && this.offset - this.base > (this.rows - this.base) / 2) { this.compact(); }
        this.version++;
    }

    /** Drop buffer space for rows the worker no longer keeps. */
    private compact() {
        const shift = this.offset - this.base;
        for (const c of this.columns) {
            if (c.kind === 'num' || c.kind === 'time') { c.num = c.num.slice(shift); }
            else if (c.kind === 'text') { c.codes = c.codes.slice(shift); }
        }
        this.base = this.offset;
    }

    /** Numbers (NaN for empty) for kept rows [a, b), relative to `start`. */
    numbers(name: string, a: number, b: number, limit?: number): Float64Array {
        const c = this.byName.get(name), s = this.start - this.base;
        if (!c || (c.kind !== 'num' && c.kind !== 'time')) { return new Float64Array(Math.max(0, b - a)).fill(NaN); }
        const endAbs = limit === undefined ? b : Math.min(b, limit - this.start);
        return c.num.subarray(s + a, s + Math.max(a, endAbs));
    }

    /** Text values (null for empty) for kept rows [a, b). */
    texts(name: string, a: number, b: number): (string | null)[] {
        const c = this.byName.get(name), s = this.start - this.base;
        if (!c || c.kind !== 'text') { return new Array(Math.max(0, b - a)).fill(null); }
        const out: (string | null)[] = new Array(b - a);
        for (let i = a; i < b; i++) { const k = c.codes[s + i]; out[i - a] = k >= 0 ? c.dict[k] : null; }
        return out;
    }

    /** Distinct text values in the order they first appear, from the kept rows. */
    categories(name: string): string[] {
        const c = this.byName.get(name);
        return c && c.kind === 'text' ? c.dict.slice() : [];
    }

    arrays(name: string, maxRow?: number): { row: number; values: Float64Array }[] {
        const c = this.byName.get(name);
        if (!c) { return []; }
        return maxRow === undefined ? c.arrays : c.arrays.filter(a => a.row < maxRow);
    }
}
