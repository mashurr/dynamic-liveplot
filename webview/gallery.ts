// The chart type gallery: every type grouped, searchable, with suggestions for the plot's columns.

import { recommend } from './charts/recommend';
import { GROUPS, TYPES, TYPE_LIST, glyph, type ChartType } from './charts/registry';
import { customDefault } from './charts/other';
import { extensions } from './hooks';
import { notify } from './host';
import { KIND_NAME } from './inspector';
import { sections, wirings } from './inspector';
import { autoAssign, cols, colInfo, dn, missingSlots, plotCols, remapSlots, type Plot } from './state';
import { $, $$, clone, el, esc, ic } from './util';

function fits(T: ChartType): { ok: boolean; why?: string } {
    if (T.later) { return { ok: false, why: T.later }; }
    const have = new Set(cols().map(c => c.kind));
    for (const s of T.slots) { if (s.req && !s.kinds.some(k => have.has(k))) { return { ok: false, why: `Needs a ${s.kinds.map(k => KIND_NAME[k]).join(' or ')} column` }; } }
    const nums = cols().filter(c => c.kind === 'num').length;
    for (const s of T.slots) { if (s.min && s.kinds.includes('num') && nums < s.min) { return { ok: false, why: `Needs ${s.min} or more number columns` }; } }
    return { ok: true };
}

export function openGallery(p: Plot) {
    document.querySelector('.gal-back')?.remove();
    const cur = plotCols(p).filter(c => colInfo(c)), recs = cur.length ? recommend(cur).slice(0, 6) : [];
    const back = el(`<div class="gal-back"><div class="gal" role="dialog" aria-modal="true" aria-label="Choose a chart type">
      <div class="gal-top"><h3>Chart type</h3><div class="search">${ic('search', 'tiny')}<input type="search" placeholder="Search ${TYPE_LIST.length} chart types" aria-label="Search chart types"></div><span class="for">${cur.length ? 'Your columns: ' + esc(cur.map(dn).join(', ')) : 'Pick a type, then fill its slots'}</span><button class="ibtn" data-x aria-label="Close">${ic('close', 'tiny')}</button></div>
      <div class="gal-body"><nav class="gal-nav" aria-label="Groups"></nav><div class="gal-main"></div></div></div></div>`);
    document.querySelector('.lp')!.appendChild(back);
    const main = $('.gal-main', back), nav = $('.gal-nav', back), q = $('input', back) as HTMLInputElement;
    const card = (T: ChartType) => {
        const f = fits(T), rec = recs.includes(T.id);
        const ready = f.ok && cur.length > 0 && (() => { const t = clone(p); t.type = T.id; t.slots = {}; cur.forEach(c => autoAssign(t, c)); return !missingSlots(t).length; })();
        return `<button class="gcard ${T.id === p.type ? 'cur' : ''} ${!f.ok ? 'dim' : ''}" data-t="${T.id}" title="${esc(f.why ?? T.desc)}">${rec ? '<span class="rec">Suggested</span>' : ready ? '<span class="fit">✓ ready</span>' : ''}${glyph(T.id)}<b>${esc(T.label)}</b><small>${esc(f.ok ? T.desc : f.why!)}</small></button>`;
    };
    const draw = () => {
        const s = q.value.trim().toLowerCase(), match = (T: ChartType) => !s || `${T.label} ${T.desc} ${T.group}`.toLowerCase().includes(s);
        let h = '';
        if (!s && recs.length) { h += `<h5 id="g-rec">Suggested for your columns</h5><div class="gal-cards">${recs.map(id => card(TYPES[id])).join('')}</div>`; }
        for (const g of GROUPS) { const ts = TYPE_LIST.filter(T => T.group === g && match(T)); if (ts.length) { h += `<h5 id="g-${g.replace(/\W+/g, '')}">${esc(g)}</h5><div class="gal-cards">${ts.map(card).join('')}</div>`; } }
        main.innerHTML = h || '<p class="note">No chart type matches.</p>';
        for (const b of $$('.gcard', main)) {
            b.onclick = () => {
                const T = TYPES[b.dataset.t!];
                const dropped = remapSlots(p, T.id);
                if (T.custom && !p.options.custom) { p.options.custom = customDefault(); }
                back.remove();
                document.dispatchEvent(new CustomEvent('lp-retitle', { detail: p.id }));
                document.dispatchEvent(new CustomEvent('lp-structure'));
                if (dropped.length) { notify(`${T.label} has no slot for ${dropped.map(dn).join(', ')}, so ${dropped.length > 1 ? 'they were' : 'it was'} removed.`); }
            };
        }
    };
    nav.innerHTML = (recs.length ? `<button data-g="g-rec">Suggested <span>${recs.length}</span></button>` : '') + GROUPS.map(g => `<button data-g="g-${g.replace(/\W+/g, '')}">${esc(g)} <span>${TYPE_LIST.filter(T => T.group === g).length}</span></button>`).join('');
    for (const b of $$('button', nav)) { b.onclick = () => { q.value = ''; draw(); const t = main.querySelector<HTMLElement>('#' + b.dataset.g); if (t) { main.scrollTop = t.offsetTop - 8; } }; }
    q.oninput = draw;
    const close = () => back.remove();
    $('[data-x]', back).onclick = close;
    back.addEventListener('mousedown', e => { if (e.target === back) { close(); } });
    back.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); } });
    draw();
    setTimeout(() => q.focus(), 0);
}

extensions.openTypes = (p: Plot) => { document.dispatchEvent(new CustomEvent('lp-select', { detail: p.id })); openGallery(p); };

// Custom option editor and pie slices
sections.push(p => {
    const T = TYPES[p.type];
    const rows: string[] = [];
    if (['pie', 'donut', 'rose', 'funnel'].includes(p.type)) { rows.push(`<label class="fld"><span>Slices before "Other"</span><select class="selc" data-o="slices">${[4, 6, 8, 12, 20].map(n => `<option ${(p.options.slices ?? 8) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`); }
    if (T.custom) { rows.push(`<label class="fld"><span>ECharts option (JSON)</span><textarea class="code-edit" data-custom spellcheck="false">${esc(p.options.custom || customDefault())}</textarea><small>Every column comes in as <code>dataset.source</code>, so refer to columns by name in <code>encode</code>. Applies as you type.</small></label>`); }
    return rows.length ? `<div class="sec"><h4>${T.custom ? 'OPTION' : 'SLICES'}</h4>${rows.join('')}</div>` : '';
});
wirings.push((p, box, h) => {
    const t = box.querySelector<HTMLTextAreaElement>('[data-custom]');
    if (t) { t.oninput = () => { p.options.custom = t.value; h.soft(p); }; }
});
