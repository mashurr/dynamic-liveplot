// The view's state: the source table, the layout of plots, and helpers over them.

import type { ColumnInfo, Kind } from '../src/data/protocol';
import type { GroupSpec, Layout, PlotOptions, PlotSpec, SeriesStyle, ViewToHost } from '../src/view/protocol';
import { TYPES, type Slot } from './charts/registry';
import { Table } from './table';
import { clone } from './util';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; setState(s: unknown): void; getState(): unknown };
export const vscode = acquireVsCodeApi();
export const send = (m: ViewToHost) => vscode.postMessage(m);

export interface Plot extends PlotSpec {
    id: number;
    series: Record<string, SeriesStyle>;
    options: PlotOptions;
    hidden?: string[];
}

export interface Banner { text: string; actions?: { label: string; run: () => void }[] }

export const S = {
    mode: 'file' as 'file' | 'folder',
    path: '',
    name: '',
    glUri: '',
    mapUri: '',
    table: new Table(),
    fileBindings: {} as Record<string, string>,
    bindings: {} as Record<string, string>,
    grid: { columns: 3, rows: 2 },
    plots: [] as Plot[],
    groups: [] as GroupSpec[],
    columnsHidden: false,
    linkZoom: true,
    sel: null as number | null,
    paused: false,
    pausedRows: 0,
    status: null as null | { state: string; bytesRead: number; size: number; rows: number; lastGrowth: number; badLines: number; file: string },
    banner: null as Banner | null,
    search: '',
    started: false,
    alerts: {} as Record<number, boolean>,
};

let nextId = 1;
export const uid = () => nextId++;

export function newPlot(title: string, type: string, slots: Record<string, string[]> = {}, extra: Partial<Plot> = {}): Plot {
    return { id: uid(), title, autoTitle: false, type, group: null, slots: clone(slots), series: {}, options: {}, ...extra };
}

export const cols = (): ColumnInfo[] => S.table.info();
export const colInfo = (name: string) => S.table.col(name);
export const kindOf = (name: string): Kind | undefined => S.table.col(name)?.kind;
export const applyBindings = (t: string, b: Record<string, string>) => t.replace(/\{([^{}]+)\}/g, (m, k) => (b && b[k] ? b[k] : m));
export const effectiveBindings = () => ({ ...S.fileBindings, ...S.bindings });
export const dn = (col: string) => applyBindings(col, effectiveBindings());

export function plotCols(p: PlotSpec): string[] {
    const out: string[] = [];
    for (const k of Object.keys(p.slots)) { for (const c of p.slots[k] ?? []) { if (!out.includes(c)) { out.push(c); } } }
    return out;
}
export function missingSlots(p: PlotSpec): Slot[] {
    const T = TYPES[p.type];
    if (!T) { return []; }
    return T.slots.filter(s => { const n = (p.slots[s.id] ?? []).filter(c => colInfo(c)).length; return (s.req && !n) || (s.min !== undefined && n < s.min); });
}
export const slotAccepts = (s: Slot, col: string) => { const k = kindOf(col); return !!k && s.kinds.includes(k); };
const slotOf = (p: PlotSpec, col: string) => Object.keys(p.slots).find(k => (p.slots[k] ?? []).includes(col)) ?? null;

/** Put a column in the best free slot. Returns the slot, 'dup' if already there, or null if nothing fits. */
export function autoAssign(p: PlotSpec, col: string): Slot | 'dup' | null {
    const T = TYPES[p.type];
    if (!T) { return null; }
    if (slotOf(p, col)) { return 'dup'; }
    const filled = (s: Slot) => (p.slots[s.id] ?? []).length;
    const order = [
        ...T.slots.filter(s => s.req && !filled(s)),
        ...T.slots.filter(s => s.max > 1 && filled(s) < s.max),
        ...T.slots.filter(s => !s.req && !filled(s)),
    ];
    const s = order.find(o => slotAccepts(o, col));
    if (!s) { return null; }
    (p.slots[s.id] ??= []).push(col);
    return s;
}

/** Re-home a plot's columns when its type changes; returns the columns that no longer fit. */
export function remapSlots(p: PlotSpec, type: string): string[] {
    const list = plotCols(p).filter(c => colInfo(c));
    p.type = type;
    p.slots = {};
    return list.filter(c => !autoAssign(p, c));
}

/** Kept rows [a, b) to show for a plot, relative to the table's start. */
export function rowRange(p: PlotSpec): [number, number] {
    const t = S.table, len = t.length;
    const end = S.paused ? Math.max(0, Math.min(len, S.pausedRows - t.start)) : len;
    let start = Math.max(0, (p.options?.skip ?? 0) - t.start);
    if (p.options?.window) { start = Math.max(start, end - p.options.window); }
    return [Math.min(start, end), end];
}

export function toLayout(): Layout {
    return {
        version: 1,
        grid: { ...S.grid },
        bindings: Object.keys(S.bindings).length ? { ...S.bindings } : undefined,
        groups: S.groups.length ? clone(S.groups) : undefined,
        plots: S.plots.map(({ id: _id, hidden: _h, ...p }) => clone(p)),
        view: { columnsHidden: S.columnsHidden, linkZoom: S.linkZoom },
    };
}

export function fromLayout(l: Layout) {
    S.grid = { columns: l.grid?.columns ?? 3, rows: l.grid?.rows ?? 2 };
    S.bindings = { ...(l.bindings ?? {}) };
    S.groups = clone(l.groups ?? []);
    S.plots = (l.plots ?? []).filter(p => TYPES[p.type]).map(p => ({ series: {}, options: {}, ...clone(p), id: uid() }));
    S.columnsHidden = !!l.view?.columnsHidden;
    S.linkZoom = l.view?.linkZoom ?? true;
    S.sel = null;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => send({ type: 'layout', layout: toLayout() }), 400);
}
