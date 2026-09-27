// Groups of plots, the bindings dialog, and saved-layout actions in the Layout menu.

import { TYPES } from './charts/registry';
import { extensions, groupSections } from './hooks';
import { inputBox, run } from './host';
import { sections, wirings } from './inspector';
import { showMenu } from './menus';
import { applyBindings, cols, effectiveBindings, S, saveSoon, uid, type Plot } from './state';
import { $, $$, el, esc, ic, pal } from './util';

const event = (name: string, detail?: unknown) => document.dispatchEvent(new CustomEvent(name, { detail }));

/* ---------- groups ---------- */
const COLOURS = ['blue', 'orange', 'green', 'red', 'pink', 'sky blue', 'yellow', 'grey'];
async function newGroup(p?: Plot) {
    const name = await inputBox('Name the group', `Group ${S.groups.length + 1}`);
    if (!name) { return; }
    const g = { id: 'g' + uid(), name, color: pal(S.groups.length) };
    S.groups.push(g);
    if (p) { p.group = g.id; }
    saveSoon();
    event('lp-structure');
}

groupSections.push((stack, makeCard) => {
    const placed = new Set<number>();
    for (const g of S.groups) {
        const plots = S.plots.filter(p => p.group === g.id);
        const sec = el(`<section class="grp" style="--gc:${g.color}" data-group="${esc(g.id)}">
          <div class="grp-h"><button class="ibtn" data-collapse aria-label="${g.collapsed ? 'Expand' : 'Collapse'} ${esc(g.name)}" aria-expanded="${!g.collapsed}">${ic(g.collapsed ? 'chevR' : 'chevD', 'tiny')}</button><span class="grp-n" title="Double-click to rename">${esc(g.name)}</span><span class="count">${plots.length} plot${plots.length === 1 ? '' : 's'}</span><span class="grow"></span><button class="ibtn" data-gm aria-label="Group menu">${ic('more')}</button></div>
          <div class="lp-grid" ${g.collapsed ? 'hidden' : ''}></div></section>`);
        const grid = $('.lp-grid', sec);
        if (!g.collapsed) { for (const p of plots) { grid.appendChild(makeCard(p)); } }
        for (const p of plots) { placed.add(p.id); }
        $('[data-collapse]', sec).onclick = () => { g.collapsed = !g.collapsed; saveSoon(); event('lp-structure'); };
        const nameEl = $('.grp-n', sec);
        nameEl.ondblclick = async () => { const n = await inputBox('Rename the group', g.name); if (n) { g.name = n; saveSoon(); event('lp-structure'); } };
        $('[data-gm]', sec).onclick = e => showMenu(e.currentTarget as HTMLElement, [
            { label: 'Rename…', run: () => nameEl.ondblclick?.(new MouseEvent('dblclick')) },
            { sep: true },
            ...COLOURS.map((c, i) => ({ label: `Colour: ${c}`, strong: g.color === pal(i), run: () => { g.color = pal(i); saveSoon(); event('lp-structure'); } })),
            { sep: true },
            { label: 'Ungroup', run: () => { for (const p of plots) { p.group = null; } S.groups = S.groups.filter(x => x !== g); saveSoon(); event('lp-structure'); } },
            { label: 'Delete Group and Its Plots', run: () => { S.plots = S.plots.filter(p => p.group !== g.id); S.groups = S.groups.filter(x => x !== g); saveSoon(); event('lp-structure'); } },
        ]);
        stack.appendChild(sec);
    }
    return placed;
});

extensions.plotMenu.push(p => [
    { sep: true },
    ...S.groups.filter(g => g.id !== p.group).map(g => ({ label: `Move to "${g.name}"`, run: () => { p.group = g.id; saveSoon(); event('lp-structure'); } })),
    { label: 'Move to a New Group…', run: () => void newGroup(p) },
    ...(p.group ? [{ label: 'Remove from Group', run: () => { p.group = null; saveSoon(); event('lp-structure'); } }] : []),
]);
sections.push(p => `<div class="sec"><h4>GROUP</h4><select class="selc" data-group-pick aria-label="Group"><option value="">No group</option>${S.groups.map(g => `<option value="${esc(g.id)}" ${p.group === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="__new">New group…</option></select></div>`);
wirings.push((p, box) => {
    const s = box.querySelector<HTMLSelectElement>('[data-group-pick]');
    if (!s) { return; }
    s.onchange = () => { if (s.value === '__new') { void newGroup(p); return; } p.group = s.value || null; saveSoon(); event('lp-structure'); };
});

/* ---------- saved layouts ---------- */
extensions.layoutMenu.push(() => [
    { label: 'Save Layout As…', run: () => run('dynamicLiveplot.saveLayoutAs') },
    { label: 'Save as Folder Layout', run: () => run('dynamicLiveplot.saveFolderLayout') },
    { label: 'Load Layout…', run: () => run('dynamicLiveplot.loadLayout') },
    { sep: true },
]);

/* ---------- bindings ---------- */
extensions.toolbarRight.push(() => { const n = Object.keys(effectiveBindings()).length; return `<button class="tbtn" data-bind title="Bindings: fill {placeholders} in column names">${ic('link')}${n ? `<span class="badge">${n}</span>` : ''}</button>`; });
extensions.wireToolbar.push(tool => { const b = tool.querySelector<HTMLElement>('[data-bind]'); if (b) { b.onclick = openBindings; } });
extensions.commands.editBindings = openBindings;

function openBindings() {
    document.querySelector('.modal-back')?.remove();
    let rows = Object.entries(S.bindings);
    if (!rows.length) { rows = [['', '']]; }
    const fromFile = Object.entries(S.fileBindings);
    const back = el(`<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-label="Bindings">
      <h3>Bindings</h3>
      <p>Fill <code>{placeholders}</code> in column names. With <code>ch → A</code>, the column <code>{ch}_gain_dB</code> shows as <code>A_gain_dB</code>. Layouts keep the raw names, so they keep working across runs.</p>
      ${fromFile.length ? `<p>This file's <code>binding</code> column sets ${fromFile.map(([k, v]) => `<code>${esc(k)} → ${esc(v)}</code>`).join(', ')}. Values here override it.</p>` : ''}
      <div data-rows style="display:grid;gap:6px"></div>
      <div><button class="lnk" data-add>+ Add binding</button></div>
      <div class="preview" data-prev></div>
      <div class="btns"><button class="vbtn sec" data-cancel>Cancel</button><button class="vbtn" data-ok>Apply</button></div></div></div>`);
    document.querySelector('.lp')!.appendChild(back);
    const obj = () => Object.fromEntries(rows.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]));
    const prev = () => {
        const b = { ...S.fileBindings, ...obj() }, hits = cols().filter(c => /\{[^{}]+\}/.test(c.name));
        $('[data-prev]', back).innerHTML = hits.length ? hits.map(c => `${esc(c.name)} → ${esc(applyBindings(c.name, b))}`).join('<br>') : 'No column in this file has a {placeholder}.';
    };
    const draw = () => {
        $('[data-rows]', back).innerHTML = rows.map(([k, v], i) => `<div class="bind-row" data-i="${i}"><input class="inp" data-k value="${esc(k)}" placeholder="key, e.g. ch" aria-label="Key"><span>→</span><input class="inp" data-v value="${esc(v)}" placeholder="value" aria-label="Value"><button class="ibtn" data-rm aria-label="Remove">${ic('close', 'tiny')}</button></div>`).join('');
        for (const r of $$('.bind-row', back)) {
            const i = +r.dataset.i!;
            (r.querySelector('[data-k]') as HTMLInputElement).oninput = e => { rows[i][0] = (e.target as HTMLInputElement).value; prev(); };
            (r.querySelector('[data-v]') as HTMLInputElement).oninput = e => { rows[i][1] = (e.target as HTMLInputElement).value; prev(); };
            (r.querySelector('[data-rm]') as HTMLButtonElement).onclick = () => { rows.splice(i, 1); draw(); };
        }
        prev();
    };
    draw();
    $('[data-add]', back).onclick = () => { rows.push(['', '']); draw(); };
    const close = () => back.remove();
    $('[data-cancel]', back).onclick = close;
    back.addEventListener('mousedown', e => { if (e.target === back) { close(); } });
    back.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); } });
    $('[data-ok]', back).onclick = () => { S.bindings = obj(); close(); saveSoon(); event('lp-columns'); event('lp-structure'); };
}

export { TYPES };
