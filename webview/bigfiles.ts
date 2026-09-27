// Files bigger than the row budget: the worker keeps one row in `stride` as an overview.
// Zooming into a plot offers to read every row of that range; "Back to overview" returns.

import type * as echarts from 'echarts';
import type { HostToView } from '../src/view/protocol';
import { makeCtx, theme } from './charts/ctx';
import { chartCreated } from './hooks';
import { rowRange, S, send, type Plot } from './state';
import { Table } from './table';
import { fmtInt } from './util';

const event = (name: string) => document.dispatchEvent(new CustomEvent(name));
let zoomTimer = 0;
let offered: { from: number; to: number } | null = null;
let requested: { from: number; to: number } | null = null;

/** The file rows [from, to) behind a plot's visible x range, or null when it shows everything. */
function zoomedRows(p: Plot, chart: echarts.ECharts): { from: number; to: number } | null {
    const axis = (chart as any).getModel?.()?.getComponent('xAxis', 0)?.axis;
    if (!axis || axis.type === 'category') { return null; }
    const [lo, hi] = axis.scale.getExtent() as [number, number];
    let ctx;
    try { ctx = makeCtx(p, theme()); } catch { return null; }
    const xs = ctx.x;
    let a = -1, b = -1, lo0 = Infinity, hi0 = -Infinity;
    for (let i = 0; i < xs.length; i++) {
        const v = xs[i];
        if (v === null || !Number.isFinite(v)) { continue; }
        lo0 = Math.min(lo0, v); hi0 = Math.max(hi0, v);
        if (v >= lo && v <= hi) { if (a < 0) { a = i; } b = i; }
    }
    // Nothing to gain unless the view is a real part of the data
    if (a < 0 || (lo <= lo0 && hi >= hi0)) { return null; }
    const start = S.table.start + rowRange(p)[0];
    const from = (start + a) * S.stride, to = (start + b + 1) * S.stride;
    return to - from > S.stride ? { from, to } : null;
}

function offer(range: { from: number; to: number } | null) {
    if (!range) {
        if (offered) { offered = null; if (S.banner?.text.startsWith('This is an overview')) { S.banner = null; event('lp-banner'); } }
        return;
    }
    offered = range;
    S.banner = {
        text: `This is an overview: 1 in ${fmtInt(S.stride)} of ${fmtInt(S.fileRows)} rows is shown. You're zoomed into rows ${fmtInt(range.from + 1)}–${fmtInt(range.to)}.`,
        actions: [{ label: 'Load every row here', run: () => load(range) }],
    };
    event('lp-banner');
}

function load(range: { from: number; to: number }) {
    S.banner = { text: `Reading rows ${fmtInt(range.from + 1)}–${fmtInt(range.to)}…` };
    event('lp-banner');
    requested = range;
    send({ type: 'range', from: range.from, to: range.to });
}

function back() {
    // Calculated columns added while in detail carry over
    for (const c of S.table.columns) { if (c.calc && !S.source.col(c.name)) { S.source.setCalc(c.name, c.calc.formula, c.calc.compiled); } }
    S.table = S.source;
    S.detail = null;
    S.banner = null;
    offered = null;
    event('lp-banner'); event('lp-live'); event('lp-columns'); event('lp-structure');
}

chartCreated.push((p, ref) => {
    ref.chart.on('datazoom', () => {
        if (S.stride <= 1 || S.detail) { return; }
        clearTimeout(zoomTimer);
        zoomTimer = window.setTimeout(() => offer(zoomedRows(p, ref.chart)), 250);
    });
});

document.addEventListener('lp-detail', e => {
    const m = (e as CustomEvent<HostToView & { type: 'detail' }>).detail;
    const t = new Table();
    t.applySchema(S.source.file, S.source.format, m.columns);
    t.applyRows(m.first, m.count, m.first, m.deltas);
    for (const c of S.source.columns) { if (c.calc) { try { t.setCalc(c.name, c.calc.formula, c.calc.compiled); } catch { /* a column already has that name */ } } }
    S.table = t;
    S.detail = { from: m.first, to: m.first + m.count };
    const capped = !!requested && m.count < requested.to - requested.from;
    offered = requested = null;
    S.banner = {
        text: `Showing every row from ${fmtInt(m.first + 1)} to ${fmtInt(m.first + m.count)}${capped ? ' (as many as fit in memory)' : ''}.`,
        actions: [{ label: 'Back to overview', run: back }],
    };
    event('lp-banner'); event('lp-live'); event('lp-columns'); event('lp-structure');
});

// A new overview (the stride grew, or the file was reopened) ends any offer
document.addEventListener('lp-stride', () => { offered = null; event('lp-live'); });
