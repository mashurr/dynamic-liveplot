// Draws one plot card with ECharts: builds the option, applies it cheaply on new rows,
// shows legend chips, and checks limits.

import * as echarts from 'echarts';
import { TYPES } from './charts/registry';
import { makeCtx, theme, type Built } from './charts/ctx';
import { Pending } from './charts/other';
import { ask } from './host';
import { chartCreated, decorate } from './hooks';
import { missingSlots, plotCols, colInfo, S, send, zooms, type Plot } from './state';
import { $$, esc, fmt, ic } from './util';

export interface CardRef {
    p: Plot;
    card: HTMLElement;
    host: HTMLElement;
    hint: HTMLElement;
    legend: HTMLElement;
    chart: echarts.ECharts | null;
    ver?: string;
    sigBase?: string;
    struct?: string;
    out?: Built;
    /** Within about half a screen of the visible area (set by an IntersectionObserver). */
    near?: boolean;
    /** Drawn even when far away (for exports). */
    pinned?: boolean;
}

// ECharts GL (loaded as a script) finds ECharts on window
(window as unknown as { echarts: typeof echarts }).echarts = echarts;

let glState: 'none' | 'loading' | 'ready' | 'error' = 'none';
let onGlReady: () => void = () => {};
export function setGlListener(f: () => void) { onGlReady = f; }
function loadGL() {
    if (glState !== 'none') { return; }
    glState = 'loading';
    const s = document.createElement('script');
    s.src = S.glUri;
    s.onload = () => { glState = 'ready'; onGlReady(); };
    s.onerror = () => { glState = 'error'; onGlReady(); };
    document.head.appendChild(s);
}

export const themeKey = () => document.body.className;
const linkGroup = (p: Plot) => (S.linkZoom ? `x:${(p.slots.x ?? [])[0] ?? '#row'}` : '');

export function disposeChart(ref: CardRef) {
    if (!ref.chart) { return; }
    // zrender spreads a heavy paint over several frames; dispose() doesn't cancel the rest, and the
    // next frame then reads the cleared painter. A new redraw id makes the pending frames stop.
    const painter = (ref.chart.getZr() as unknown as { painter?: { _redrawId?: number } }).painter;
    if (painter && typeof painter._redrawId === 'number') { painter._redrawId = -1; }
    ref.chart.dispose();
    ref.chart = null;
    ref.struct = undefined;
}

/** Remember the zoomed x range; a plot drawn from fewer points than rows redraws with detail for it. */
let zoomTimer = 0;
function onZoom(ref: CardRef) {
    const c = ref.chart;
    if (!c) { return; }
    const dz = (c.getOption().dataZoom as { start?: number; end?: number }[] | undefined)?.[0];
    const axis = (c as unknown as { getModel(): { getComponent(t: string, i: number): { axis?: { scale: { getExtent(): [number, number] } } } | undefined } }).getModel().getComponent('xAxis', 0)?.axis;
    if (!dz || !axis || ((dz.start ?? 0) <= 0 && (dz.end ?? 100) >= 100)) { zooms.delete(ref.p.id); } else { zooms.set(ref.p.id, axis.scale.getExtent()); }
    if (!ref.out?.decimated) { return; }
    clearTimeout(zoomTimer);
    zoomTimer = window.setTimeout(() => { ref.ver = undefined; renderChart(ref); }, 150);
}

export function renderChart(ref: CardRef, force = false) {
    const p = ref.p, T = TYPES[p.type];
    if (!T) { return; }
    // Plots far outside the view aren't drawn; they catch up when scrolled near
    if (!ref.near && !ref.pinned) { ref.ver = undefined; return; }
    const t = S.table;
    const ver = `${t.version}|${S.paused}|${S.pausedRows}|${S.cmp?.version ?? 0}|${S.cmpFile ?? ''}`;
    const sigBase = JSON.stringify([p.type, p.slots, p.series, p.options, p.title, S.bindings, S.fileBindings, S.linkZoom, themeKey(), t.schemaVersion]);
    if (!force && ref.ver === ver && ref.sigBase === sigBase) { return; }
    ref.ver = ver;
    const hint = ref.hint, miss = missingSlots(p), gone = plotCols(p).filter(c => !colInfo(c));
    const showHint = (html: string, err = false) => { disposeChart(ref); hint.hidden = false; hint.className = 'hint' + (err ? ' err' : ''); hint.innerHTML = html; ref.legend.innerHTML = ''; ref.sigBase = sigBase; ref.out = undefined; };
    if (!t.columns.length) { showHint('Waiting for data…'); return; }
    if (miss.length) {
        showHint(`<div><b>${esc(T.label)}</b> needs ${miss.map(s => `<b>${esc(s.label)}</b>${s.min ? ` (${s.min} or more)` : ''}`).join(', ')}.<br>Drop columns here, or fill the slots in the panel on the right.${gone.length ? `<br>Not in this file: ${esc(gone.join(', '))}` : ''}</div>`);
        setAlert(p, false);
        return;
    }
    if (T.gl && glState !== 'ready') { loadGL(); showHint(glState === 'error' ? 'The 3D engine could not load.' : 'Loading the 3D engine…', glState === 'error'); ref.sigBase = undefined; return; }
    let out: Built;
    try { out = T.build(makeCtx(p, theme())); } catch (e) { showHint(esc((e as Error).message), !(e instanceof Pending)); if (e instanceof Pending) { ref.sigBase = undefined; } return; }
    if (!ref.chart) {
        if (!ref.host.clientWidth || !ref.host.clientHeight) { ref.ver = undefined; return; }
        ref.chart = echarts.init(ref.host, null, { renderer: 'canvas' });
        ref.chart.on('legendselectchanged', (e: unknown) => {
            const sel = (e as { selected: Record<string, boolean> }).selected;
            p.hidden = Object.entries(sel).filter(([, v]) => !v).map(([k]) => k);
            renderChips(ref);
        });
        ref.chart.getZr().on('dblclick', () => ref.chart?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 }));
        ref.chart.on('datazoom', () => onZoom(ref));
        for (const f of chartCreated) { f(p, ref as CardRef & { chart: echarts.ECharts }); }
    }
    for (const f of decorate) { f(p, out.option, ref); }
    hint.hidden = true;
    const struct = sigBase + '|' + ((out.option.series ?? []) as { id?: string; type?: string }[]).map(s => `${s.id}:${s.type}`).join(',');
    try {
        if (force || ref.struct !== struct) {
            ref.chart.setOption(out.option, { notMerge: true });
            ref.struct = struct;
            const g = T.cart || p.type === 'candlestick' ? linkGroup(p) : '';
            ref.chart.group = g;
            if (g) { echarts.connect(g); }
        } else {
            const o = { ...out.option };
            delete o.dataZoom;
            // Applied right away: a deferred update can land after the chart is disposed and throw
            ref.chart.setOption(o, { replaceMerge: ['series'] });
        }
    } catch (e) {
        const m = (e as Error).message;
        showHint(/cycle|DAG/i.test(m) ? 'This data loops back on itself, which a Sankey can\'t draw. Try Chord or Network.' : esc(m), true);
        return;
    }
    ref.sigBase = sigBase;
    ref.out = out;
    renderChips(ref);
    checkAlerts(ref);
}

export function renderChips(ref: CardRef) {
    const out = ref.out, p = ref.p;
    let h = S.alerts[p.id] ? `<span class="alert-badge">${ic('flag', 'tiny')} Limit</span>` : '';
    if (out?.chips?.length) {
        h += out.chips.map(c => `<span class="chip ${(p.hidden ?? []).includes(c.name) ? 'off' : ''}" data-name="${esc(c.name)}" title="Click to hide or show" role="button" tabindex="0"><i style="${c.dashed ? `background:transparent;border:1.5px dashed ${c.color}` : `background:${c.color}`}"></i>${esc(c.label ?? c.name)}${c.value !== undefined ? ` <b>${fmt(c.value)}</b>` : ''}</span>`).join('');
    }
    if (out?.summary) { h += `<span class="summary">${esc(out.summary)}</span>`; }
    ref.legend.innerHTML = h;
    for (const n of $$('.chip[data-name]', ref.legend)) {
        const toggle = () => ref.chart?.dispatchAction({ type: 'legendToggleSelect', name: n.dataset.name });
        n.onclick = toggle;
        n.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    }
}

function checkAlerts(ref: CardRef) {
    const p = ref.p, out = ref.out, limits = p.options.limits ?? [];
    if (!limits.length || !out?.latest) { setAlert(p, false); return; }
    let hit: { name: string; value: number; limit: number; alert: string } | null = null;
    for (const l of out.latest) {
        if (l.axis === 'right' || l.value === null) { continue; }
        const L = limits.find(x => (x.alert === 'above' ? l.value! > x.value : l.value! < x.value));
        if (L) { hit = { name: l.name, value: l.value, limit: L.value, alert: L.alert }; break; }
    }
    if (hit && !S.alerts[p.id]) {
        void ask(`${hit.name} is ${fmt(hit.value)}, ${hit.alert} the ${fmt(hit.limit)} limit on "${p.title}".`, ['Show Plot'], 'warning').then(c => { if (c) { document.dispatchEvent(new CustomEvent('lp-select', { detail: p.id })); } });
    }
    if (setAlert(p, !!hit)) { renderChips(ref); }
}

/** Returns true when the plot's alert state changed. */
export function setAlert(p: Plot, on: boolean): boolean {
    if (!!S.alerts[p.id] === on) { return false; }
    S.alerts[p.id] = on;
    document.dispatchEvent(new CustomEvent('lp-alert', { detail: p.id }));
    return true;
}

export function alertCount() { return Object.values(S.alerts).filter(Boolean).length; }
export { send };
