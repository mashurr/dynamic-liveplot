// The Dynamic Liveplot view: toolbar, column list, plot grid and inspector.

import './charts/index';
import { TYPES, glyph } from './charts/registry';
import { afterAdd, extensions, groupSections } from './hooks';
import './options';
import './gallery';
import './analysis';
import './groups';
import './bigfiles';
import './export';
import { answered, ask, notify, run } from './host';
import { renderInspector, KIND_GLYPH, KIND_NAME, type InspectorHooks } from './inspector';
import { gridPicker, showMenu } from './menus';
import { alertCount, disposeChart, renderChart, setGlListener, type CardRef } from './render';
import { setWorldListener } from './charts/other';
import { autoAssign, cols, colInfo, dn, fromLayout, kindOf, newPlot, plotCols, remapSlots, S, saveSoon, send, uid, vscode, type Plot } from './state';
import type { HostToView } from '../src/view/protocol';
import type { FromWorker } from '../src/data/protocol';
import { unpackDeltas } from '../src/view/pack';
import { Table } from './table';
import { $, $$, clone, el, esc, fmt, fmtInt, fmtTime, ic } from './util';

interface UIRefs { lp: HTMLElement; tool: HTMLElement; banner: HTMLElement; colsBox: HTMLElement; list: HTMLElement; wrap: HTMLElement; stack: HTMLElement; insp: HTMLElement; cards: Map<number, CardRef>; cro: ResizeObserver; io: IntersectionObserver }
let UI: UIRefs | null = null;
let dirty = false;

/* ---------- messages from the extension ---------- */
/** Row data arrives with its arrays packed into two buffers (see pack.ts). */
function unpackedData<T extends FromWorker>(m: T): T {
    if (m.type === 'rows' && m.packed) { return { ...m, columns: unpackDeltas(m.columns, m.packed), packed: undefined }; }
    if (m.type === 'detail' && m.packed) { return { ...m, deltas: unpackDeltas(m.deltas, m.packed), packed: undefined }; }
    return m;
}
function unpacked(m: HostToView): HostToView {
    if (m.type === 'compare' && m.data) { return { ...m, data: unpackedData(m.data) }; }
    return 'id' in m ? unpackedData(m as FromWorker) as HostToView : m;
}
window.addEventListener('message', e => onHost(unpacked(e.data as HostToView)));

function onHost(m: HostToView) {
    switch (m.type) {
        case 'init':
            S.mode = m.mode; S.path = m.path; S.name = m.name; S.glUri = m.glUri; S.mapUri = m.mapUri;
            vscode.setState({ mode: m.mode, path: m.path });
            S.tableName = m.table ?? S.tableName;
            if (!m.layout) { S.started = false; S.plots = []; S.banner = null; S.sel = null; }
            if (m.layout) {
                fromLayout(m.layout);
                S.started = true;
                S.banner = { text: m.origin === 'team' ? `Using the team layout from ${m.originName ?? '.liveplot.json'}.` : `Restored the layout you last used for ${m.mode === 'folder' ? m.name + '/' : m.name}.` };
            }
            renderShell();
            break;
        case 'schema': {
            if (S.detail) { S.table = S.source; S.detail = null; }
            S.table.applySchema(m.file, m.format, m.columns);
            if (!S.started) {
                // Auto-plot once the first rows arrive, so column shapes can be judged from data
                pendingAuto = true;
            } else if (m.reason === 'switched') {
                S.banner = { text: `Switched to the newest file in ${S.name}/: ${base(m.file)}. Your layout carried over.` };
            } else if (m.reason === 'replaced' || m.reason === 'truncated') {
                S.banner = { text: m.reason === 'truncated' ? `${base(m.file)} was emptied and is being read again.` : `${base(m.file)} was replaced and has been read again.` };
            }
            S.paused = false;
            document.dispatchEvent(new CustomEvent('lp-schema', { detail: m.reason }));
            if (UI) { renderToolbar(); renderBanner(); renderColumns(); renderGrid(); renderInspectorNow(); }
            break;
        }
        case 'rows':
            S.source.applyRows(m.first, m.count, m.dropped, m.columns);
            if (pendingAuto) { runAutoPlot(); }
            dirty = true;
            break;
        case 'bindings':
            S.fileBindings = m.bindings;
            if (UI) { renderColumns(); forceRebuild(); }
            break;
        case 'status':
            S.status = m;
            if (m.stride !== S.stride || m.fileRows !== S.fileRows) { S.stride = m.stride; S.fileRows = m.fileRows; document.dispatchEvent(new CustomEvent('lp-stride')); }
            if (pendingAuto && m.state === 'tailing' && m.rows === 0) { runAutoPlot(); }
            updateLive();
            break;
        case 'tables':
            S.tables = m.tables;
            S.tableName = m.table;
            if (UI) { renderToolbar(); renderGrid(); }
            break;
        case 'renamed':
            S.table.file = m.to;
            S.banner = { text: `Following the rename: ${base(m.from)} is now ${base(m.to)}.` };
            if (UI) { renderToolbar(); renderBanner(); }
            break;
        case 'error':
            S.banner = { text: m.message };
            if (UI) { renderBanner(); }
            break;
        case 'command':
            runCommand(m.name);
            break;
        case 'layout':
            fromLayout(m.layout);
            // A layout chosen before the first rows arrive must not be replaced by auto-plot
            S.started = true; pendingAuto = false;
            document.dispatchEvent(new CustomEvent('lp-schema', { detail: 'layout' }));
            S.banner = { text: m.origin === 'team' ? `Applied the team layout.` : `Applied layout "${m.originName ?? ''}".` };
            changed(true);
            break;
        case 'answer':
            answered(m.token, m.choice);
            break;
        case 'compare':
            document.dispatchEvent(new CustomEvent('lp-compare', { detail: m }));
            break;
        case 'detail':
            document.dispatchEvent(new CustomEvent('lp-detail', { detail: m }));
            break;
        case 'visible':
            document.dispatchEvent(new CustomEvent('lp-visible', { detail: m.visible }));
            break;
    }
}

const base = (f: string) => f.split(/[\\/]/).pop() ?? f;

let pendingAuto = false;
function runAutoPlot() {
    pendingAuto = false;
    const r = extensions.autoPlot();
    S.started = true;
    S.banner = { text: `Auto-plotted ${r.count} chart${r.count === 1 ? '' : 's'}. ${r.how} Drag columns to change it.`.replace(/\s+/g, ' ').trim(), actions: [{ label: 'Start empty', run: () => { S.plots = [newPlot('Plot 1', 'line', {}, { autoTitle: true })]; S.grid = { columns: 2, rows: 2 }; S.banner = null; changed(true); } }] };
    saveSoon();
    if (UI) { renderToolbar(); renderBanner(); renderGrid(); renderInspectorNow(); }
}

function runCommand(name: string) {
    if (name === 'reinit') {
        S.table = S.source = new Table(); S.stride = 1; S.fileRows = 0; S.detail = null; S.tables = []; S.tableName = null; S.plots = []; S.started = false; S.sel = null; S.status = null; S.banner = null;
        pendingAuto = false;
        send({ type: 'ready' });
        return;
    }
    const custom = extensions.commands[name];
    if (custom) { custom(); return; }
    switch (name) {
        case 'addPlot': addEmptyPlot(); break;
        case 'autoPlot': { const r = extensions.autoPlot(); S.banner = null; changed(true); notify(`Auto-plotted ${r.count} charts. ${r.how}`.trim()); break; }
        case 'togglePause': togglePause(); break;
        case 'toggleColumns': setColumnsHidden(!S.columnsHidden); break;
        case 'changeChartType': { const p = S.plots.find(x => x.id === S.sel) ?? S.plots[0]; if (p) { select(p.id); extensions.openTypes(p); } break; }
    }
}

/* ---------- shell ---------- */
function renderShell() {
    const app = $('#app');
    app.innerHTML = '';
    const lp = el(`<div class="lp">
      <div class="lp-toolbar" role="toolbar" aria-label="Plot tools"></div>
      <div class="lp-banner" role="status" hidden></div>
      <div class="lp-body">
        <div class="lp-cols">
          <button class="rail" title="Show columns" aria-label="Show columns">${ic('chevR', 'tiny')}<span>COLUMNS</span></button>
          <div class="lp-h"><span>COLUMNS</span><span class="grow"></span><span class="count"></span><button class="ibtn" data-hide title="Hide the column list to give the plots more room" aria-label="Hide the column list">${ic('chevL', 'tiny')}</button></div>
          <div class="search">${ic('search', 'tiny')}<input type="search" placeholder="Filter columns" aria-label="Filter columns"></div>
          <div class="col-list" role="list"></div>
          <div class="col-foot"><button class="lnk" data-calc-add>+ Calculated column</button><br>Drag a column onto a plot, a slot on the right, or New plot.</div>
        </div>
        <div class="lp-gridwrap"><div class="lp-stack"></div></div>
        <aside class="lp-insp" aria-label="Plot settings" hidden></aside>
      </div>
    </div>`);
    app.appendChild(lp);
    UI = { lp, tool: $('.lp-toolbar', lp), banner: $('.lp-banner', lp), colsBox: $('.lp-cols', lp), list: $('.col-list', lp), wrap: $('.lp-gridwrap', lp), stack: $('.lp-stack', lp), insp: $('.lp-insp', lp), cards: new Map(), cro: new ResizeObserver(onResize), io: null as unknown as IntersectionObserver };
    UI.io = new IntersectionObserver(onNear, { root: UI.wrap, rootMargin: '50% 0px' });
    // In a narrow editor the column list would cover the plots, so it starts collapsed there
    if (UI.lp.clientWidth && UI.lp.clientWidth < 560 && !S.columnsHidden) { setColumnsHidden(true, false); }
    let listScroll = 0;
    UI.list.addEventListener('scroll', () => { clearTimeout(listScroll); listScroll = window.setTimeout(updateColumnValues, 80); }, { passive: true });
    const search = $('.search input', lp) as HTMLInputElement;
    search.value = S.search;
    search.oninput = () => { S.search = search.value; renderColumns(); };
    $('[data-hide]', lp).onclick = () => setColumnsHidden(true);
    $('[data-calc-add]', lp).onclick = () => document.dispatchEvent(new CustomEvent('lp-calc-edit', { detail: null }));
    $('.rail', lp).onclick = () => setColumnsHidden(false);
    UI.wrap.addEventListener('mousedown', e => { if (e.target === UI!.wrap || e.target === UI!.stack || (e.target as HTMLElement).classList.contains('lp-grid')) { select(null); } });
    lp.addEventListener('dragend', endDrag);
    new ResizeObserver(() => layoutGrid()).observe(UI.wrap);
    setColumnsHidden(S.columnsHidden, false);
    renderToolbar(); renderBanner(); renderColumns(); renderGrid(); renderInspectorNow();
}

/** Cards scrolled near the view get a chart; ones far away give theirs up after a while to save memory. */
function onNear(entries: IntersectionObserverEntry[]) {
    for (const en of entries) {
        const ref = (en.target as HTMLElement & { _ref?: CardRef })._ref;
        if (!ref) { continue; }
        ref.near = en.isIntersecting;
        if (ref.near) { queue.add(ref); schedule(); } else { setTimeout(() => { if (!ref.near && !ref.pinned) { disposeChart(ref); ref.ver = undefined; } }, 5000); }
    }
}

function onResize(entries: ResizeObserverEntry[]) {
    for (const en of entries) {
        const ref = (en.target as HTMLElement & { _ref?: CardRef })._ref;
        if (!ref) { continue; }
        if (ref.chart) { ref.chart.resize(); } else { renderChart(ref, true); }
    }
}

function setColumnsHidden(hide: boolean, save = true) {
    S.columnsHidden = hide;
    if (!UI) { return; }
    UI.colsBox.classList.toggle('collapsed', hide);
    $('[data-cols]', UI.tool)?.classList.toggle('on', !hide);
    if (save) { saveSoon(); }
}

/* ---------- toolbar ---------- */
function renderToolbar() {
    if (!UI) { return; }
    const t = S.table, file = t.file ? base(t.file) : S.name;
    const label = S.mode === 'folder' ? `<span class="dim">${esc(S.name)}/</span>${t.file ? esc(file) : ''}` : S.tableName && S.tables.length > 1 ? `${esc(S.name)} <span class="dim">›</span> ${esc(S.tableName)}` : esc(file);
    UI.tool.innerHTML = `
      <button class="tbtn icon ${S.columnsHidden ? '' : 'on'}" data-cols title="Show or hide the column list" aria-label="Show or hide the column list">${ic('sidebar')}</button>
      <button class="tbtn src" data-src title="${S.mode === 'folder' ? 'Watching this folder. The newest file is plotted automatically.' : 'Plotting one file'}">${ic(S.mode === 'folder' ? 'eye' : 'table')}<span>${label}</span>${ic('chevD', 'tiny')}</button>
      <span class="pill" data-pill></span>
      <button class="tbtn" data-pause></button>
      <span class="tsep"></span>
      <button class="tbtn" data-grid title="Grid size">${ic('grid')}<span>${S.grid.columns} × ${S.grid.rows}</span></button>
      <button class="tbtn" data-add title="Add an empty plot">${ic('plus')}<span>Plot</span></button>
      <button class="tbtn icon" data-auto title="Auto-plot this file again" aria-label="Auto-plot again">${ic('wand')}</button>
      <span class="tgrow"></span>
      ${extensions.toolbarRight.map(f => f()).join('')}
      <button class="tbtn" data-layout title="Layout">${ic('layout')}<span>Layout</span>${ic('chevD', 'tiny')}</button>`;
    const tool = UI.tool;
    $('[data-cols]', tool).onclick = () => setColumnsHidden(!S.columnsHidden);
    $('[data-src]', tool).onclick = e => sourceMenu(e.currentTarget as HTMLElement);
    $('[data-pause]', tool).onclick = togglePause;
    $('[data-grid]', tool).onclick = e => gridPicker(e.currentTarget as HTMLElement, S.grid, (c, r) => { S.grid = { columns: c, rows: r }; changed(true); });
    $('[data-add]', tool).onclick = addEmptyPlot;
    $('[data-auto]', tool).onclick = () => runCommand('autoPlot');
    $('[data-layout]', tool).onclick = e => layoutMenu(e.currentTarget as HTMLElement);
    for (const f of extensions.wireToolbar) { f(tool); }
    updateLive();
}

interface Live { state: 'live' | 'paused' | 'finished' | 'static' | 'reading' | 'waiting'; cls: string; text: string }
function liveState(): Live {
    const st = S.status, rows = S.source.rows;
    if (S.detail) { return { state: 'static', cls: 'static', text: `Detail · rows ${fmtInt(S.detail.from + 1)}–${fmtInt(S.detail.from + S.table.length)}` }; }
    if (!st || st.state === 'waiting') { return { state: 'waiting', cls: 'waiting', text: S.mode === 'folder' ? 'Waiting for a data file' : 'Waiting for the file' }; }
    if (st.state === 'missing') { return { state: 'finished', cls: 'done', text: `File removed · ${fmtInt(rows)} rows` }; }
    if (st.state === 'reading' && !st.lastGrowth) { return { state: 'reading', cls: 'reading', text: `Reading ${st.size ? Math.min(99, Math.round(st.bytesRead / st.size * 100)) : 0}% · ${fmtInt(S.stride > 1 ? S.fileRows : rows)} rows` }; }
    if (S.stride > 1 && !st.lastGrowth) { return { state: 'static', cls: 'static', text: `Overview · ${fmtInt(S.fileRows)} rows, 1 in ${fmtInt(S.stride)} shown` }; }
    const growing = st.lastGrowth > 0 && Date.now() - st.lastGrowth < 15000;
    if (growing) { return S.paused ? { state: 'paused', cls: 'paused', text: `Paused · ${fmtInt(Math.max(0, rows - S.pausedRows))} new rows waiting` } : { state: 'live', cls: 'live', text: `Live · ${fmtInt(rows)} rows` }; }
    if (st.lastGrowth) { return { state: 'finished', cls: 'done', text: `Finished · ${fmtInt(rows)} rows` }; }
    return { state: 'static', cls: 'static', text: `${S.table.format.toUpperCase()} · ${fmtInt(rows)} rows` };
}
let lastSent = '';
function updateLive() {
    const live = liveState();
    if (live.state !== 'live' && live.state !== 'paused' && S.paused) { S.paused = false; }
    if (UI) {
        const p = $('[data-pill]', UI.tool), b = $('[data-pause]', UI.tool);
        if (p) { p.className = 'pill ' + live.cls; p.innerHTML = `<i></i>${esc(live.text)}`; }
        if (b) { b.hidden = live.state !== 'live' && live.state !== 'paused'; b.innerHTML = S.paused ? `${ic('play')}<span>Resume</span>` : `${ic('pause')}<span>Pause</span>`; }
    }
    const key = `${live.state}|${live.text}|${alertCount()}`;
    if (key !== lastSent) { lastSent = key; send({ type: 'state', state: live.state, text: live.text, alerts: alertCount() }); }
}
setInterval(updateLive, 1000);

function togglePause() {
    const live = liveState();
    if (live.state !== 'live' && live.state !== 'paused') { return; }
    S.paused = !S.paused;
    if (S.paused) { S.pausedRows = S.source.rows; }
    updateLive();
    dirty = true;
}

function renderBanner() {
    if (!UI) { return; }
    const b = UI.banner;
    if (!S.banner) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = `${ic('info')}<span class="grow">${esc(S.banner.text)}</span>${(S.banner.actions ?? []).map((a, i) => `<button class="lnk" data-a="${i}">${esc(a.label)}</button>`).join('')}<button class="ibtn" data-x aria-label="Dismiss">${ic('close', 'tiny')}</button>`;
    for (const x of $$('[data-a]', b)) { x.onclick = () => S.banner?.actions?.[+x.dataset.a!].run(); }
    $('[data-x]', b).onclick = () => { S.banner = null; renderBanner(); };
}

function sourceMenu(anchor: HTMLElement) {
    const file = S.table.file;
    showMenu(anchor, [
        S.mode === 'folder' ? { note: `Watching ${S.name}/. When a newer file appears there, this view switches to it and keeps the layout.` } : { note: `Plotting ${S.name}. It won't follow newer files.` },
        { sep: true },
        ...(S.tables.length > 1 ? [{ label: `Switch ${sheetWord()}…`, run: () => pickTableMenu(anchor) }] : []),
        { label: 'Open Another Data File…', run: () => run('dynamicLiveplot.switchFile') },
        S.mode === 'folder' ? { label: 'Open This File on Its Own', disabled: !file, run: () => run('dynamicLiveplot.openCurrentFile') } : { label: "Watch This File's Folder", run: () => run('dynamicLiveplot.watchParent') },
        { label: 'Open File as Text', disabled: !file && S.mode === 'folder', run: () => run('dynamicLiveplot.openAsText') },
        { label: 'Reveal in Explorer', disabled: !file && S.mode === 'folder', run: () => run('dynamicLiveplot.reveal') },
    ]);
}

const sheetWord = () => (/\.xlsx$/i.test(S.path) ? 'Sheet' : 'Table');
function pickTableMenu(anchor: HTMLElement) {
    showMenu(anchor, S.tables.map(t => ({ label: t.name, hint: `${fmtInt(t.rows)} rows`, strong: t.name === S.tableName, run: () => { if (t.name !== S.tableName) { send({ type: 'table', name: t.name }); } } })));
}

function layoutMenu(anchor: HTMLElement) {
    showMenu(anchor, [
        ...extensions.layoutMenu.flatMap(f => f()),
        { label: 'Auto-plot Again', run: () => runCommand('autoPlot') },
        { label: 'Clear All Plots', disabled: !S.plots.length, run: () => { const old = S.plots; S.plots = []; S.sel = null; changed(true); void ask('Cleared all plots.', ['Undo']).then(c => { if (c) { S.plots = old; changed(true); } }); } },
        { sep: true },
        { note: `Changes save automatically for ${S.mode === 'folder' ? S.name + '/' : S.name}, so reopening it brings this layout back.` },
    ]);
}

/* ---------- column list ---------- */
function renderColumns() {
    if (!UI) { return; }
    const all = cols(), q = S.search.trim().toLowerCase();
    const shown = all.filter(c => !q || c.name.toLowerCase().includes(q) || dn(c.name).toLowerCase().includes(q));
    $('.count', UI.colsBox).textContent = shown.length === all.length ? String(all.length) : `${shown.length}/${all.length}`;
    // Thousands of rows (each with a sparkline) make the list slow; past the cap, filtering finds the rest
    const listed = shown.slice(0, LIST_CAP);
    UI.list.innerHTML = !all.length ? `<div class="note">${S.status?.state === 'waiting' ? 'Waiting for data…' : 'Reading…'}</div>` : shown.length ? listed.map(c => {
        const d = dn(c.name), calc = S.table.col(c.name)?.calc;
        return `<div class="col" draggable="true" tabindex="0" data-col="${esc(c.name)}" role="listitem" title="${calc ? `calculated: ${esc(calc.formula)} (double-click to edit)` : `${KIND_NAME[c.kind]} column: drag onto a plot, or press Enter to add it`}">
          <span class="k">${calc ? 'ƒ' : KIND_GLYPH[c.kind]}</span><span class="n">${esc(d)}</span>
          ${d !== c.name ? `<span class="raw">${esc(c.name)}</span>` : '<span class="v" data-v></span>'}
          <canvas width="92" height="40"></canvas>
          <button class="add" title="Add to the selected plot, or make a new one" aria-label="Add ${esc(d)}">${ic('plus', 'tiny')}</button></div>`;
    }).join('') + (shown.length > listed.length ? `<div class="note">Showing ${fmtInt(listed.length)} of ${fmtInt(shown.length)} columns. Type in the filter to find the rest.</div>` : '') : `<div class="note">No column matches "${esc(S.search)}".</div>`;
    for (const n of $$('.col', UI.list)) {
        const col = n.dataset.col!;
        n.addEventListener('dragstart', e => { e.dataTransfer!.setData('text/plain', col); e.dataTransfer!.effectAllowed = 'copy'; startDrag(col); });
        n.addEventListener('keydown', e => { if (e.target === n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); quickAdd(col); } });
        n.addEventListener('dblclick', () => { if (S.table.col(col)?.calc) { document.dispatchEvent(new CustomEvent('lp-calc-edit', { detail: col })); } else { quickAdd(col); } });
        ($('.add', n) as HTMLButtonElement).onclick = e => { e.stopPropagation(); quickAdd(col); };
    }
    updateColumnValues();
}

const LIST_CAP = 400;
/** Refresh the latest value and sparkline of the column rows scrolled into view. */
function updateColumnValues() {
    if (!UI || UI.colsBox.classList.contains('collapsed')) { return; }
    const t = S.table, stroke = getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground') || '#888';
    const top = UI.list.scrollTop - 50, bottom = UI.list.scrollTop + UI.list.clientHeight + 50;
    for (const n of $$('.col', UI.list)) {
        if (n.offsetTop + n.offsetHeight < top || n.offsetTop > bottom) { continue; }
        const c = t.col(n.dataset.col!);
        if (!c) { continue; }
        const cv = n.querySelector('canvas')!, g = cv.getContext('2d')!, v = n.querySelector('[data-v]');
        g.clearRect(0, 0, cv.width, cv.height);
        if (c.kind === 'text') {
            const tail = t.texts(c.name, Math.max(0, t.length - 300), t.length), counts = new Map<string, number>();
            for (const x of tail) { if (x !== null) { counts.set(x, (counts.get(x) ?? 0) + 1); } }
            if (v) { v.textContent = `${tail[tail.length - 1] ?? '—'} · ${counts.size} values`; }
            let x0 = 2;
            [...counts.values()].slice(0, 8).forEach((k, i) => { const w = (cv.width - 4) * k / (tail.length || 1); g.fillStyle = ['#56B4E9', '#E69F00', '#2EBD8E', '#FF7A45', '#E08FC0', '#6FA8FF', '#F0E442', '#B0B0B0'][i]; g.fillRect(x0, 12, Math.max(1, w - 1), 16); x0 += w; });
            continue;
        }
        const ys = c.kind === 'array' ? (t.arrays(c.name).at(-1)?.values ?? new Float64Array(0)) : t.numbers(c.name, Math.max(0, t.length - 60), t.length);
        const last = ys.length ? ys[ys.length - 1] : NaN;
        if (v) { v.textContent = c.kind === 'array' ? `${ys.length} values` : c.kind === 'time' ? fmtTime(last) : fmt(last); }
        if (c.kind === 'time' || ys.length < 2) { continue; }
        let lo = Infinity, hi = -Infinity;
        for (const y of ys) { if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }
        if (!Number.isFinite(lo)) { continue; }
        if (hi === lo) { hi += 1; lo -= 1; }
        g.strokeStyle = stroke; g.lineWidth = 2; g.beginPath();
        let started = false;
        ys.forEach((y, i) => { if (!Number.isFinite(y)) { started = false; return; } const px = i / (ys.length - 1) * (cv.width - 4) + 2, py = cv.height - 4 - (y - lo) / (hi - lo) * (cv.height - 8); if (started) { g.lineTo(px, py); } else { g.moveTo(px, py); started = true; } });
        g.stroke();
    }
}

/* ---------- drag and drop ---------- */
let drag: string | null = null;
function startDrag(col: string) {
    drag = col;
    if (!UI) { return; }
    UI.lp.classList.add('dragging');
    const kind = kindOf(col)!;
    for (const cd of $$('.card', UI.stack)) {
        const p = S.plots.find(x => x.id === +cd.dataset.id!);
        if (!p) { continue; }
        const T = TYPES[p.type], dzy = $('.dz-y', cd), dzx = $('.dz-x', cd);
        const s = autoAssign(clone(p), col);
        dzy.textContent = s === 'dup' ? 'Already on this plot' : s ? `Add as ${s.label}` : `${T.label} has no slot for this. Drop for options.`;
        const xs = T.slots.find(t => t.id === 'x'), ok = !!xs && xs.kinds.includes(kind);
        dzx.classList.toggle('no', !ok);
        dzx.textContent = ok ? 'Set as X axis' : xs ? `X takes ${xs.kinds.map(k => KIND_NAME[k]).join(' or ')}` : `${T.label} has no X axis`;
    }
    const sel = S.plots.find(x => x.id === S.sel);
    for (const w of $$('.well', UI.insp)) {
        const s = sel && TYPES[sel.type].slots.find(t => t.id === w.dataset.slot);
        w.classList.toggle('fits', !!s && s.kinds.includes(kind));
    }
}
function endDrag() { drag = null; if (UI) { UI.lp.classList.remove('dragging'); for (const n of $$('.over,.fits', UI.lp)) { n.classList.remove('over', 'fits'); } } }
export function wireDrop(node: HTMLElement, onDrop: (col: string) => void) {
    node.addEventListener('dragover', e => { if (!drag) { return; } e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; node.classList.add('over'); });
    node.addEventListener('dragleave', () => node.classList.remove('over'));
    node.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); const col = drag ?? e.dataTransfer!.getData('text/plain'); endDrag(); if (col) { onDrop(col); } });
}

export function autoTitle(p: Plot): string {
    const all = plotCols(p).filter(c => colInfo(c)), x = p.slots.x ?? [];
    const cs = all.some(c => !x.includes(c)) ? all.filter(c => !x.includes(c)) : all;
    return cs.length ? cs.slice(0, 2).map(dn).join(' & ') + (cs.length > 2 ? ' …' : '') : p.title;
}
function addEmptyPlot() {
    const p = newPlot(`Plot ${S.plots.length + 1}`, 'line', {}, { autoTitle: true });
    S.plots.push(p); S.sel = p.id; changed(true);
}
export function newPlotWith(col: string) {
    const type = extensions.recommend([col])[0] ?? 'line';
    const p = newPlot(dn(col), type, {}, { autoTitle: true });
    const time = cols().find(c => c.kind === 'time');
    if (TYPES[type].slots.some(s => s.id === 'x') && time && kindOf(col) === 'num') { p.slots.x = [time.name]; }
    autoAssign(p, col);
    p.title = autoTitle(p);
    S.plots.push(p); S.sel = p.id; changed(true);
    return p;
}
function dropOnPlot(p: Plot, col: string) {
    const r = autoAssign(p, col);
    if (r === 'dup') { notify(`${dn(col)} is already on "${p.title}".`); return; }
    if (r) { if (p.autoTitle) { p.title = autoTitle(p); } for (const f of afterAdd) { f(p, r.id, col); } changed(true); return; }
    const best = extensions.recommend(plotCols(p).concat([col])).find(id => id !== p.type);
    if (!plotCols(p).length && best) { p.type = best; autoAssign(p, col); if (p.autoTitle) { p.title = autoTitle(p); } changed(true); return; }
    const kind = KIND_NAME[kindOf(col) ?? 'num'];
    const actions = [...(best ? [`Switch to ${TYPES[best].label}`] : []), 'New Plot with It'];
    void ask(`${TYPES[p.type].label} has no slot for a ${kind} column like ${dn(col)}.`, actions).then(c => {
        if (!c) { return; }
        if (c.startsWith('Switch') && best) { remapSlots(p, best); autoAssign(p, col); if (p.autoTitle) { p.title = autoTitle(p); } changed(true); } else { newPlotWith(col); }
    });
}
function dropOnX(p: Plot, col: string) {
    const xs = TYPES[p.type].slots.find(s => s.id === 'x');
    if (!xs || !xs.kinds.includes(kindOf(col)!)) { notify(xs ? `The X axis of ${TYPES[p.type].label} takes a ${xs.kinds.map(k => KIND_NAME[k]).join(' or ')} column.` : `${TYPES[p.type].label} has no X axis.`); return; }
    for (const k of Object.keys(p.slots)) { p.slots[k] = (p.slots[k] ?? []).filter(c => c !== col); }
    p.slots.x = [col];
    changed(true);
}
function quickAdd(col: string) {
    const p = S.plots.find(x => x.id === S.sel);
    if (p) { dropOnPlot(p, col); } else { newPlotWith(col); }
}

/* ---------- grid ---------- */
function layoutGrid() {
    if (!UI) { return; }
    const h = UI.wrap.clientHeight - 20 - 10 * (S.grid.rows - 1) - S.groups.length * 42;
    // Five or more rows is a request for a dense dashboard: let rows shrink further before scrolling
    const rowH = Math.max(S.grid.rows > 4 ? 140 : 190, Math.floor(h / S.grid.rows));
    for (const g of $$('.lp-grid', UI.stack)) { g.style.gridTemplateColumns = `repeat(${S.grid.columns}, minmax(0, 1fr))`; g.style.gridAutoRows = rowH + 'px'; }
}

function renderGrid() {
    if (!UI) { return; }
    for (const r of UI.cards.values()) { disposeChart(r); }
    UI.cards.clear();
    UI.cro.disconnect();
    UI.io.disconnect();
    queue.clear();
    UI.stack.innerHTML = '';
    if (S.tables.length > 1 && !S.tableName) {
        const word = sheetWord().toLowerCase();
        UI.stack.appendChild(el(`<div class="empty"><div><p>${esc(S.name)} has ${S.tables.length} ${word}s. Pick one to plot:</p><div class="pick">${S.tables.map(t => `<button class="vbtn sec" data-table="${esc(t.name)}">${esc(t.name)} <span class="dim">${fmtInt(t.rows)} rows · ${t.columns} columns</span></button>`).join('')}</div></div></div>`));
        for (const b of $$('[data-table]', UI.stack)) { b.onclick = () => send({ type: 'table', name: b.dataset.table! }); }
        return;
    }
    const placed = new Set<number>();
    for (const f of groupSections) { for (const id of f(UI.stack, makeCard)) { placed.add(id); } }
    const grid = el('<div class="lp-grid"></div>');
    for (const p of S.plots) { if (!placed.has(p.id)) { grid.appendChild(makeCard(p)); } }
    const nt = el(`<div class="newtile" role="button" tabindex="0" aria-label="Add a plot"><div><b>${ic('plus')}New plot</b><small>or drop any column here</small></div></div>`);
    nt.onclick = addEmptyPlot;
    nt.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addEmptyPlot(); } };
    wireDrop(nt, col => newPlotWith(col));
    grid.appendChild(nt);
    UI.stack.appendChild(grid);
    layoutGrid();
    // Draw cards on screen now; waiting for the IntersectionObserver would flash empty cards on every change
    const view = UI.wrap.getBoundingClientRect(), margin = view.height / 2;
    for (const r of UI.cards.values()) {
        const b = r.card.getBoundingClientRect();
        r.near = b.bottom >= view.top - margin && b.top <= view.bottom + margin;
        if (r.near) { renderChart(r, true); }
    }
}

function makeCard(p: Plot): HTMLElement {
    const card = el(`<div class="card ${S.sel === p.id ? 'sel' : ''} ${S.alerts[p.id] ? 'alert' : ''}" data-id="${p.id}" tabindex="0" aria-label="${esc(p.title)}">
      <div class="card-h"><span title="${esc(TYPES[p.type].label)}">${glyph(p.type)}</span><span class="card-t" title="Double-click to rename">${esc(p.title)}</span><div class="legend"></div><button class="ibtn" data-m title="Plot menu" aria-label="Plot menu">${ic('more')}</button><button class="ibtn" data-x title="Delete plot" aria-label="Delete plot">${ic('close', 'tiny')}</button></div>
      <div class="card-b"><div class="chart-host"></div><div class="hint" hidden></div><div class="drop"><div class="dz dz-y"></div><div class="dz dz-x"></div></div></div></div>`);
    const ref: CardRef = { p, card, host: $('.chart-host', card), hint: $('.hint', card), legend: $('.legend', card), chart: null };
    (ref.host as HTMLElement & { _ref?: CardRef })._ref = ref;
    UI!.cards.set(p.id, ref);
    UI!.cro.observe(ref.host);
    UI!.io.observe(card);
    (card as HTMLElement & { _ref?: CardRef })._ref = ref;
    card.addEventListener('mousedown', e => { if (!(e.target as HTMLElement).closest('button')) { select(p.id); } });
    card.addEventListener('keydown', e => { if (e.target === card && e.key === 'Enter') { select(p.id); } });
    card.addEventListener('contextmenu', e => { e.preventDefault(); select(p.id); plotMenu(e, p); });
    $('[data-m]', card).onclick = e => plotMenu(e.currentTarget as HTMLElement, p);
    $('[data-x]', card).onclick = () => removePlot(p);
    const tt = $('.card-t', card);
    tt.ondblclick = () => renameInline(p, tt);
    wireDrop($('.dz-y', card), col => dropOnPlot(p, col));
    wireDrop($('.dz-x', card), col => dropOnX(p, col));
    return card;
}

function renameInline(p: Plot, tt: HTMLElement) {
    tt.innerHTML = `<input value="${esc(p.title)}" aria-label="Plot title">`;
    const inp = tt.querySelector('input')!;
    inp.focus(); inp.select();
    let done = false;
    const finish = (ok: boolean) => { if (done) { return; } done = true; if (ok && inp.value.trim()) { p.title = inp.value.trim(); p.autoTitle = false; } tt.textContent = p.title; saveSoon(); renderInspectorNow(); };
    inp.onkeydown = e => { if (e.key === 'Enter') { finish(true); } if (e.key === 'Escape') { finish(false); } };
    inp.onblur = () => finish(true);
}

function plotMenu(at: MouseEvent | HTMLElement, p: Plot) {
    showMenu(at, [
        { label: 'Change Chart Type…', strong: true, run: () => { select(p.id); extensions.openTypes(p); } },
        { label: 'Rename…', run: () => { const r = UI?.cards.get(p.id); if (r) { renameInline(p, $('.card-t', r.card)); } } },
        { label: 'Duplicate', run: () => duplicate(p) },
        { label: 'Reset Zoom', run: () => UI?.cards.get(p.id)?.chart?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 }) },
        ...extensions.plotMenu.flatMap(f => f(p)),
        { sep: true },
        { label: 'Delete Plot', run: () => removePlot(p) },
    ]);
}

function duplicate(p: Plot) {
    const c: Plot = { ...clone(p), id: uid(), title: p.title + ' (copy)' };
    S.plots.splice(S.plots.indexOf(p) + 1, 0, c);
    S.sel = c.id;
    changed(true);
}

function removePlot(p: Plot) {
    const i = S.plots.indexOf(p);
    S.plots.splice(i, 1);
    delete S.alerts[p.id];
    if (S.sel === p.id) { S.sel = null; }
    changed(true);
    void ask(`Deleted "${p.title}".`, ['Undo']).then(c => { if (c) { S.plots.splice(i, 0, p); changed(true); } });
}

export function select(id: number | null) {
    if (!UI || S.sel === id) { return; }
    S.sel = id;
    for (const c of $$('.card', UI.stack)) { c.classList.toggle('sel', +c.dataset.id! === id); }
    renderInspectorNow();
}
document.addEventListener('lp-select', e => select((e as CustomEvent<number>).detail));
document.addEventListener('lp-structure', () => changed(true));
document.addEventListener('lp-dirty', () => { dirty = true; });
document.addEventListener('lp-columns', () => { renderColumns(); renderInspectorNow(); });
document.addEventListener('lp-toolbar', () => renderToolbar());
document.addEventListener('lp-banner', () => renderBanner());
document.addEventListener('lp-live', () => updateLive());
document.addEventListener('lp-redraw', e => { const r = UI?.cards.get((e as CustomEvent<number>).detail); if (r) { renderChart(r, true); } });
document.addEventListener('lp-retitle', e => { const p = S.plots.find(x => x.id === (e as CustomEvent<number>).detail); if (p?.autoTitle) { p.title = autoTitle(p); } });
document.addEventListener('lp-alert', e => {
    const id = (e as CustomEvent<number>).detail, ref = UI?.cards.get(id);
    ref?.card.classList.toggle('alert', !!S.alerts[id]);
    updateLive();
});

/** Re-render after a change. Structural changes rebuild the toolbar, grid and inspector. */
export function changed(structural: boolean) {
    saveSoon();
    if (!UI) { return; }
    if (structural) { renderToolbar(); renderBanner(); renderGrid(); renderInspectorNow(); } else { const ref = UI.cards.get(S.sel ?? -1); if (ref) { renderChart(ref); } }
}

const hooks: InspectorHooks = {
    changed,
    soft: p => { saveSoon(); const ref = UI?.cards.get(p.id); if (ref) { renderChart(ref); } },
    select,
    remove: removePlot,
    duplicate,
    retitle: p => { const ref = UI?.cards.get(p.id); if (ref) { $('.card-t', ref.card).textContent = p.title; } saveSoon(); },
    openTypes: p => extensions.openTypes(p),
    wireDrop,
    afterAdd: (p, slot, col) => { if (p.autoTitle) { p.title = autoTitle(p); } for (const f of afterAdd) { f(p, slot, col); } },
    notify: m => notify(m),
};
export function renderInspectorNow() { if (UI) { renderInspector(UI.insp, hooks); } }

export function forceRebuild() { if (UI) { for (const r of UI.cards.values()) { r.sigBase = undefined; renderChart(r, true); } } }
setGlListener(forceRebuild);
setWorldListener(forceRebuild);
new MutationObserver(() => { forceRebuild(); updateColumnValues(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

/* ---------- redraw loop ---------- */
// New data marks every card for a redraw; each frame redraws queued cards until its time budget is spent,
// so many plots update in turns instead of freezing the view. Cards far off screen aren't queued.
// After a full round the loop rests for twice the time the round took (ECharts paints on its next frame,
// outside what is measured here), so drawing stays well under the whole CPU however many plots there are;
// light views still update at 10 Hz.
const BUDGET_MS = 40;
const queue = new Set<CardRef>();
let lastColumns = 0, timer = 0, visible = true, roundWork = 0;
function schedule(ms = 0) { if (!timer) { timer = window.setTimeout(() => { timer = 0; requestAnimationFrame(frame); }, ms); } }
function frame() {
    if (!UI || document.hidden || !visible) { return; }
    if (dirty) {
        dirty = false;
        for (const r of UI.cards.values()) { if (r.near) { queue.add(r); } }
        if (Date.now() - lastColumns > 600) { lastColumns = Date.now(); updateColumnValues(); }
        updateLive();
    }
    const t0 = performance.now();
    for (const r of queue) {
        queue.delete(r);
        renderChart(r);
        if (performance.now() - t0 > BUDGET_MS) { break; }
    }
    roundWork += performance.now() - t0;
    if (queue.size) { schedule(16); return; }
    schedule(Math.min(1500, Math.max(100, roundWork * 2)));
    roundWork = 0;
}
schedule();
function wake() { dirty = true; schedule(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { wake(); } });
document.addEventListener('lp-visible', e => { visible = (e as CustomEvent<boolean>).detail; if (visible) { wake(); } });

send({ type: 'ready' });
