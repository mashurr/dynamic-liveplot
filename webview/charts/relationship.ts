// Scatter, bubble, 2D density, scatter matrix, parallel coordinates and correlation.

import { applyMarks, base, cartX, cartY, catAx, lab, tip, valAx, type Built, type Chip, type Ctx, type Opt } from './ctx';
import { binsFor, countBins, rectItem } from './distribution';
import { RAMP, esc, fmt, fmtTime, hexA, lastFinite, pal, pearson, trunc, uniqOrdered } from '../util';

export function buildScatter(ctx: Ctx, bubble: boolean): Built {
    const X = ctx.x, ys = ctx.slot('y'), split = ctx.one('split'), sz = bubble ? ctx.num(ctx.one('size')!) : null;
    // Up to 20,000 points; beyond that evenly spaced rows across the whole range, always ending with the newest
    const step = Math.max(1, Math.ceil(X.length / 20000)), first = (X.length - 1) % step, series: Opt[] = [], chips: Chip[] = [], latest: Built['latest'] = [];
    let smin = Infinity, smax = -Infinity;
    if (sz) { for (const v of sz) { if (v !== null) { smin = Math.min(smin, v); smax = Math.max(smax, v); } } }
    const sizeFn = sz ? (d: number[]) => 5 + 22 * Math.sqrt(Math.max(0, ((d[2] ?? smin) - smin) / ((smax - smin) || 1))) : 5;
    let right = false;
    ys.forEach((c, i) => {
        const Yv = ctx.num(c), pt = (j: number) => (sz ? [X[j], Yv[j], sz[j]] : [X[j], Yv[j]]), yi = ctx.style(c).axis === 'right' ? 1 : 0;
        if (yi) { right = true; }
        if (split) {
            const cats = ctx.col(split);
            (uniqOrdered(cats) as string[]).slice(0, 16).forEach((v, vi) => {
                const d: (number | null)[][] = [];
                for (let j = first; j < X.length; j += step) { if (cats[j] === v) { d.push(pt(j)); } }
                const color = pal(vi), name = ys.length > 1 ? `${ctx.name(c)} · ${v}` : String(v);
                series.push({ type: 'scatter', id: `${c}|${v}`, name, data: d, symbolSize: sizeFn, itemStyle: { color: hexA(color, bubble ? 0.55 : 0.8) }, yAxisIndex: yi });
                chips.push({ name, color });
            });
        } else {
            const d: (number | null)[][] = [];
            for (let j = first; j < X.length; j += step) { d.push(pt(j)); }
            const color = ctx.color(c, i);
            series.push({ type: 'scatter', id: c, name: ctx.name(c), data: d, symbolSize: sizeFn, itemStyle: { color: hexA(color, bubble ? 0.55 : 0.8) }, large: !bubble && d.length > 2000, yAxisIndex: yi });
            chips.push({ name: ctx.name(c), color, value: lastFinite(Yv) });
            latest.push({ name: ctx.name(c), value: lastFinite(Yv), axis: yi ? 'right' : 'left' });
        }
    });
    if (ctx.cmp && !split) {
        const cmp = ctx.cmp;
        ys.forEach((c, i) => {
            if (!cmp.has(c)) { return; }
            const color = ctx.color(c, i), Y2 = cmp.num(c), name = `${ctx.name(c)} · ${cmp.name}`;
            series.push({ type: 'scatter', id: `${c}|cmp`, name, data: cmp.x.map((xv, j) => [xv, Y2[j]]).filter((_, j) => j % step === 0), symbolSize: 5, itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1, opacity: 0.7 }, yAxisIndex: ctx.style(c).axis === 'right' ? 1 : 0, z: 1 });
            chips.push({ name, color, dashed: true });
        });
    }
    applyMarks(ctx, series);
    const fx = (v: number) => (ctx.timeX ? fmtTime(v / 1000) : fmt(v));
    return {
        option: base(ctx, { tooltip: tip(ctx.V, 'item', { formatter: (p: Opt) => `${esc(p.seriesName)}<br>${esc(ctx.xName)}: ${fx(p.value[0])}<br>y: ${fmt(p.value[1])}${sz ? `<br>size: ${fmt(p.value[2])}` : ''}` }), xAxis: cartX(ctx), yAxis: right ? [cartY(ctx, false), cartY(ctx, true)] : [cartY(ctx, false)], series, dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }] }),
        chips, latest, summary: step > 1 ? `1 in ${step} of ${X.length.toLocaleString()} rows` : undefined,
    };
}

export function buildDensity2d(ctx: Ctx): Built {
    const V = ctx.V, xc = ctx.one('x')!, yc = ctx.one('y')!, xs = ctx.num(xc), ys = ctx.num(yc), nb = 26;
    const Bx = binsFor([xs.filter((v): v is number => v !== null)], nb), By = binsFor([ys.filter((v): v is number => v !== null)], nb);
    if (!Bx || !By) { throw new Error('No numbers yet.'); }
    const m = new Map<string, number>();
    for (let j = 0; j < xs.length; j++) {
        const a = xs[j], b = ys[j];
        if (a === null || b === null) { continue; }
        const k = Math.min(nb - 1, Math.floor((a - Bx.lo) / Bx.w)) + ',' + Math.min(nb - 1, Math.floor((b - By.lo) / By.w));
        m.set(k, (m.get(k) ?? 0) + 1);
    }
    const data = [...m.entries()].map(([k, v]) => [...k.split(',').map(Number), v]), max = Math.max(1, ...data.map(d => d[2]));
    const lx = Array.from({ length: nb }, (_, i) => fmt(Bx.lo + (i + 0.5) * Bx.w)), ly = Array.from({ length: nb }, (_, i) => fmt(By.lo + (i + 0.5) * By.w));
    return { option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `${lx[p.value[0]]}, ${ly[p.value[1]]}: <b>${p.value[2]}</b> rows` }), xAxis: catAx(V, lx, ctx.name(xc)), yAxis: catAx(V, ly, ctx.name(yc), { nameLocation: 'end', nameGap: 8 }), visualMap: { show: false, min: 0, max, inRange: { color: RAMP } }, series: [{ type: 'heatmap', id: 'hm', data, progressive: 0 }] }), summary: `${nb}×${nb} bins` };
}

export function buildMatrix(ctx: Ctx): Built {
    const V = ctx.V, cs = ctx.slot('y').slice(0, 4), n = cs.length, N = Math.min(ctx.n, 800), off = ctx.n - N;
    const data = cs.map(c => ctx.num(c).slice(off)), grids: Opt[] = [], xA: Opt[] = [], yA: Opt[] = [], series: Opt[] = [];
    const L = 11, T = 3, W = 86, H = 84, cw = W / n, chh = H / n;
    const small = (show: boolean) => ({ ...lab(V), fontSize: 9, show, formatter: (v: number) => fmt(v) });
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const i = r * n + c;
            grids.push({ left: `${L + c * cw + 0.6}%`, top: `${T + r * chh + 0.8}%`, width: `${cw - 1.2}%`, height: `${chh - 1.6}%` });
            xA.push(valAx(V, r === n - 1 ? trunc(ctx.name(cs[c]), 14) : '', { gridIndex: i, axisLabel: small(r === n - 1), splitLine: { show: false }, nameGap: 18 }));
            yA.push(valAx(V, c === 0 ? trunc(ctx.name(cs[r]), 12) : '', { gridIndex: i, axisLabel: small(c === 0), splitLine: { show: false }, nameGap: 36 }));
            if (r === c) {
                const vals = data[r].filter((v): v is number => v !== null), B = binsFor([vals], 14);
                if (B) { series.push({ type: 'custom', xAxisIndex: i, yAxisIndex: i, data: countBins(vals, B).map((k, b) => [B.lo + b * B.w, B.lo + (b + 1) * B.w, k]), encode: { x: [0, 1], y: 2 }, renderItem: rectItem(pal(0), 0.7), silent: true }); }
            } else {
                series.push({ type: 'scatter', xAxisIndex: i, yAxisIndex: i, data: data[c].map((v, j) => [v, data[r][j]]), symbolSize: 3, itemStyle: { color: hexA(pal(0), 0.5) }, silent: true });
            }
        }
    }
    return { option: base(ctx, { tooltip: { show: false }, grid: grids, xAxis: xA, yAxis: yA, series }), summary: `${N} rows sampled` };
}

export function buildParallel(ctx: Ctx): Built {
    const V = ctx.V, cs = ctx.slot('y'), split = ctx.one('split'), N = Math.min(ctx.n, 500), off = ctx.n - N;
    const data = cs.map(c => ctx.num(c).slice(off)), rows = Array.from({ length: N }, (_, j) => cs.map((_, i) => data[i][j]));
    const parallelAxis = cs.map((c, i) => ({ dim: i, name: trunc(ctx.name(c), 14), scale: true, nameTextStyle: { color: V.muted, fontSize: 10 }, axisLine: { lineStyle: { color: V.border } }, axisLabel: { ...lab(V), fontSize: 9, formatter: (v: number) => fmt(v) } }));
    let series: Opt[], chips: Chip[] | null = null;
    if (split) {
        const cats = ctx.col(split).slice(off), names = (uniqOrdered(cats) as string[]).slice(0, 8);
        series = names.map((nm, k) => ({ type: 'parallel', id: 'p' + k, name: nm, data: rows.filter((_, j) => cats[j] === nm), lineStyle: { color: pal(k), width: 1, opacity: 0.35 } }));
        chips = names.map((nm, k) => ({ name: nm, color: pal(k) }));
    } else {
        series = [{ type: 'parallel', id: 'p', data: rows, lineStyle: { color: pal(0), width: 1, opacity: 0.3 } }];
    }
    return { option: base(ctx, { tooltip: { show: false }, parallel: { left: 30, right: 50, top: 30, bottom: 18 }, parallelAxis, series }), chips, summary: `last ${N} rows` };
}

export function buildCorr(ctx: Ctx): Built {
    const V = ctx.V, cs = ctx.slot('y'), d = cs.map(c => ctx.num(c)), names = cs.map(c => trunc(ctx.name(c), 12)), data: number[][] = [];
    for (let i = 0; i < cs.length; i++) { for (let j = 0; j < cs.length; j++) { data.push([j, i, +pearson(d[j], d[i]).toFixed(2)]); } }
    return {
        option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `${esc(names[p.value[1]])} vs ${esc(names[p.value[0]])}: <b>${p.value[2]}</b>` }), grid: { left: 10, right: 12, top: 10, bottom: 10, containLabel: true }, xAxis: catAx(V, names, '', { axisLabel: { ...lab(V), rotate: 30, hideOverlap: false } }), yAxis: catAx(V, names, '', { inverse: true }), visualMap: { show: false, min: -1, max: 1, inRange: { color: V.dark ? ['#4393c3', '#2a2a2a', '#d6604d'] : ['#2166ac', '#f7f7f7', '#b2182b'] } }, series: [{ type: 'heatmap', id: 'corr', data, label: { show: cs.length <= 8, color: V.fg, fontSize: 10, formatter: (p: Opt) => p.value[2] } }] }),
        summary: 'Pearson r',
    };
}
