// Histograms, density curves, ECDFs, box plots, violins and strip plots: how values are spread.

import { base, catAx, lab, tip, valAx, type Built, type Ctx, type Opt } from './ctx';
import { dn } from '../state';
import { clamp, esc, fmt, fmtInt, hexA, jitter, kde, quart, trunc, uniqOrdered, pal } from '../util';

type Api = { value(i: number): number; coord(p: number[]): number[]; size(p: number[]): number[] };

export const rectItem = (color: string, op: number) => (_: unknown, api: Api) => {
    const a = api.coord([api.value(0), 0]), b = api.coord([api.value(1), api.value(2)]);
    return { type: 'rect', shape: { x: a[0] + 0.5, y: b[1], width: Math.max(1, b[0] - a[0] - 1), height: a[1] - b[1] }, style: { fill: hexA(color, op) } };
};

export interface Bins { lo: number; hi: number; nb: number; w: number }
export function binsFor(arrs: number[][], want?: number): Bins | null {
    let lo = Infinity, hi = -Infinity;
    for (const a of arrs) { for (const v of a) { if (v < lo) { lo = v; } if (v > hi) { hi = v; } } }
    if (!Number.isFinite(lo)) { return null; }
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const nb = want || clamp(Math.round(Math.sqrt(Math.max(...arrs.map(a => a.length)))), 8, 50);
    return { lo, hi, nb, w: (hi - lo) / nb };
}
export function countBins(vals: number[], B: Bins): number[] {
    const c = new Array(B.nb).fill(0);
    for (const v of vals) { c[Math.min(B.nb - 1, Math.floor((v - B.lo) / B.w))]++; }
    return c;
}
const finite = (a: (number | null)[]) => a.filter((v): v is number => v !== null);

export function buildHist(ctx: Ctx): Built {
    const V = ctx.V, cs = ctx.slot('y'), arrs = cs.map(c => finite(ctx.num(c))), B = binsFor(arrs, ctx.p.options.bins);
    if (!B) { throw new Error('No numbers to count yet.'); }
    const series: Opt[] = cs.map((c, i) => { const color = ctx.color(c, i); return { type: 'custom', id: c, name: ctx.name(c), data: countBins(arrs[i], B).map((n, k) => [B.lo + k * B.w, B.lo + (k + 1) * B.w, n]), encode: { x: [0, 1], y: 2 }, renderItem: rectItem(color, cs.length > 1 ? 0.5 : 0.8), itemStyle: { color } }; });
    return {
        option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `${esc(p.seriesName)}<br>${fmt(p.value[0])} to ${fmt(p.value[1])}: <b>${p.value[2]}</b>` }), xAxis: valAx(V, cs.length === 1 ? ctx.name(cs[0]) : 'value', { min: B.lo, max: B.hi, splitLine: { show: false } }), yAxis: valAx(V, 'count', { scale: false, min: 0, nameLocation: 'end', nameGap: 8 }), series }),
        chips: cs.map((c, i) => ({ name: ctx.name(c), color: ctx.color(c, i), label: `${ctx.name(c)} n=${fmtInt(arrs[i].length)}` })), summary: `${B.nb} bins`,
    };
}

export function buildDensity(ctx: Ctx, ecdf: boolean): Built {
    const V = ctx.V, cs = ctx.slot('y'), arrs = cs.map(c => finite(ctx.num(c))), B = binsFor(arrs);
    if (!B) { throw new Error('No numbers yet.'); }
    const pad = (B.hi - B.lo) * 0.08;
    const series: Opt[] = cs.map((c, i) => {
        const color = ctx.color(c, i);
        let data: number[][];
        if (ecdf) {
            const s = [...arrs[i]].sort((a, b) => a - b), step = Math.max(1, Math.floor(s.length / 400));
            data = [];
            for (let j = 0; j < s.length; j += step) { data.push([s[j], (j + 1) / s.length]); }
            if (s.length) { data.push([s[s.length - 1], 1]); }
        } else {
            data = kde(arrs[i], B.lo - pad, B.hi + pad, 90);
        }
        return { type: 'line', id: c, name: ctx.name(c), data, showSymbol: false, step: ecdf ? 'end' : false, smooth: !ecdf, itemStyle: { color }, lineStyle: { color, width: 1.6 }, areaStyle: ecdf ? undefined : { color: hexA(color, 0.14) } };
    });
    return {
        option: base(ctx, { xAxis: valAx(V, cs.length === 1 ? ctx.name(cs[0]) : 'value', { splitLine: { show: false } }), yAxis: valAx(V, ecdf ? 'share ≤ x' : 'density', { scale: false, min: 0, max: ecdf ? 1 : undefined, nameLocation: 'end', nameGap: 8 }), series }),
        chips: cs.map((c, i) => ({ name: ctx.name(c), color: ctx.color(c, i) })),
    };
}

function groupsOf(ctx: Ctx) {
    const cs = ctx.slot('y'), grp = ctx.one('group');
    if (grp) {
        const g = ctx.col(grp), Yv = ctx.num(cs[0]), labels = (uniqOrdered(g) as string[]).slice(0, 24);
        return { labels, sets: labels.map(l => Yv.filter((v, j): v is number => g[j] === l && v !== null)), colors: labels.map(() => ctx.color(cs[0], 0)), name: dn(grp) };
    }
    return { labels: cs.map(c => ctx.name(c)), sets: cs.map(c => finite(ctx.num(c))), colors: cs.map((c, i) => ctx.color(c, i)), name: '' };
}

export function buildBox(ctx: Ctx): Built {
    const V = ctx.V, G = groupsOf(ctx), qs = G.sets.map(quart), c0 = G.colors[0];
    return {
        option: base(ctx, { tooltip: tip(V, 'item'), xAxis: catAx(V, G.labels, G.name), yAxis: valAx(V, ''), series: [
            { type: 'boxplot', id: 'box', name: 'box', data: qs.map((q, k) => ({ value: q ? [q.lo, q.q1, q.med, q.q3, q.hi] : [], itemStyle: { color: hexA(G.colors[k] ?? c0, 0.22), borderColor: G.colors[k] ?? c0 } })), boxWidth: [6, 46] },
            { type: 'scatter', id: 'out', name: 'outliers', data: qs.flatMap((q, k) => (q ? q.out.slice(0, 80).map(v => [k, v]) : [])), symbolSize: 4, itemStyle: { color: c0 } }] }),
        summary: `${G.labels.length} groups`,
    };
}

export function buildViolin(ctx: Ctx): Built {
    const V = ctx.V, G = groupsOf(ctx), B = binsFor([G.sets.flat()]);
    if (!B) { throw new Error('No numbers yet.'); }
    const pad = (B.hi - B.lo) * 0.05, D = G.sets.map(s => kde(s, B.lo - pad, B.hi + pad, 48)), Q = G.sets.map(quart);
    return {
        option: base(ctx, { tooltip: { show: false }, xAxis: catAx(V, G.labels, G.name), yAxis: valAx(V, '', { min: B.lo - pad, max: B.hi + pad }), series: [{
            type: 'custom', id: 'violin', data: G.labels.map((_, k) => [k]), encode: { x: 0 },
            renderItem: (_: unknown, api: Api) => {
                const k = api.value(0), dens = D[k];
                if (!dens || !dens.length) { return undefined; }
                const bw = api.size([1, 0])[0] * 0.42, dmax = Math.max(...dens.map(d => d[1])) || 1, color = G.colors[k];
                const left: number[][] = [], right: number[][] = [];
                for (const [y, d] of dens) { const c = api.coord([k, y]), wv = bw * d / dmax; left.push([c[0] - wv, c[1]]); right.unshift([c[0] + wv, c[1]]); }
                const kids: Opt[] = [{ type: 'polygon', shape: { points: left.concat(right) }, style: { fill: hexA(color, 0.3), stroke: color, lineWidth: 1 } }];
                const q = Q[k];
                if (q) { const m = api.coord([k, q.med]); kids.push({ type: 'line', shape: { x1: m[0] - bw * 0.45, y1: m[1], x2: m[0] + bw * 0.45, y2: m[1] }, style: { stroke: color, lineWidth: 2 } }); }
                return { type: 'group', children: kids };
            },
        }] }),
        summary: `${G.labels.length} groups`,
    };
}

export function buildStrip(ctx: Ctx): Built {
    const V = ctx.V, G = groupsOf(ctx);
    const series: Opt[] = G.sets.map((s, k) => {
        const step = Math.max(1, Math.floor(s.length / 400)), d: number[][] = [];
        for (let j = 0; j < s.length; j += step) { d.push([k + jitter(j) * 0.6, s[j]]); }
        return { type: 'scatter', id: 'g' + k, name: G.labels[k], data: d, symbolSize: 4, itemStyle: { color: hexA(G.colors[k] ?? pal(k), 0.65) } };
    });
    return { option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `${esc(p.seriesName)}: ${fmt(p.value[1])}` }), xAxis: valAx(V, G.name, { min: -0.5, max: G.labels.length - 0.5, interval: 1, scale: false, splitLine: { show: false }, axisLabel: { ...lab(V), formatter: (v: number) => (Number.isInteger(v) ? trunc(G.labels[v] ?? '', 14) : '') } }), yAxis: valAx(V, ''), series }), summary: `${G.labels.length} groups` };
}
