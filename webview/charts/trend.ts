// Line, area, step and stacked area: numbers over rows, time or another number.

import { applyMarks, base, cartX, cartY, type Built, type Ctx, type Opt, type Chip } from './ctx';
import { lastFinite, linePoints, rolling, uniqOrdered, pal } from '../util';

// Above this many rows a line is drawn from min/max buckets (see linePoints)
const MAX_POINTS = 20000;

export function buildCart(ctx: Ctx, mode: 'line' | 'area' | 'step' | 'stack'): Built {
    const ys = ctx.slot('y'), split = ctx.one('split'), X = ctx.x;
    const series: Opt[] = [], chips: Chip[] = [], latest: Built['latest'] = [];
    let right = false, decimated = false;
    const points = (xs: (number | null)[], yv: (number | null)[]) => { if (xs.length > MAX_POINTS) { decimated = true; } return linePoints(xs, yv, MAX_POINTS, ctx.zoom, mode === 'stack'); };
    ys.forEach((c, i) => {
        const st = ctx.style(c);
        if (st.axis === 'right') { right = true; }
        let Yv = ctx.num(c);
        if (st.smooth) { Yv = rolling(Yv, st.smooth); }
        const common: Opt = { type: 'line', showSymbol: false, symbolSize: 4, yAxisIndex: st.axis === 'right' ? 1 : 0, step: mode === 'step' ? 'end' : false, sampling: 'lttb', emphasis: { disabled: true } };
        if (mode === 'area' || mode === 'stack') { common.areaStyle = { opacity: mode === 'stack' ? 0.5 : 0.16 }; }
        if (mode === 'stack') { common.stack = 'total'; }
        const push = (id: string, name: string, data: (number | null)[][], lv: number | null, color: string, extra: Opt = {}) => {
            series.push({ ...common, id, name, data, itemStyle: { color }, lineStyle: { color, width: st.width }, ...extra });
            chips.push({ name, label: name + (st.axis === 'right' ? ' (right)' : ''), color, value: lv });
            latest.push({ name, value: lv, axis: st.axis });
        };
        if (split) {
            const cats = ctx.col(split);
            uniqOrdered(cats).slice(0, 16).forEach((v, vi) => {
                const xs: (number | null)[] = [], yv: (number | null)[] = [];
                for (let j = 0; j < X.length; j++) { if (cats[j] === v) { xs.push(X[j]); yv.push(Yv[j]); } }
                push(`${c}|${v}`, ys.length > 1 ? `${ctx.name(c)} · ${v}` : String(v), points(xs, yv), lastFinite(yv), pal(vi + i * 3), { connectNulls: true });
            });
        } else {
            push(c, ctx.name(c), points(X, Yv), lastFinite(Yv), ctx.color(c, i));
        }
    });
    if (ctx.cmp && !split) {
        const cmp = ctx.cmp;
        ys.forEach((c, i) => {
            if (!cmp.has(c)) { return; }
            const st = ctx.style(c), color = ctx.color(c, i);
            let Y2 = cmp.num(c);
            if (st.smooth) { Y2 = rolling(Y2, st.smooth); }
            const name = `${ctx.name(c)} · ${cmp.name}`;
            series.push({ type: 'line', id: `${c}|cmp`, name, data: points(cmp.x, Y2), showSymbol: false, yAxisIndex: st.axis === 'right' ? 1 : 0, step: mode === 'step' ? 'end' : false, sampling: 'lttb', itemStyle: { color }, lineStyle: { color, width: st.width, type: 'dashed', opacity: 0.6 }, emphasis: { disabled: true }, z: 1 });
            chips.push({ name, color, value: lastFinite(Y2), dashed: true });
        });
    }
    applyMarks(ctx, series);
    return {
        option: base(ctx, { grid: { left: 10, right: right ? 10 : 16, top: 18, bottom: 24, containLabel: true }, xAxis: cartX(ctx), yAxis: right ? [cartY(ctx, false), cartY(ctx, true)] : [cartY(ctx, false)], series, dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }] }),
        chips, latest, decimated,
    };
}

/** One number split by a text column, drawn as flowing bands. */
export function buildStream(ctx: Ctx): Built {
    const V = ctx.V, c = ctx.one('y')!, split = ctx.one('split')!, X = ctx.x, Yv = ctx.num(c), cats = ctx.col(split);
    const names = uniqOrdered(cats).slice(0, 10) as string[];
    const xs = X.filter((v): v is number => v !== null);
    const lo = Math.min(...xs), hi = Math.max(...xs), nb = 60, w = (hi - lo) / nb || 1;
    const acc = new Map<string, [number, number]>();
    for (let j = 0; j < X.length; j++) {
        const xv = X[j], yv = Yv[j];
        if (xv === null || yv === null || !names.includes(cats[j] as string)) { continue; }
        const k = Math.min(nb - 1, Math.floor((xv - lo) / w)) + '|' + cats[j];
        const e = acc.get(k) ?? [0, 0]; e[0] += yv; e[1]++; acc.set(k, e);
    }
    const data: (number | string)[][] = [];
    for (let k = 0; k < nb; k++) { for (const n of names) { const e = acc.get(k + '|' + n); data.push([lo + (k + 0.5) * w, e ? e[0] / e[1] : 0, n]); } }
    return {
        option: base(ctx, { color: names.map((_, i) => pal(i)), tooltip: { trigger: 'axis', confine: true, backgroundColor: V.menu, borderColor: V.menuBorder, textStyle: { color: V.fg }, axisPointer: { type: 'line', lineStyle: { color: V.axis } } }, singleAxis: { type: ctx.timeX ? 'time' : 'value', top: 10, bottom: 28, left: 12, right: 12, axisLabel: { color: V.axis, fontFamily: V.mono, fontSize: 10.5, hideOverlap: true }, axisLine: { lineStyle: { color: V.border } }, splitLine: { show: false } }, series: [{ type: 'themeRiver', id: 'river', data, label: { show: false }, emphasis: { focus: 'self' } }] }),
        chips: names.map((n, i) => ({ name: n, color: pal(i) })),
    };
}
