// 3D surface, scatter and bars (ECharts GL, loaded the first time one is shown).

import { base, type Built, type Ctx, type Opt } from './ctx';
import { binsFor } from './distribution';
import { dn } from '../state';
import { AGGS, RAMP, pal, uniqOrdered } from '../util';

function glBase(ctx: Ctx, names: string[]): Opt {
    const V = ctx.V, a = (name: string) => ({ type: 'value', name, nameTextStyle: { color: V.muted, fontSize: 10 }, axisLine: { lineStyle: { color: V.axis } }, axisLabel: { color: V.axis, fontSize: 9, textStyle: { color: V.axis, fontSize: 9 } }, splitLine: { lineStyle: { color: V.grid } } });
    return { xAxis3D: a(names[0]), yAxis3D: a(names[1]), zAxis3D: a(names[2]), grid3D: { boxWidth: 110, boxDepth: 80, viewControl: { alpha: 24, beta: 38, distance: 260 },
        // Anti-aliasing by accumulating frames re-renders the scene for many frames after every change; with live
        // data that never stops and slowed every chart in the view to about 2 fps
        temporalSuperSampling: { enable: false }, postEffect: { enable: false }, axisPointer: { lineStyle: { color: V.axis } }, light: { main: { intensity: 1.1 }, ambient: { intensity: 0.35 } } } };
}

export function buildSurface(ctx: Ctx): Built {
    const z = ctx.one('z')!, data: number[][] = [];
    let lo = Infinity, hi = -Infinity, names: string[];
    if (ctx.kind(z) === 'array') {
        const H = ctx.hist(z).slice(-60);
        if (!H.length) { throw new Error('Waiting for spectrum rows.'); }
        H.forEach((h, t) => h.values.forEach((v, b) => { const y = Number.isFinite(v) ? v : 0; data.push([t, b, y]); lo = Math.min(lo, y); hi = Math.max(hi, y); }));
        names = ['row (newest 60)', 'bin', ctx.name(z)];
    } else {
        const xc = ctx.one('x'), yc = ctx.one('y');
        if (!xc || !yc) { throw new Error('A number height needs X and Y number columns too. Or use a spectrum column for its history.'); }
        const xs = ctx.num(xc), ys = ctx.num(yc), zs = ctx.num(z), nb = 18;
        const Bx = binsFor([xs.filter((v): v is number => v !== null)], nb), By = binsFor([ys.filter((v): v is number => v !== null)], nb);
        if (!Bx || !By) { throw new Error('No numbers yet.'); }
        const sum = new Map<string, [number, number]>();
        for (let j = 0; j < xs.length; j++) {
            const a = xs[j], b = ys[j], c = zs[j];
            if (a === null || b === null || c === null) { continue; }
            const k = Math.min(nb - 1, Math.floor((a - Bx.lo) / Bx.w)) + ',' + Math.min(nb - 1, Math.floor((b - By.lo) / By.w));
            const e = sum.get(k) ?? [0, 0]; e[0] += c; e[1]++; sum.set(k, e);
        }
        const mean = AGGS.mean(zs.filter((v): v is number => v !== null)) ?? 0;
        for (let i = 0; i < nb; i++) { for (let k = 0; k < nb; k++) { const e = sum.get(i + ',' + k), v = e ? e[0] / e[1] : mean; data.push([Bx.lo + (i + 0.5) * Bx.w, By.lo + (k + 0.5) * By.w, v]); lo = Math.min(lo, v); hi = Math.max(hi, v); } }
        names = [ctx.name(xc), ctx.name(yc), ctx.name(z)];
    }
    return { option: base(ctx, { tooltip: {}, visualMap: { show: false, min: lo, max: hi, inRange: { color: RAMP } }, ...glBase(ctx, names), series: [{ type: 'surface', id: 'sf', data, wireframe: { show: false }, shading: 'lambert' }] }), summary: 'drag to rotate' };
}

export function buildScatter3d(ctx: Ctx): Built {
    const [x, y, z] = ['x', 'y', 'z'].map(k => ctx.num(ctx.one(k)!)), split = ctx.one('split'), N = Math.min(ctx.n, 3000), off = ctx.n - N;
    const idx = Array.from({ length: N }, (_, j) => off + j), pt = (j: number) => [x[j], y[j], z[j]];
    let series: Opt[], chips: Built['chips'] = null;
    if (split) {
        const cats = ctx.col(split), names = (uniqOrdered(cats.slice(off)) as string[]).slice(0, 8);
        series = names.map((nm, k) => ({ type: 'scatter3D', id: 'p' + k, name: nm, data: idx.filter(j => cats[j] === nm).map(pt), symbolSize: 4, itemStyle: { color: pal(k), opacity: 0.8 } }));
        chips = names.map((nm, k) => ({ name: nm, color: pal(k) }));
    } else {
        series = [{ type: 'scatter3D', id: 'p', data: idx.map(pt), symbolSize: 4, itemStyle: { color: pal(0), opacity: 0.8 } }];
    }
    return { option: base(ctx, { tooltip: {}, ...glBase(ctx, ['x', 'y', 'z'].map(k => ctx.name(ctx.one(k)!))), series }), chips, summary: 'drag to rotate' };
}

export function buildBar3d(ctx: Ctx): Built {
    const xc = ctx.one('x')!, yc = ctx.one('cat')!, zc = ctx.one('z'), xk = ctx.col(xc), yk = ctx.col(yc), Z = zc ? ctx.num(zc) : null, agg = ctx.p.options.summary ?? 'mean';
    const xl = (uniqOrdered(xk) as string[]).slice(0, 20), yl = (uniqOrdered(yk) as string[]).slice(0, 20), data: number[][] = [];
    const cells = new Map<string, number[]>();
    for (let j = 0; j < xk.length; j++) { const k = xk[j] + '\u0000' + yk[j], b = cells.get(k) ?? [], v = Z ? Z[j] : 1; if (v !== null) { b.push(v); } cells.set(k, b); }
    xl.forEach((xv, i) => yl.forEach((yv, k) => { const b = cells.get(xv + '\u0000' + yv); if (b && b.length) { data.push([i, k, Z ? (AGGS[agg] ?? AGGS.mean)(b) ?? 0 : b.length]); } }));
    const g = glBase(ctx, [dn(xc), dn(yc), zc ? ctx.name(zc) : 'rows']);
    g.xAxis3D = { ...g.xAxis3D, type: 'category', data: xl };
    g.yAxis3D = { ...g.yAxis3D, type: 'category', data: yl };
    const vs = data.map(d => d[2]);
    return { option: base(ctx, { tooltip: {}, visualMap: { show: false, min: Math.min(...vs, 0), max: Math.max(...vs, 1), inRange: { color: RAMP } }, ...g, series: [{ type: 'bar3D', id: 'b3', data, shading: 'lambert', bevelSize: 0.2 }] }), summary: 'drag to rotate' };
}
