// Chart options in the side panel, linked zoom, and choosing sensible axes as columns are added.

import { autoLog, autoPlot } from './autoplot';
import { recommend } from './charts/recommend';
import { TYPES } from './charts/registry';
import { afterAdd, extensions } from './hooks';
import { sections, wirings } from './inspector';
import { colInfo, dn, S, saveSoon, type Plot } from './state';
import { $, $$, esc, ic, AGGS } from './util';

extensions.recommend = recommend;
extensions.autoPlot = autoPlot;

// Series axis and smoothing, log scales, statistics marks, summaries, bins and the rows shown
sections.push(p => {
    const T = TYPES[p.type], o = p.options, rows: string[] = [];
    const ys = (p.slots.y ?? []).filter(c => colInfo(c));
    if (T.cart && ys.length) {
        rows.push(`<div class="slot"><div class="slot-h"><span>Axis and smoothing</span></div>${ys.map(c => { const st = p.series[c] ?? {}; return `<div class="sopt" data-c="${esc(c)}" style="grid-template-columns:minmax(0,1fr) 72px 84px"><span class="summary" title="${esc(dn(c))}">${esc(st.name || dn(c))}</span><select class="selc" data-f="axis" aria-label="Axis for ${esc(dn(c))}"><option value="left" ${st.axis !== 'right' ? 'selected' : ''}>Left</option><option value="right" ${st.axis === 'right' ? 'selected' : ''}>Right</option></select><select class="selc" data-f="smooth" aria-label="Smoothing for ${esc(dn(c))}"><option value="0">Raw</option>${[5, 20, 50, 100].map(w => `<option value="${w}" ${st.smooth === w ? 'selected' : ''}>Avg of ${w}</option>`).join('')}</select></div>`; }).join('')}</div>`);
        const right = ys.some(c => p.series[c]?.axis === 'right');
        rows.push(`<div class="inline"><label class="chk"><input type="checkbox" data-o="log" ${o.log ? 'checked' : ''}> Log scale</label>${right ? `<label class="chk"><input type="checkbox" data-o="logRight" ${o.logRight ? 'checked' : ''}> Log right axis</label>` : '<span></span>'}</div>`);
        rows.push(`<label class="chk"><input type="checkbox" data-o="stats" ${o.stats ? 'checked' : ''}> Mark min, max and average</label>`);
    }
    if (T.agg) { rows.push(`<label class="fld"><span>Summarise each category by</span><select class="selc" data-o="summary">${Object.keys(AGGS).map(a => `<option ${(o.summary ?? 'mean') === a ? 'selected' : ''}>${a}</option>`).join('')}</select><small>Used when a value column is set. Without one, rows are counted.</small></label>`); }
    if (T.bins) { rows.push(`<label class="fld"><span>Bins</span><select class="selc" data-o="bins">${[0, 10, 20, 40, 80].map(b => `<option value="${b}" ${(o.bins ?? 0) === b ? 'selected' : ''}>${b || 'Automatic'}</option>`).join('')}</select></label>`); }
    if (!T.custom && !['spectrum', 'spectrogram', 'surface'].includes(p.type)) {
        rows.push(`<div class="inline"><label class="fld"><span>Rows shown</span><select class="selc" data-o="window"><option value="0" ${!o.window ? 'selected' : ''}>All kept</option>${[10000, 1000, 200].map(n => `<option value="${n}" ${o.window === n ? 'selected' : ''}>Last ${n.toLocaleString('en-US')}</option>`).join('')}</select></label><label class="fld"><span>Skip first rows</span><input class="inp" type="number" min="0" step="10" data-o="skip" value="${o.skip ?? 0}"></label></div>`);
    }
    return rows.length ? `<div class="sec"><h4>OPTIONS</h4>${rows.join('')}</div>` : '';
});
wirings.push((p, box, h) => {
    for (const row of $$('.sopt[data-c]', box)) {
        const c = row.dataset.c!, st = () => (p.series[c] ??= {});
        const axis = row.querySelector<HTMLSelectElement>('[data-f=axis]');
        if (axis) { axis.onchange = () => { st().axis = axis.value as 'left' | 'right'; h.changed(true); }; }
        const smooth = row.querySelector<HTMLSelectElement>('[data-f=smooth]');
        if (smooth) { smooth.onchange = () => { st().smooth = +smooth.value || undefined; h.soft(p); }; }
    }
    for (const n of $$<HTMLInputElement>('[data-o]', box)) {
        const key = n.dataset.o as keyof Plot['options'];
        n.onchange = () => {
            const o = p.options as Record<string, unknown>;
            if (n.type === 'checkbox') { o[key] = n.checked || undefined; }
            else if (key === 'summary') { o[key] = n.value; }
            else if (key === 'slices') { o[key] = +n.value; }
            else { o[key] = Math.max(0, +n.value || 0) || undefined; }
            h.soft(p);
        };
    }
});

// Put a column on the right axis when its values are on a very different scale
afterAdd.push((p, slot, col) => {
    if (slot !== 'y' || !TYPES[p.type].cart) { return; }
    const ys = p.slots.y ?? [];
    if (ys.length === 1) { autoLog(p, col); return; }
    const med = (c: string) => { const t = S.table, a = Array.from(t.numbers(c, 0, t.length)).filter(Number.isFinite).map(Math.abs).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
    const first = ys.find(c => (p.series[c]?.axis ?? 'left') === 'left' && c !== col);
    if (!first) { return; }
    const r = med(col) / (med(first) || 1);
    if (r > 20 || r < 0.05) { (p.series[col] ??= {}).axis = 'right'; }
});

// Linked zoom and hover across plots that share an X column
extensions.toolbarRight.push(() => `<button class="tbtn icon ${S.linkZoom ? 'on' : ''}" data-link title="Link zoom and hover across plots that share an X column" aria-label="Link zoom across plots" aria-pressed="${S.linkZoom}">${ic('sync')}</button>`);
extensions.wireToolbar.push(tool => { const b = $('[data-link]', tool); if (b) { b.onclick = () => extensions.commands.linkZoom(); } });
extensions.commands.linkZoom = () => {
    S.linkZoom = !S.linkZoom;
    saveSoon();
    document.dispatchEvent(new CustomEvent('lp-structure'));
};
