// Sankey, chord and network: amounts or links between named things.

import { base, tip, type Built, type Ctx, type Opt } from './ctx';
import { pal, uniqOrdered } from '../util';

export function buildFlow(ctx: Ctx, kind: 'sankey' | 'chord' | 'graph'): Built {
    const V = ctx.V, s = ctx.col(ctx.one('source')!), t = ctx.col(ctx.one('target')!), val = ctx.one('y'), Yv = val ? ctx.num(val) : null, m = new Map<string, number>();
    for (let j = 0; j < s.length; j++) {
        if (s[j] === null || t[j] === null || s[j] === t[j]) { continue; }
        const k = s[j] + '\u0000' + t[j];
        m.set(k, (m.get(k) ?? 0) + (Yv ? (Yv[j] ?? 0) : 1));
    }
    const links = [...m.entries()].map(([k, value]) => { const [source, target] = k.split('\u0000'); return { source, target, value }; });
    const nodes = uniqOrdered(links.flatMap(l => [l.source, l.target]));
    const data: Opt[] = nodes.map((n, i) => ({ name: n, itemStyle: { color: pal(i) } }));
    let series: Opt;
    if (kind === 'sankey') {
        series = { type: 'sankey', id: 'sk', data, links, left: '3%', right: '22%', top: 10, bottom: 10, nodeGap: 10, emphasis: { focus: 'adjacency' }, lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 }, label: { color: V.fg, fontSize: 11 } };
    } else if (kind === 'chord') {
        series = { type: 'chord', id: 'ch', data, links, radius: ['66%', '76%'], label: { color: V.fg, fontSize: 10 }, lineStyle: { color: 'source', opacity: 0.35 } };
    } else {
        const deg: Record<string, number> = {};
        for (const l of links) { deg[l.source] = (deg[l.source] ?? 0) + 1; deg[l.target] = (deg[l.target] ?? 0) + 1; }
        const mx = Math.max(1, ...links.map(l => l.value));
        series = { type: 'graph', id: 'gr', layout: 'force', roam: true, force: { repulsion: 160, edgeLength: [40, 110] }, data: data.map(d => ({ ...d, symbolSize: 10 + 5 * Math.sqrt(deg[d.name] ?? 1) })), links: links.map(l => ({ ...l, lineStyle: { width: 1 + 3 * l.value / mx } })), label: { show: nodes.length <= 30, color: V.fg, fontSize: 10, position: 'right' }, lineStyle: { color: V.axis, opacity: 0.6, curveness: 0.1 }, emphasis: { focus: 'adjacency' } };
    }
    return { option: base(ctx, { tooltip: tip(V, 'item'), series: [series] }), summary: `${nodes.length} nodes · ${links.length} links` };
}
