// Heatmaps, spectra, spectrograms and calendar heatmaps.

import { applyMarks, base, cartY, catAx, tip, valAx, type Built, type Chip, type Ctx, type Opt } from './ctx';
import { binsFor } from './distribution';
import { dn } from '../state';
import { AGGS, RAMP, esc, fmt, uniqOrdered } from '../util';

export function buildHeatmap(ctx: Ctx): Built {
    const V = ctx.V, xc = ctx.one('x')!, yc = ctx.one('cat')!, val = ctx.one('y'), agg = ctx.p.options.summary ?? 'mean';
    let xk = ctx.col(xc), xl: string[];
    if (ctx.kind(xc) !== 'text') {
        const B = binsFor([xk.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))], 12);
        if (!B) { throw new Error('No numbers yet.'); }
        xl = Array.from({ length: 12 }, (_, i) => fmt(B.lo + (i + 0.5) * B.w));
        xk = xk.map(v => (typeof v === 'number' && Number.isFinite(v) ? xl[Math.min(11, Math.floor((v - B.lo) / B.w))] : null));
    } else {
        xl = (uniqOrdered(xk) as string[]).slice(0, 30);
    }
    const yk = ctx.col(yc), yl = (uniqOrdered(yk) as string[]).slice(0, 30), Yv = val ? ctx.num(val) : null, cells = new Map<string, number[]>();
    for (let j = 0; j < xk.length; j++) {
        const k = xk[j] + '\u0000' + yk[j], b = cells.get(k) ?? [];
        const v = Yv ? Yv[j] : 1;
        if (v !== null) { b.push(v); }
        cells.set(k, b);
    }
    const data: number[][] = [];
    xl.forEach((x, i) => yl.forEach((y, k) => { const b = cells.get(x + '\u0000' + y); if (b && b.length) { data.push([i, k, Yv ? (AGGS[agg] ?? AGGS.mean)(b) ?? 0 : b.length]); } }));
    const vs = data.map(d => d[2]);
    return { option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `${esc(xl[p.value[0]])} × ${esc(yl[p.value[1]])}: <b>${fmt(p.value[2])}</b>` }), xAxis: catAx(V, xl, dn(xc)), yAxis: catAx(V, yl, dn(yc), { nameLocation: 'end', nameGap: 8 }), visualMap: { show: false, min: Math.min(...vs, 0), max: Math.max(...vs, 1), inRange: { color: RAMP } }, series: [{ type: 'heatmap', id: 'hm', data, label: { show: data.length <= 80, fontSize: 10, color: '#fff', formatter: (p: Opt) => fmt(p.value[2]) } }] }), summary: val ? `${agg} of ${ctx.name(val)}` : 'row counts' };
}

export function buildSpectrum(ctx: Ctx): Built {
    const V = ctx.V, cs = ctx.slot('spec'), series: Opt[] = [], chips: Chip[] = [], latest: Built['latest'] = [];
    cs.forEach((c, i) => {
        const a = ctx.arr(c), color = ctx.color(c, i);
        series.push({ type: 'line', id: c, name: ctx.name(c), data: Array.from(a, (v, j) => [j, Number.isFinite(v) ? v : null]), showSymbol: false, itemStyle: { color }, lineStyle: { color, width: 1.5 } });
        let mi = 0;
        a.forEach((v, j) => { if (v > a[mi]) { mi = j; } });
        chips.push({ name: ctx.name(c), color, label: a.length ? `${ctx.name(c)} peak ${fmt(a[mi])} at ${mi}` : ctx.name(c) });
        latest.push({ name: ctx.name(c), value: a.length ? a[mi] : null, axis: 'left' });
    });
    if (ctx.cmp) {
        const cmp = ctx.cmp;
        cs.forEach((c, i) => {
            if (!cmp.has(c)) { return; }
            const a = cmp.arr(c), color = ctx.color(c, i), name = `${ctx.name(c)} · ${cmp.name}`;
            series.push({ type: 'line', id: `${c}|cmp`, name, data: Array.from(a, (v, j) => [j, Number.isFinite(v) ? v : null]), showSymbol: false, itemStyle: { color }, lineStyle: { color, width: 1.2, type: 'dashed', opacity: 0.6 }, z: 1 });
            chips.push({ name, color, dashed: true });
        });
    }
    applyMarks(ctx, series);
    return { option: base(ctx, { xAxis: valAx(V, 'bin', { min: 0, max: 'dataMax', splitLine: { show: false } }), yAxis: [cartY(ctx, false)], series }), chips, latest };
}

export function buildSpectrogram(ctx: Ctx): Built {
    const V = ctx.V, c = ctx.one('spec')!, H = ctx.hist(c), nb = H.length ? H[H.length - 1].values.length : 0, data: number[][] = [];
    let lo = Infinity, hi = -Infinity;
    H.forEach((h, t) => h.values.forEach((v, b) => { if (!Number.isFinite(v)) { return; } data.push([t, b, v]); if (v < lo) { lo = v; } if (v > hi) { hi = v; } }));
    if (!data.length) { throw new Error('Waiting for spectrum rows.'); }
    const rows = H.map(h => String(h.row + 1));
    return { option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `row ${rows[p.value[0]]}, bin ${p.value[1]}: <b>${fmt(p.value[2])}</b>` }), xAxis: catAx(V, rows, 'row'), yAxis: catAx(V, Array.from({ length: nb }, (_, i) => String(i)), 'bin', { nameLocation: 'end', nameGap: 8 }), visualMap: { show: false, min: lo, max: hi, inRange: { color: RAMP } }, series: [{ type: 'heatmap', id: 'sg', data, progressive: 0 }] }), summary: `${H.length} rows × ${nb} bins · ${ctx.name(c)}` };
}

export function buildCalendar(ctx: Ctx): Built {
    const V = ctx.V, tc = ctx.one('x')!, val = ctx.one('y'), t = ctx.col(tc), Yv = val ? ctx.num(val) : null, m = new Map<string, number[]>();
    const day = (s: number) => { const d = new Date(s * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    for (let j = 0; j < t.length; j++) {
        const s = t[j];
        if (typeof s !== 'number' || !Number.isFinite(s)) { continue; }
        const k = day(s), b = m.get(k) ?? [], v = Yv ? Yv[j] : 1;
        if (v !== null) { b.push(v); }
        m.set(k, b);
    }
    const chosen = ctx.p.options.summary ?? 'sum', agg = chosen === 'mean' && !val ? 'count' : chosen;
    const data = [...m.entries()].map(([k, b]) => [k, val ? (AGGS[agg] ?? AGGS.sum)(b) ?? 0 : b.length] as [string, number]).sort((a, b) => a[0].localeCompare(b[0]));
    if (!data.length) { throw new Error('No dates yet.'); }
    const vs = data.map(d => d[1]);
    return { option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `${p.value[0]}: <b>${fmt(p.value[1])}</b>` }), visualMap: { show: false, min: Math.min(...vs), max: Math.max(...vs), inRange: { color: RAMP } }, calendar: { range: [data[0][0], data[data.length - 1][0]], top: 36, left: 40, right: 16, bottom: 10, cellSize: ['auto', 'auto'], itemStyle: { color: 'transparent', borderColor: V.border }, splitLine: { lineStyle: { color: V.axis } }, dayLabel: { color: V.muted, fontSize: 9, firstDay: 1 }, monthLabel: { color: V.muted, fontSize: 10 }, yearLabel: { show: false } }, series: [{ type: 'heatmap', id: 'cal', coordinateSystem: 'calendar', data }] }), summary: `${data.length} days · ${val ? agg + ' of ' + ctx.name(val) : 'rows per day'}` };
}
