// What a chart builder gets (columns sliced to the rows on show) and shared ECharts option helpers.

import type { Kind } from '../../src/data/protocol';
import { colInfo, dn, rowRange, S, type Plot } from '../state';
import { fmt, hexA, isDark, lastFinite, pal, palette } from '../util';

// ECharts options are large nested objects; builders assemble them freely
export type Opt = Record<string, any>;

export interface Chip { name: string; label?: string; color: string; value?: number | null }
export interface Built {
    option: Opt;
    chips?: Chip[] | null;
    summary?: string;
    /** Latest values checked against limits. */
    latest?: { name: string; value: number | null; axis: 'left' | 'right' }[];
}

export interface Theme { grid: string; axis: string; fg: string; muted: string; menu: string; menuBorder: string; border: string; err: string; live: string; accent: string; bg: string; mono: string; ui: string; dark: boolean }

/** Any CSS colour as rgba() with the given alpha (canvas can't use color-mix). */
export function alpha(color: string, a: number): string {
    const probe = document.createElement('span');
    probe.style.color = color;
    document.body.appendChild(probe);
    const m = getComputedStyle(probe).color.match(/[\d.]+/g);
    probe.remove();
    return m && m.length >= 3 ? `rgba(${m[0]},${m[1]},${m[2]},${a})` : color;
}

export function theme(): Theme {
    const cs = getComputedStyle(document.body), g = (n: string) => cs.getPropertyValue(n).trim();
    const fg = g('--vscode-foreground') || '#ccc';
    return {
        grid: alpha(fg, 0.1), axis: g('--vscode-descriptionForeground') || fg, fg, muted: g('--vscode-descriptionForeground') || fg,
        menu: g('--vscode-editorHoverWidget-background') || g('--vscode-editor-background'), menuBorder: g('--vscode-editorHoverWidget-border') || g('--vscode-widget-border') || fg,
        border: g('--vscode-panel-border') || g('--vscode-widget-border') || 'rgba(128,128,128,.4)', err: g('--vscode-errorForeground') || '#f14c4c', live: g('--vscode-charts-green') || '#3fb950',
        accent: g('--vscode-focusBorder') || '#0078d4', bg: g('--vscode-editor-background') || '#1e1e1e', mono: g('--vscode-editor-font-family') || 'monospace', ui: g('--vscode-font-family') || 'sans-serif', dark: isDark(),
    };
}

export interface Ctx {
    p: Plot;
    V: Theme;
    a: number;
    b: number;
    n: number;
    slot(id: string): string[];
    one(id: string): string | undefined;
    kind(c: string): Kind | undefined;
    /** Raw values: numbers (NaN for empty) for number/time columns, strings or null for text. */
    col(c: string): (number | string | null)[];
    /** Numbers with null for empty or non-numeric cells. */
    num(c: string): (number | null)[];
    name(c: string): string;
    color(c: string, i: number): string;
    style(c: string): { axis: 'left' | 'right'; smooth: number; width: number };
    arr(c: string): Float64Array;
    hist(c: string): { row: number; values: Float64Array }[];
    xc: string | null;
    timeX: boolean;
    x: (number | null)[];
    xName: string;
}

export function makeCtx(p: Plot, V: Theme): Ctx {
    const t = S.table, [a, b] = rowRange(p), cache = new Map<string, (number | string | null)[]>(), ncache = new Map<string, (number | null)[]>();
    const kind = (c: string) => colInfo(c)?.kind;
    const ctx: Ctx = {
        p, V, a, b, n: b - a,
        slot: id => (p.slots[id] ?? []).filter(c => colInfo(c)),
        one: id => ctx.slot(id)[0],
        kind,
        col: c => {
            let v = cache.get(c);
            if (!v) { v = kind(c) === 'text' ? t.texts(c, a, b) : Array.from(t.numbers(c, a, b)); cache.set(c, v); }
            return v;
        },
        num: c => {
            let v = ncache.get(c);
            if (!v) { v = kind(c) === 'text' ? new Array(b - a).fill(null) : Array.from(t.numbers(c, a, b), x => (Number.isFinite(x) ? x : null)); ncache.set(c, v); }
            return v;
        },
        name: c => p.series[c]?.name || dn(c),
        color: (c, i) => p.series[c]?.color || pal(i),
        style: c => ({ axis: p.series[c]?.axis ?? 'left', smooth: p.series[c]?.smooth ?? 0, width: p.series[c]?.width ?? 1.5 }),
        arr: c => {
            const items = t.arrays(c, S.paused ? S.pausedRows : undefined);
            return items.length ? items[items.length - 1].values : new Float64Array(0);
        },
        hist: c => t.arrays(c, S.paused ? S.pausedRows : undefined).slice(-200),
        xc: null, timeX: false, x: [], xName: 'row',
    };
    const xc = ctx.one('x');
    ctx.xc = xc && (kind(xc) === 'num' || kind(xc) === 'time') ? xc : null;
    ctx.timeX = !!ctx.xc && kind(ctx.xc) === 'time';
    if (ctx.xc) {
        ctx.x = ctx.timeX ? Array.from(t.numbers(ctx.xc, a, b), v => (Number.isFinite(v) ? v * 1000 : null)) : ctx.num(ctx.xc);
    } else {
        const first = t.start + a + 1;
        ctx.x = Array.from({ length: b - a }, (_, i) => first + i);
    }
    ctx.xName = ctx.xc ? dn(ctx.xc) : 'row';
    return ctx;
}

const hiddenMap = (p: Plot) => Object.fromEntries((p.hidden ?? []).map(n => [n, false]));
export function tip(V: Theme, trigger: 'axis' | 'item', extra: Opt = {}): Opt {
    return { trigger, confine: true, backgroundColor: V.menu, borderColor: V.menuBorder, textStyle: { color: V.fg, fontSize: 12 }, valueFormatter: (v: unknown) => (typeof v === 'number' ? fmt(v) : v), axisPointer: { type: trigger === 'axis' ? 'line' : 'none', lineStyle: { color: V.axis, type: 'dashed' }, label: { show: false } }, ...extra };
}
export function base(ctx: Ctx, extra: Opt = {}): Opt {
    const V = ctx.V;
    return { animation: false, backgroundColor: 'transparent', textStyle: { color: V.fg, fontFamily: V.ui, fontSize: 11 }, color: palette(), grid: { left: 10, right: 16, top: 18, bottom: 24, containLabel: true }, tooltip: tip(V, 'axis'), legend: { show: false, selected: hiddenMap(ctx.p) }, ...extra };
}
export const lab = (V: Theme): Opt => ({ color: V.axis, fontFamily: V.mono, fontSize: 10.5, hideOverlap: true });
export function ax(V: Theme, extra: Opt = {}): Opt {
    return { axisLine: { show: true, lineStyle: { color: V.border } }, axisTick: { lineStyle: { color: V.border } }, axisLabel: lab(V), splitLine: { show: true, lineStyle: { color: V.grid } }, nameTextStyle: { color: V.muted, fontFamily: V.mono, fontSize: 10.5 }, ...extra };
}
export const valAx = (V: Theme, name: string, extra: Opt = {}): Opt => ax(V, { type: 'value', scale: true, name, nameLocation: 'middle', nameGap: 24, axisLabel: { ...lab(V), formatter: (v: number) => fmt(v) }, ...extra });
export const catAx = (V: Theme, data: unknown[], name: string, extra: Opt = {}): Opt => ax(V, { type: 'category', data, name, nameLocation: 'middle', nameGap: 24, axisLabel: { ...lab(V), formatter: (v: unknown) => { const s = String(v); return s.length > 14 ? s.slice(0, 13) + '…' : s; } }, splitLine: { show: false }, ...extra });
export function cartX(ctx: Ctx): Opt {
    const V = ctx.V;
    return ax(V, { type: ctx.timeX ? 'time' : 'value', min: 'dataMin', max: 'dataMax', name: ctx.xName, nameLocation: 'middle', nameGap: 24, splitLine: { show: false }, axisLabel: { ...lab(V), formatter: ctx.timeX ? undefined : (v: number) => fmt(v) } });
}
export function cartY(ctx: Ctx, right: boolean): Opt {
    const o = ctx.p.options, log = right ? o.logRight : o.log;
    return valAx(ctx.V, '', { type: log ? 'log' : 'value', position: right ? 'right' : 'left', splitLine: { show: !right, lineStyle: { color: ctx.V.grid } } });
}

/** Phase shading, limit lines and min/max/average marks on x/y charts. */
export function applyMarks(ctx: Ctx, series: Opt[]) {
    const { p, V } = ctx;
    const s0 = series.find(s => !s.yAxisIndex && s.type !== 'custom') ?? series[0];
    if (!s0) { return; }
    const sh = ctx.one('shade');
    if (sh) {
        const cats = ctx.col(sh), X = ctx.x, areas: Opt[] = [];
        let st = 0;
        for (let j = 1; j <= cats.length; j++) {
            if (j === cats.length || cats[j] !== cats[st]) {
                if (cats[st] !== null) { areas.push([{ name: String(cats[st]), xAxis: X[st], itemStyle: { color: hexA(V.dark ? '#ffffff' : '#000000', areas.length % 2 ? 0.03 : 0.07) } }, { xAxis: X[Math.min(j, cats.length - 1)] }]); }
                st = j;
            }
        }
        s0.markArea = { silent: true, label: { color: V.muted, fontSize: 10, position: 'insideTopLeft', fontFamily: V.mono }, data: areas.slice(-60) };
    }
    const lines: Opt[] = (p.options.limits ?? []).map(L => ({ yAxis: L.value, lineStyle: { color: V.err, type: 'dashed', width: 1.2 }, label: { formatter: `${L.alert === 'above' ? 'max' : 'min'} ${fmt(L.value)}`, color: V.err, position: 'insideEndTop', fontSize: 10 } }));
    if (lines.length) { s0.markLine = { silent: true, symbol: 'none', animation: false, data: lines }; }
    if (p.options.stats) {
        for (const s of series.filter(x => x.type === 'line' || x.type === 'scatter')) {
            s.markPoint = { symbol: 'pin', symbolSize: 26, label: { fontSize: 9, formatter: (d: Opt) => fmt(d.value) }, data: [{ type: 'max' }, { type: 'min' }] };
            const ml = s.markLine ?? { silent: true, symbol: 'none', animation: false, data: [] };
            ml.data = ml.data.concat([{ type: 'average', lineStyle: { color: s.itemStyle?.color, type: 'dotted' }, label: { formatter: (d: Opt) => 'avg ' + fmt(d.value), color: V.muted, fontSize: 10, position: 'insideStartTop' } }]);
            s.markLine = ml;
        }
    }
}

export { lastFinite };
