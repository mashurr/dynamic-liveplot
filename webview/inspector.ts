// The side panel for the selected plot: chart type, columns in each slot, series style and options.

import { TYPES, glyph, type Slot } from './charts/registry';
import { colInfo, cols, dn, kindOf, S, slotAccepts, type Plot } from './state';
import { $, $$, esc, ic, pal } from './util';

export interface InspectorHooks {
    changed(structural: boolean): void;
    soft(p: Plot): void;
    select(id: number | null): void;
    remove(p: Plot): void;
    duplicate(p: Plot): void;
    retitle(p: Plot): void;
    openTypes(p: Plot): void;
    wireDrop(node: HTMLElement, onDrop: (col: string) => void): void;
    afterAdd(p: Plot, slot: string, col: string): void;
    notify(msg: string): void;
}

const KIND_GLYPH: Record<string, string> = { num: '∿', time: '◷', text: 'Aa', array: '▥' };
const KIND_NAME: Record<string, string> = { num: 'number', time: 'time', text: 'text', array: 'spectrum' };
export { KIND_GLYPH, KIND_NAME };

/** Extra sections (options, limits) added by other modules. */
export const sections: ((p: Plot, box: HTMLElement, h: InspectorHooks) => string)[] = [];
export const wirings: ((p: Plot, box: HTMLElement, h: InspectorHooks) => void)[] = [];

export function renderInspector(box: HTMLElement, h: InspectorHooks) {
    const p = S.plots.find(x => x.id === S.sel);
    if (!p) { box.hidden = true; return; }
    box.hidden = false;
    const T = TYPES[p.type], all = cols();
    const slotHtml = (s: Slot) => {
        const have = p.slots[s.id] ?? [];
        const need = (s.req && !have.length) || (s.min !== undefined && have.length < s.min);
        const cands = all.filter(c => s.kinds.includes(c.kind) && !have.includes(c.name));
        const chips = have.map(c => { const ok = !!colInfo(c); return `<span class="schip ${ok ? '' : 'missing'}" title="${ok ? '' : 'Not in this file'}"><span class="kd">${ok ? KIND_GLYPH[kindOf(c)!] : '!'}</span><span class="nm">${esc(dn(c))}</span><button data-rm="${esc(c)}" aria-label="Remove ${esc(dn(c))}">${ic('close', 'tiny')}</button></span>`; }).join('');
        const add = have.length < s.max && cands.length ? `<select data-add="${s.id}" aria-label="Add a column to ${esc(s.label)}"><option value="">${have.length ? '+ add' : 'Choose…'}</option>${cands.map(c => `<option value="${esc(c.name)}">${esc(dn(c.name))}</option>`).join('')}</select>` : '';
        const right = need ? `<span class="req">${s.min ? `needs ${s.min}+` : 'needed'}</span>` : `<span class="ok">${esc(s.hint && !have.length ? s.hint : s.kinds.map(k => KIND_NAME[k]).join(' / '))}</span>`;
        return `<div class="slot"><div class="slot-h"><span>${esc(s.label)}</span>${right}</div><div class="well ${need ? 'need' : ''}" data-slot="${s.id}">${chips}${add || (have.length ? '' : `<span class="ph">No ${s.kinds.map(k => KIND_NAME[k]).join(' or ')} columns in this file</span>`)}</div></div>`;
    };
    const ys = (p.slots.y ?? []).filter(c => colInfo(c));
    const styles = T.cart && ys.length ? `<div class="slot"><div class="slot-h"><span>Series</span><span class="ok">colour · name</span></div>${ys.map((c, i) => `<div class="sopt" data-c="${esc(c)}" style="grid-template-columns:22px minmax(0,1fr)"><input type="color" value="${p.series[c]?.color || pal(i)}" aria-label="Colour of ${esc(dn(c))}"><input class="inp" data-f="name" value="${esc(p.series[c]?.name ?? '')}" placeholder="${esc(dn(c))}" aria-label="Name shown for ${esc(dn(c))}"></div>`).join('')}</div>` : '';
    box.innerHTML = `
      <div class="sec">
        <h4>PLOT <button class="ibtn" data-x title="Close" aria-label="Close">${ic('close', 'tiny')}</button></h4>
        <button class="type-btn" data-type title="Change chart type">${glyph(p.type)}<span><b>${esc(T.label)}</b><small>${esc(T.desc)}</small></span>${ic('chevD', 'tiny')}</button>
        <label class="fld"><span>Title</span><input class="inp" data-title value="${esc(p.title)}"></label>
      </div>
      ${T.slots.length ? `<div class="sec"><h4>COLUMNS</h4>${T.slots.map(slotHtml).join('')}${styles}</div>` : ''}
      ${sections.map(f => f(p, box, h)).join('')}
      <div class="foot"><button class="vbtn sec" data-dup>Duplicate</button><button class="vbtn sec" data-del>Delete plot</button></div>`;
    $('[data-x]', box).onclick = () => h.select(null);
    $('[data-type]', box).onclick = () => h.openTypes(p);
    ($('[data-title]', box) as HTMLInputElement).oninput = e => { p.title = (e.target as HTMLInputElement).value; p.autoTitle = false; h.retitle(p); };
    for (const b of $$('[data-rm]', box)) { b.onclick = () => { const c = b.dataset.rm!; for (const k of Object.keys(p.slots)) { p.slots[k] = (p.slots[k] ?? []).filter(x => x !== c); } h.changed(true); }; }
    for (const s of $$<HTMLSelectElement>('[data-add]', box)) {
        s.onchange = () => {
            if (!s.value) { return; }
            for (const k of Object.keys(p.slots)) { p.slots[k] = (p.slots[k] ?? []).filter(x => x !== s.value); }
            (p.slots[s.dataset.add!] ??= []).push(s.value);
            h.afterAdd(p, s.dataset.add!, s.value);
            h.changed(true);
        };
    }
    for (const w of $$('.well', box)) {
        h.wireDrop(w, col => {
            const s = T.slots.find(x => x.id === w.dataset.slot)!;
            if (!slotAccepts(s, col)) { h.notify(`${s.label} takes a ${s.kinds.map(k => KIND_NAME[k]).join(' or ')} column.`); return; }
            for (const k of Object.keys(p.slots)) { p.slots[k] = (p.slots[k] ?? []).filter(x => x !== col); }
            const arr = (p.slots[s.id] ??= []);
            if (arr.length >= s.max) { arr.pop(); }
            arr.push(col);
            h.afterAdd(p, s.id, col);
            h.changed(true);
        });
    }
    for (const row of $$('.sopt[data-c]', box)) {
        const c = row.dataset.c!, st = () => (p.series[c] ??= {});
        const color = row.querySelector<HTMLInputElement>('input[type=color]');
        if (color) { color.oninput = () => { st().color = color.value; h.soft(p); }; }
        const name = row.querySelector<HTMLInputElement>('[data-f=name]');
        if (name) { name.onchange = () => { st().name = name.value.trim() || undefined; h.soft(p); }; }
    }
    for (const f of wirings) { f(p, box, h); }
    $('[data-dup]', box).onclick = () => h.duplicate(p);
    $('[data-del]', box).onclick = () => h.remove(p);
}
