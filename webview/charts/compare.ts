// Bars, stacked bars, lollipops, waterfalls and radar: comparing values across categories.

import { base, catAx, tip, valAx, type Built, type Ctx, type Opt, type Chip } from './ctx';
import { dn, S } from '../state';
import { AGGS, fmt, fmtTime, groupBy, hexA, lastFinite, pal, stats, trunc, uniqOrdered } from '../util';

interface CatData { labels: string[]; sers: { id: string; name: string; color: string; data: (number | null)[] }[]; catName: string; what: string }

export function catData(ctx: Ctx): CatData {
    const agg = ctx.p.options.summary ?? 'mean', cat = ctx.one('cat'), vals = ctx.slot('y'), split = ctx.one('split');
    const ck = cat ? ctx.kind(cat) : undefined, sers: CatData['sers'] = [];
    if (!cat || ck !== 'text') {
        const N = Math.min(ctx.n, 60), off = ctx.n - N;
        const labels = cat ? ctx.col(cat).slice(off).map(v => (ck === 'time' ? fmtTime(v) : fmt(v))) : Array.from({ length: N }, (_, i) => String(S.table.start + ctx.a + off + i + 1));
        vals.forEach((c, i) => sers.push({ id: c, name: ctx.name(c), color: ctx.color(c, i), data: ctx.num(c).slice(off) }));
        return { labels, sers, catName: cat ? dn(cat) : 'row', what: `last ${N} rows` };
    }
    const cv = ctx.col(cat);
    const labels = (uniqOrdered(cv) as string[]).slice(0, 40);
    if (split) {
        const sv = ctx.col(split), Yv = vals[0] ? ctx.num(vals[0]) : null;
        (uniqOrdered(sv) as string[]).slice(0, 12).forEach((s, si) => {
            const keys = cv.map((k, j) => (sv[j] === s ? k : undefined));
            sers.push({ id: 's|' + s, name: String(s), color: pal(si), data: groupBy(keys, Yv, labels, Yv ? agg : 'count') });
        });
    } else if (!vals.length) {
        sers.push({ id: 'count', name: 'rows', color: pal(0), data: groupBy(cv, null, labels, 'count') });
    } else {
        vals.forEach((c, i) => sers.push({ id: c, name: ctx.name(c), color: ctx.color(c, i), data: groupBy(cv, ctx.num(c), labels, agg) }));
    }
    return { labels, sers, catName: dn(cat), what: `${labels.length} categories · ${vals.length ? agg : 'row count'}` };
}

export function buildBars(ctx: Ctx, variant: 'bar' | 'hbar' | 'stackedBar' | 'bar100' | 'lollipop'): Built {
    const V = ctx.V, { labels, sers, catName, what } = catData(ctx), horiz = variant === 'hbar';
    const stack = variant === 'stackedBar' || variant === 'bar100';
    let series: Opt[] = sers.map(s => ({ type: 'bar', id: s.id, name: s.name, data: s.data, itemStyle: { color: s.color, borderRadius: horiz ? [0, 2, 2, 0] : [2, 2, 0, 0] }, barMaxWidth: 36, stack: stack ? 't' : undefined, emphasis: { focus: 'series' } }));
    if (variant === 'bar100') {
        const tot = labels.map((_, j) => sers.reduce((a, s) => a + (s.data[j] ?? 0), 0));
        series.forEach(s => { s.data = (s.data as (number | null)[]).map((v, j) => (tot[j] ? (v ?? 0) / tot[j] * 100 : 0)); });
    }
    if (variant === 'lollipop') {
        series = sers.flatMap(s => [
            { type: 'bar', id: s.id + '|stem', name: s.name, data: s.data, barWidth: 2, itemStyle: { color: s.color }, tooltip: { show: false } },
            { type: 'scatter', id: s.id, name: s.name, data: s.data, symbolSize: 9, itemStyle: { color: s.color } },
        ]);
    }
    const catA = catAx(V, labels, catName), valA = valAx(V, variant === 'bar100' ? '%' : '', { type: ctx.p.options.log ? 'log' : 'value', scale: false, max: variant === 'bar100' ? 100 : undefined, nameLocation: 'end', nameGap: 8 });
    const chips: Chip[] | null = sers.length > 1 ? sers.map(s => ({ name: s.name, color: s.color })) : null;
    return { option: base(ctx, { tooltip: tip(V, 'axis', { axisPointer: { type: 'shadow' } }), xAxis: horiz ? valA : catA, yAxis: horiz ? { ...catA, inverse: true, nameLocation: 'start', nameGap: 8 } : valA, series }), chips, summary: what };
}

export function buildWaterfall(ctx: Ctx): Built {
    const V = ctx.V, { labels, sers, catName } = catData(ctx), d = sers[0]?.data ?? [];
    let run = 0;
    const bs: number[] = [], pos: (number | string)[] = [], neg: (number | string)[] = [];
    for (const raw of d) {
        const v = raw ?? 0;
        if (v >= 0) { bs.push(run); pos.push(v); neg.push('-'); } else { bs.push(run + v); pos.push('-'); neg.push(-v); }
        run += v;
    }
    const L = labels.concat(['Total']);
    bs.push(Math.min(0, run)); pos.push(run >= 0 ? run : '-'); neg.push(run < 0 ? -run : '-');
    return {
        option: base(ctx, { tooltip: tip(V, 'axis', { axisPointer: { type: 'shadow' } }), xAxis: catAx(V, L, catName), yAxis: valAx(V, '', { scale: false }), series: [
            { type: 'bar', id: 'base', stack: 'w', data: bs, itemStyle: { color: 'transparent' }, silent: true, tooltip: { show: false } },
            { type: 'bar', id: 'up', name: 'increase', stack: 'w', data: pos, itemStyle: { color: V.live } },
            { type: 'bar', id: 'down', name: 'decrease', stack: 'w', data: neg, itemStyle: { color: V.err } }] }),
        summary: `total ${fmt(run)}`,
    };
}

export function buildRadar(ctx: Ctx): Built {
    const V = ctx.V, cs = ctx.slot('y'), grp = ctx.one('group'), vals = cs.map(c => ctx.num(c)), st = vals.map(stats);
    const indicator = cs.map((c, i) => { const s = st[i], pad = s ? (s.max - s.min) * 0.1 || 1 : 1; return { name: trunc(ctx.name(c), 14), min: s ? s.min - pad : 0, max: s ? s.max + pad : 1 }; });
    let data: Opt[];
    if (grp) {
        const g = ctx.col(grp);
        data = (uniqOrdered(g) as string[]).slice(0, 8).map((gv, gi) => { const col = pal(gi); return { name: String(gv), value: cs.map((_, i) => AGGS.mean(vals[i].filter((v, j): v is number => g[j] === gv && v !== null))), itemStyle: { color: col }, lineStyle: { color: col }, areaStyle: { color: hexA(col, 0.12) } }; });
    } else {
        const c0 = pal(0), c1 = pal(1);
        data = [{ name: 'latest', value: vals.map(v => lastFinite(v)), itemStyle: { color: c0 }, lineStyle: { color: c0 }, areaStyle: { color: hexA(c0, 0.15) } }, { name: 'mean', value: st.map(s => (s ? s.mean : null)), itemStyle: { color: c1 }, lineStyle: { color: c1, type: 'dashed' } }];
    }
    return {
        option: base(ctx, { tooltip: tip(V, 'item'), radar: { indicator, radius: '64%', center: ['50%', '54%'], axisName: { color: V.muted, fontSize: 10 }, splitLine: { lineStyle: { color: V.grid } }, splitArea: { show: false }, axisLine: { lineStyle: { color: V.grid } } }, series: [{ type: 'radar', id: 'radar', data, symbolSize: 3 }] }),
        chips: data.map(d => ({ name: d.name, color: d.itemStyle.color })),
    };
}
