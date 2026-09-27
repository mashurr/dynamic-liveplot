// Candlesticks, error bars and error bands.

import { applyMarks, base, cartX, cartY, catAx, tip, valAx, type Built, type Ctx, type Opt } from './ctx';
import { fmt, hexA, lastFinite } from '../util';

type Api = { value(i: number): number; coord(p: number[]): number[] };

export function buildCandle(ctx: Ctx): Built {
    const V = ctx.V, N = Math.min(ctx.n, 200), off = ctx.n - N;
    const [o, h, l, c] = ['open', 'high', 'low', 'close'].map(k => ctx.num(ctx.one(k)!).slice(off));
    const lbl = (v: number | null) => (v === null ? '' : ctx.timeX ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : fmt(v));
    const labels = ctx.x.slice(off).map(lbl);
    return {
        option: base(ctx, { tooltip: tip(V, 'axis'), xAxis: catAx(V, labels, ctx.xName), yAxis: valAx(V, ''), series: [{ type: 'candlestick', id: 'cs', name: 'OHLC', data: o.map((_, j) => [o[j], c[j], l[j], h[j]]), itemStyle: { color: V.live, color0: V.err, borderColor: V.live, borderColor0: V.err } }], dataZoom: [{ type: 'inside' }] }),
        chips: [{ name: 'close', color: V.live, value: lastFinite(c) }], latest: [{ name: 'close', value: lastFinite(c), axis: 'left' }],
    };
}

export function buildErr(ctx: Ctx, band: boolean): Built {
    const c = ctx.one('y')!, e = ctx.one('err')!, X = ctx.x, Yv = ctx.num(c), E = ctx.num(e), color = ctx.color(c, 0), series: Opt[] = [];
    if (band) {
        series.push({ type: 'line', id: 'lo', name: 'lower', data: X.map((x, j) => [x, Yv[j] !== null && E[j] !== null ? Yv[j]! - E[j]! : null]), stack: 'band', lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } });
        series.push({ type: 'line', id: 'band', name: '± band', data: X.map((x, j) => [x, E[j] !== null ? 2 * E[j]! : null]), stack: 'band', lineStyle: { opacity: 0 }, areaStyle: { color: hexA(color, 0.22) }, showSymbol: false, silent: true, tooltip: { show: false } });
        series.push({ type: 'line', id: c, name: ctx.name(c), data: X.map((x, j) => [x, Yv[j]]), showSymbol: false, itemStyle: { color }, lineStyle: { color, width: 1.5 } });
    } else {
        const N = Math.min(X.length, 400), off = X.length - N;
        series.push({ type: 'scatter', id: c, name: ctx.name(c), data: X.slice(off).map((x, j) => [x, Yv[off + j]]), symbolSize: 5, itemStyle: { color } });
        series.push({
            type: 'custom', id: 'whisk', name: '± error', silent: true,
            data: X.slice(off).map((x, j) => [x, (Yv[off + j] ?? NaN) - (E[off + j] ?? NaN), (Yv[off + j] ?? NaN) + (E[off + j] ?? NaN)]), encode: { x: 0, y: [1, 2] },
            renderItem: (_: unknown, api: Api) => {
                const x = api.value(0), lo = api.coord([x, api.value(1)]), hi = api.coord([x, api.value(2)]), w = 4;
                if (!Number.isFinite(lo[1]) || !Number.isFinite(hi[1])) { return undefined; }
                return { type: 'group', children: [{ type: 'line', shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style: { stroke: color, lineWidth: 1 } }, { type: 'line', shape: { x1: lo[0] - w, y1: lo[1], x2: lo[0] + w, y2: lo[1] }, style: { stroke: color } }, { type: 'line', shape: { x1: hi[0] - w, y1: hi[1], x2: hi[0] + w, y2: hi[1] }, style: { stroke: color } }] };
            },
        });
    }
    applyMarks(ctx, series);
    return { option: base(ctx, { tooltip: tip(ctx.V, band ? 'axis' : 'item'), xAxis: cartX(ctx), yAxis: [cartY(ctx, false)], series, dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }] }), chips: [{ name: ctx.name(c), color, value: lastFinite(Yv) }], latest: [{ name: ctx.name(c), value: lastFinite(Yv), axis: 'left' }] };
}
