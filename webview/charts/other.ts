// Map (bundled world outlines, no tiles) and custom ECharts options.

import * as echarts from 'echarts';
import { base, ax, tip, type Built, type Ctx, type Opt } from './ctx';
import { cols, S } from '../state';
import { alpha } from './ctx';
import { esc, fmt, pal } from '../util';

/** Thrown while something the chart needs is still loading; shown as a quiet hint, not an error. */
export class Pending extends Error {}

let world: 'none' | 'loading' | 'ready' | 'error' = 'none';
let onWorld: () => void = () => {};
export function setWorldListener(f: () => void) { onWorld = f; }
function loadWorld() {
    if (world !== 'none') { return; }
    world = 'loading';
    fetch(S.mapUri).then(r => r.json()).then(geo => { echarts.registerMap('world', geo); world = 'ready'; onWorld(); }).catch(() => { world = 'error'; onWorld(); });
}

export function buildMap(ctx: Ctx): Built {
    if (world !== 'ready') {
        loadWorld();
        if (world === 'error') { throw new Error('The world outlines could not load.'); }
        throw new Pending('Loading world outlines…');
    }
    const V = ctx.V, lat = ctx.num(ctx.one('lat')!), lon = ctx.num(ctx.one('lon')!), val = ctx.one('y'), Yv = val ? ctx.num(val) : null, split = ctx.one('split');
    const N = Math.min(ctx.n, 5000), off = ctx.n - N;
    let lo = Infinity, hi = -Infinity;
    if (Yv) { for (const v of Yv) { if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } } }
    const size = Yv ? (d: number[]) => 4 + 16 * Math.sqrt(Math.max(0, ((d[2] ?? lo) - lo) / ((hi - lo) || 1))) : 6;
    const groups = split ? [...new Set(ctx.col(split).slice(off))].filter(v => v !== null).slice(0, 8) as string[] : [null];
    const cats = split ? ctx.col(split) : null;
    const series: Opt[] = groups.map((g, k) => {
        const data: (number | null)[][] = [];
        for (let j = off; j < ctx.n; j++) { if (lat[j] === null || lon[j] === null || (cats && cats[j] !== g)) { continue; } data.push([lon[j], lat[j], Yv ? Yv[j] : 1]); }
        return { type: 'scatter', coordinateSystem: 'geo', id: 'm' + k, name: g ?? 'points', data, symbolSize: size, itemStyle: { color: pal(k), opacity: 0.8 } };
    });
    return {
        option: base(ctx, { tooltip: tip(V, 'item', { formatter: (p: Opt) => `${esc(p.seriesName)}<br>${fmt(p.value[1])}°, ${fmt(p.value[0])}°${Yv ? `<br>${esc(ctx.name(val!))}: ${fmt(p.value[2])}` : ''}` }), geo: { map: 'world', roam: true, itemStyle: { areaColor: alpha(V.fg, 0.08), borderColor: alpha(V.fg, 0.3) }, emphasis: { itemStyle: { areaColor: alpha(V.fg, 0.16) }, label: { show: false } } }, series }),
        chips: split ? groups.map((g, k) => ({ name: String(g), color: pal(k) })) : null, summary: 'scroll to zoom, drag to pan',
    };
}

export function customDefault(): string {
    const nums = cols().filter(c => c.kind === 'num').map(c => c.name);
    return JSON.stringify({ xAxis: { type: 'value', name: nums[0] ?? 'x' }, yAxis: { type: 'value' }, series: [{ type: 'scatter', symbolSize: 4, encode: { x: nums[0] ?? 0, y: nums[1] ?? nums[0] ?? 1 } }] }, null, 2);
}

export function buildCustom(ctx: Ctx): Built {
    const names = cols().filter(c => c.kind !== 'array').map(c => c.name), N = Math.min(ctx.n, 5000), off = ctx.n - N;
    const data = names.map(c => ctx.col(c));
    const source: unknown[][] = [names];
    for (let j = 0; j < N; j++) { source.push(names.map((_, i) => { const v = data[i][off + j]; return typeof v === 'number' && !Number.isFinite(v) ? null : v; })); }
    let user: Opt;
    try { user = JSON.parse(ctx.p.options.custom || customDefault()); } catch (e) { throw new Error('The option JSON has a syntax error: ' + (e as Error).message); }
    if (!user || typeof user !== 'object' || Array.isArray(user)) { throw new Error('The option must be a JSON object, like {"series": [...]}.'); }
    const V = ctx.V, style = (a: unknown) => (Array.isArray(a) ? a.map(x => ({ ...ax(V), ...x })) : a ? { ...ax(V), ...(a as Opt) } : a);
    const opt: Opt = { ...base(ctx), ...user, dataset: { source } };
    if (user.xAxis) { opt.xAxis = style(user.xAxis); }
    if (user.yAxis) { opt.yAxis = style(user.yAxis); }
    return { option: opt, summary: `dataset: ${names.length} columns × ${N} rows` };
}
