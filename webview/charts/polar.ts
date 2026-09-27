// Polar scatter, gauges and big-number tiles.

import { base, lab, tip, type Built, type Chip, type Ctx, type Opt } from './ctx';
import { clamp, fmt, fmtInt, hexA, lastFinite, pal, stats, uniqOrdered } from '../util';

export function buildPolar(ctx: Ctx): Built {
    const V = ctx.V, A = ctx.num(ctx.one('angle')!), R = ctx.num(ctx.one('y')!), split = ctx.one('split'), N = Math.min(ctx.n, 2000), off = ctx.n - N;
    const av = A.filter((v): v is number => v !== null), lo = Math.min(...av), hi = Math.max(...av);
    const range = lo >= -180 && hi <= 180 ? [-180, 180] : lo >= 0 && hi <= 360 ? [0, 360] : [undefined, undefined];
    const all = Array.from({ length: N }, (_, j) => off + j), pts = (idx: number[]) => idx.map(j => [R[j], A[j]]);
    let series: Opt[], chips: Chip[] | null = null;
    if (split) {
        const cats = ctx.col(split), names = (uniqOrdered(cats.slice(off)) as string[]).slice(0, 8);
        series = names.map((nm, k) => ({ type: 'scatter', coordinateSystem: 'polar', id: 'p' + k, name: nm, data: pts(all.filter(j => cats[j] === nm)), symbolSize: 4, itemStyle: { color: hexA(pal(k), 0.7) } }));
        chips = names.map((nm, k) => ({ name: nm, color: pal(k) }));
    } else {
        series = [{ type: 'scatter', coordinateSystem: 'polar', id: 'p', name: ctx.name(ctx.one('y')!), data: pts(all), symbolSize: 4, itemStyle: { color: hexA(pal(0), 0.7) } }];
    }
    return { option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `angle ${fmt(p.value[1])}°, radius ${fmt(p.value[0])}` }), polar: { radius: '70%', center: ['50%', '54%'] }, angleAxis: { type: 'value', min: range[0], max: range[1], startAngle: 90, axisLine: { lineStyle: { color: V.border } }, axisLabel: { ...lab(V), formatter: (v: number) => v + '°' }, splitLine: { lineStyle: { color: V.grid } } }, radiusAxis: { type: 'value', scale: true, axisLine: { lineStyle: { color: V.border } }, axisLabel: { ...lab(V), fontSize: 9, formatter: (v: number) => fmt(v) }, splitLine: { lineStyle: { color: V.grid } } }, series }), chips };
}

function niceRange(lo: number, hi: number): [number, number] {
    const span = (hi - lo) || Math.abs(hi) || 1, step = Math.pow(10, Math.floor(Math.log10(span))) / 2;
    return [Math.floor((lo - span * 0.15) / step) * step, Math.ceil((hi + span * 0.15) / step) * step];
}

export function buildGauge(ctx: Ctx): Built {
    const V = ctx.V, c = ctx.one('y')!, Yv = ctx.num(c), v = lastFinite(Yv), st = stats(Yv), L = ctx.p.options.limits?.[0];
    let lo = st ? st.min : 0, hi = st ? st.max : 1;
    if (L) { lo = Math.min(lo, L.value); hi = Math.max(hi, L.value); }
    const [min, max] = niceRange(lo, hi), r = L ? clamp((L.value - min) / (max - min), 0, 1) : 1;
    const colors = L ? (L.alert === 'above' ? [[r, V.live], [1, V.err]] : [[r, V.err], [1, V.live]]) : [[1, V.grid]];
    return {
        option: base(ctx, { tooltip: { show: false }, series: [{ type: 'gauge', id: 'g', min, max, splitNumber: 5, startAngle: 210, endAngle: -30, radius: '86%', center: ['50%', '58%'], progress: { show: !L, width: 10, itemStyle: { color: ctx.color(c, 0) } }, axisLine: { lineStyle: { width: 10, color: colors } }, pointer: { width: 4, length: '58%', itemStyle: { color: V.fg } }, anchor: { show: true, size: 8, itemStyle: { color: V.fg } }, axisTick: { show: false }, splitLine: { length: 8, lineStyle: { color: V.border } }, axisLabel: { color: V.axis, fontSize: 9, distance: 14, formatter: (x: number) => fmt(x) }, title: { offsetCenter: [0, '72%'], color: V.muted, fontSize: 11 }, detail: { offsetCenter: [0, '38%'], fontSize: 20, fontFamily: V.mono, color: V.fg, formatter: (x: number) => fmt(x) }, data: [{ value: v ?? min, name: ctx.name(c) }] }] }),
        latest: [{ name: ctx.name(c), value: v, axis: 'left' }], summary: `latest of ${fmtInt(ctx.n)} rows`,
    };
}

export function buildKpi(ctx: Ctx): Built {
    const V = ctx.V, c = ctx.one('y')!, Yv = ctx.num(c), v = lastFinite(Yv), tail = Yv.slice(-120), prev = Yv.length > 61 ? Yv[Yv.length - 61] : null, color = ctx.color(c, 0);
    const d = v !== null && prev !== null ? v - prev : null;
    return {
        option: base(ctx, { tooltip: { show: false }, title: { text: fmt(v), subtext: `${ctx.name(c)}${d !== null ? `   ${d >= 0 ? '▲' : '▼'} ${fmt(Math.abs(d))} vs 60 rows ago` : ''}`, left: 'center', top: '14%', textStyle: { fontSize: 34, fontFamily: V.mono, color: V.fg, fontWeight: 500 }, subtextStyle: { color: V.muted, fontSize: 11.5 } }, grid: { left: 14, right: 14, bottom: 10, height: '30%', containLabel: false }, xAxis: { type: 'category', show: false, data: tail.map((_, i) => i), boundaryGap: false }, yAxis: { type: 'value', show: false, scale: true }, series: [{ type: 'line', id: 'spark', data: tail, showSymbol: false, lineStyle: { color, width: 1.5 }, areaStyle: { color: hexA(color, 0.15) } }] }),
        latest: [{ name: ctx.name(c), value: v, axis: 'left' }],
    };
}
