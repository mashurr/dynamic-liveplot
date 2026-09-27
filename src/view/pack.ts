// VS Code's webview messaging loses most typed arrays when one message carries hundreds of them (a
// 500-column file got data for its first 4 columns). The host packs every column's arrays into one
// Float64Array and one Int32Array; the view unpacks them as views, without copying.

import type { ColumnDelta } from '../data/protocol';

type Ref = [number, number];
export interface Packed { f64: Float64Array; i32: Int32Array; at: { v?: Ref; c?: Ref; p?: Ref; l?: Ref; r?: Ref }[] }

export function packDeltas(cols: ColumnDelta[]): { columns: ColumnDelta[]; packed: Packed } {
    let nf = 0, ni = 0;
    for (const c of cols) { nf += (c.values?.length ?? 0) + (c.packed?.length ?? 0) + (c.arrayRows?.length ?? 0); ni += (c.codes?.length ?? 0) + (c.lengths?.length ?? 0); }
    const f64 = new Float64Array(nf), i32 = new Int32Array(ni);
    let af = 0, ai = 0;
    const f = (a?: Float64Array): Ref | undefined => { if (!a) { return undefined; } f64.set(a, af); af += a.length; return [af - a.length, a.length]; };
    const i = (a?: Int32Array): Ref | undefined => { if (!a) { return undefined; } i32.set(a, ai); ai += a.length; return [ai - a.length, a.length]; };
    const at: Packed['at'] = [];
    const columns = cols.map(c => {
        at.push({ v: f(c.values), p: f(c.packed), r: f(c.arrayRows), c: i(c.codes), l: i(c.lengths) });
        const { values: _v, packed: _p, arrayRows: _r, codes: _c, lengths: _l, ...rest } = c;
        return rest;
    });
    return { columns, packed: { f64, i32, at } };
}

export function unpackDeltas(columns: ColumnDelta[], p: Packed): ColumnDelta[] {
    const f = (r?: Ref) => (r ? p.f64.subarray(r[0], r[0] + r[1]) : undefined), i = (r?: Ref) => (r ? p.i32.subarray(r[0], r[0] + r[1]) : undefined);
    return columns.map((c, k) => {
        const a = p.at[k], out: ColumnDelta = { ...c };
        if (a.v) { out.values = f(a.v); }
        if (a.p) { out.packed = f(a.p); }
        if (a.r) { out.arrayRows = f(a.r); }
        if (a.c) { out.codes = i(a.c); }
        if (a.l) { out.lengths = i(a.l); }
        return out;
    });
}
