// Pie, donut, rose, funnel, treemap and sunburst: shares of a whole.

import { base, tip, type Built, type Ctx, type Opt } from './ctx';
import { esc, fmt, groupBy, pal, uniqOrdered } from '../util';

function totals(ctx: Ctx) {
    const cat = ctx.one('cat')!, val = ctx.one('y'), cv = ctx.col(cat), labels = uniqOrdered(cv) as string[];
    const chosen = ctx.p.options.summary ?? 'sum', agg = chosen === 'mean' && !val ? 'count' : chosen;
    const vals = groupBy(cv, val ? ctx.num(val) : null, labels, agg);
    let items: Opt[] = labels.map((l, i) => ({ name: String(l), value: vals[i] ?? 0 })).sort((a, b) => b.value - a.value);
    const slices = ctx.p.options.slices ?? 8;
    if (items.length > slices) { const rest = items.slice(slices - 1); items = items.slice(0, slices - 1).concat([{ name: `Other (${rest.length})`, value: rest.reduce((s, x) => s + x.value, 0) }]); }
    items.forEach((it, i) => { it.itemStyle = { color: pal(i) }; });
    return { items, what: val ? `${agg} of ${ctx.name(val)}` : 'row counts' };
}

export function buildPie(ctx: Ctx, kind: 'pie' | 'donut' | 'rose'): Built {
    const V = ctx.V, { items, what } = totals(ctx);
    return {
        option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `${esc(p.name)}: <b>${fmt(p.value)}</b> (${p.percent}%)` }), series: [{ type: 'pie', id: 'pie', radius: kind === 'donut' ? ['36%', '58%'] : kind === 'rose' ? ['10%', '60%'] : ['0%', '58%'], roseType: kind === 'rose' ? 'area' : undefined, center: ['50%', '54%'], data: items, label: { color: V.fg, fontSize: 11, formatter: '{b}\n{d}%' }, labelLine: { lineStyle: { color: V.border } }, itemStyle: { borderColor: V.bg, borderWidth: 2 } }] }),
        summary: `${items.length} slices · ${what}`,
    };
}

export function buildFunnel(ctx: Ctx): Built {
    const V = ctx.V, { items, what } = totals(ctx);
    return { option: base(ctx, { tooltip: tip(V, 'item'), series: [{ type: 'funnel', id: 'fn', left: '10%', width: '80%', top: 10, bottom: 10, sort: 'descending', data: items, label: { position: 'inside', color: '#fff', fontSize: 11, formatter: (p: Opt) => `${p.name}: ${fmt(p.value)}` }, itemStyle: { borderColor: V.bg, borderWidth: 1 } }] }), summary: what };
}

interface Node { kids: Map<string, Node>; value: number }
export function buildTree(ctx: Ctx, sun: boolean): Built {
    const V = ctx.V, lv = ctx.slot('levels'), val = ctx.one('y'), Yv = val ? ctx.num(val) : null, cs = lv.map(c => ctx.col(c));
    const root: Node = { kids: new Map(), value: 0 };
    for (let j = 0; j < ctx.n; j++) {
        let node = root;
        const v = Yv ? (Yv[j] ?? 0) : 1;
        for (let k = 0; k < lv.length; k++) {
            const key = cs[k][j];
            if (key === null) { break; }
            let next = node.kids.get(String(key));
            if (!next) { next = { kids: new Map(), value: 0 }; node.kids.set(String(key), next); }
            node = next;
            node.value += v;
        }
    }
    const toArr = (m: Map<string, Node>, depth: number): Opt[] => [...m.entries()].map(([name, nd], i) => ({ name, value: nd.value, children: nd.kids.size ? toArr(nd.kids, depth + 1) : undefined, itemStyle: depth === 0 ? { color: pal(i) } : undefined }));
    const data = toArr(root.kids, 0);
    const s: Opt = sun
        ? { type: 'sunburst', id: 'sb', data, radius: [0, '92%'], center: ['50%', '52%'], label: { fontSize: 10, color: '#fff', rotate: 'radial', minAngle: 8 }, itemStyle: { borderColor: V.bg, borderWidth: 1.5 }, nodeClick: false, emphasis: { focus: 'ancestor' } }
        : { type: 'treemap', id: 'tm', data, roam: false, nodeClick: false, breadcrumb: { show: false }, top: 4, left: 4, right: 4, bottom: 4, label: { fontSize: 11, color: '#fff' }, upperLabel: { show: lv.length > 1, height: 18, color: '#fff', fontSize: 11 }, levels: [{ itemStyle: { borderColor: V.bg, borderWidth: 2, gapWidth: 2 } }, { colorSaturation: [0.35, 0.6], itemStyle: { gapWidth: 1, borderColorSaturation: 0.6 } }] };
    return { option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `${esc(p.treePathInfo ? p.treePathInfo.map((t: Opt) => t.name).filter(Boolean).join(' › ') : p.name)}: <b>${fmt(p.value)}</b>` }), series: [s] }), summary: val ? `sum of ${ctx.name(val)}` : 'row counts' };
}
