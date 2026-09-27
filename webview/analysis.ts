// Limits and alerts, calculated columns, comparing with another run, and measurement cursors.

import type * as echarts from 'echarts';
import type { HostToView } from '../src/view/protocol';
import { compile, FUNCTION_NAMES } from './calc';
import { TYPES } from './charts/registry';
import { chartCreated, decorate, extensions } from './hooks';
import { notify } from './host';
import { sections, wirings } from './inspector';
import { cols, colInfo, dn, S, saveSoon, send, type Plot } from './state';
import { Table } from './table';
import { $, $$, el, esc, fmt, ic } from './util';

const event = (name: string, detail?: unknown) => document.dispatchEvent(new CustomEvent(name, { detail }));

/* ---------- limits ---------- */
const LIMIT_TYPES = new Set(['gauge', 'kpi', 'candlestick', 'spectrum']);
sections.push(p => {
    const T = TYPES[p.type];
    if (!T.cart && !LIMIT_TYPES.has(p.type)) { return ''; }
    const limits = p.options.limits ?? [];
    return `<div class="sec"><h4>LIMITS <span class="count">${limits.length || ''}</span></h4>
      ${limits.map((L, i) => `<div class="limit" data-li="${i}"><input class="inp" type="number" step="any" data-f="v" value="${L.value}" aria-label="Limit value"><select class="selc" data-f="d" aria-label="When to alert"><option value="above" ${L.alert === 'above' ? 'selected' : ''}>Alert above</option><option value="below" ${L.alert === 'below' ? 'selected' : ''}>Alert below</option></select><button class="ibtn" data-f="rm" aria-label="Remove limit">${ic('close', 'tiny')}</button></div>`).join('')}
      <button class="lnk" data-limit-add style="justify-self:start">+ Add limit</button>
      <small style="color:var(--faint);font-size:11px">Draws a dashed line and notifies you when the latest value crosses it.</small></div>`;
});
wirings.push((p, box, h) => {
    for (const row of $$('[data-li]', box)) {
        const L = p.options.limits![+row.dataset.li!];
        row.querySelector<HTMLInputElement>('[data-f=v]')!.onchange = e => { L.value = +(e.target as HTMLInputElement).value; h.soft(p); };
        row.querySelector<HTMLSelectElement>('[data-f=d]')!.onchange = e => { L.alert = (e.target as HTMLSelectElement).value as 'above' | 'below'; h.soft(p); };
        row.querySelector<HTMLButtonElement>('[data-f=rm]')!.onclick = () => { p.options.limits!.splice(p.options.limits!.indexOf(L), 1); h.changed(true); };
    }
    const add = box.querySelector<HTMLButtonElement>('[data-limit-add]');
    if (add) {
        add.onclick = () => {
            const col = (p.slots.y ?? p.slots.spec ?? p.slots.close ?? [])[0];
            const vals = col && colInfo(col) ? Array.from(S.table.numbers(col, 0, S.table.length)).filter(Number.isFinite) : [];
            const max = vals.length ? vals.reduce((m, v) => Math.max(m, v), -Infinity) : 0;
            (p.options.limits ??= []).push({ value: Number(fmt(max)) || 0, alert: 'above' });
            h.changed(true);
        };
    }
});

/* ---------- calculated columns ---------- */
function applyPendingCalcs() {
    if (!S.table.columns.length || !S.pendingCalc.length) { return; }
    const failed: string[] = [];
    for (const c of S.pendingCalc) {
        try { S.table.setCalc(c.name, c.formula, compile(c.formula, n => !!S.table.col(n) && n !== c.name)); } catch (e) { failed.push(`${c.name}: ${(e as Error).message}`); }
    }
    S.pendingCalc = [];
    if (failed.length) { notify(`Some calculated columns couldn't be set up. ${failed.join(' ')}`, 'warning'); }
    event('lp-columns');
    event('lp-dirty');
}
document.addEventListener('lp-schema', () => {
    // Calculated columns survive a new file; re-queue them so they recompute against its columns
    const existing = S.table.columns.filter(c => c.calc).map(c => ({ name: c.name, formula: c.calc!.formula }));
    for (const c of existing) { if (!S.pendingCalc.some(x => x.name === c.name)) { S.pendingCalc.push(c); } S.table.removeCalc(c.name); }
    applyPendingCalcs();
});
document.addEventListener('lp-calc-edit', e => openCalc((e as CustomEvent<string | null>).detail));

function openCalc(editing: string | null) {
    document.querySelector('.modal-back')?.remove();
    const existing = editing ? S.table.col(editing)?.calc : undefined;
    const names = cols().filter(c => c.kind === 'num' && c.name !== editing).map(c => c.name);
    const back = el(`<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-label="Calculated column">
      <h3>${editing ? 'Edit calculated column' : 'New calculated column'}</h3>
      <label class="fld"><span>Name</span><input class="inp" data-name value="${esc(editing ?? '')}" placeholder="power_mW"></label>
      <label class="fld"><span>Formula</span><textarea class="code-edit" data-formula style="min-height:70px" spellcheck="false" placeholder="idd_mA * vdd_V">${esc(existing?.formula ?? '')}</textarea></label>
      <p>Use column names, numbers, + − × ÷ ^ and functions like ${FUNCTION_NAMES.slice(0, 8).join(', ')}. Put names with spaces or symbols in [brackets]. Click a column to add it:</p>
      <div class="preview" data-cols>${names.map(n => `<button class="lnk" data-ins="${esc(n)}">${esc(dn(n))}</button>`).join(' ')}</div>
      <p data-result></p>
      <div class="btns">${editing ? '<button class="vbtn sec" data-del>Delete</button><span style="flex:1"></span>' : ''}<button class="vbtn sec" data-cancel>Cancel</button><button class="vbtn" data-ok>${editing ? 'Save' : 'Add column'}</button></div></div></div>`);
    document.querySelector('.lp')!.appendChild(back);
    const nameIn = $('[data-name]', back) as HTMLInputElement, formula = $('[data-formula]', back) as HTMLTextAreaElement, result = $('[data-result]', back);
    const check = () => {
        const name = nameIn.value.trim();
        try {
            if (!name) { throw new Error('Give the column a name.'); }
            if (name !== editing && S.table.col(name)) { throw new Error(`There's already a column called "${name}".`); }
            const c = compile(formula.value, n => !!S.table.col(n) && n !== name);
            const t = S.table, last = t.length - 1, get = (n: string) => t.numbers(n, last, last + 1)[0];
            result.textContent = last >= 0 ? `Latest value: ${fmt(c.run(get))}` : 'Looks good.';
            result.style.color = '';
            return c;
        } catch (err) {
            result.textContent = (err as Error).message;
            result.style.color = 'var(--err)';
            return null;
        }
    };
    formula.oninput = check; nameIn.oninput = check;
    for (const b of $$('[data-ins]', back)) {
        b.onclick = () => {
            const n = b.dataset.ins!, token = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) ? n : `[${n}]`;
            const at = formula.selectionStart ?? formula.value.length;
            formula.value = formula.value.slice(0, at) + token + formula.value.slice(formula.selectionEnd ?? at);
            formula.focus();
            check();
        };
    }
    $('[data-cancel]', back).onclick = () => back.remove();
    back.addEventListener('mousedown', e => { if (e.target === back) { back.remove(); } });
    back.addEventListener('keydown', e => { if (e.key === 'Escape') { back.remove(); } });
    const del = back.querySelector<HTMLButtonElement>('[data-del]');
    if (del && editing) { del.onclick = () => { S.table.removeCalc(editing); back.remove(); saveSoon(); event('lp-columns'); event('lp-structure'); }; }
    $('[data-ok]', back).onclick = () => {
        const c = check();
        if (!c) { return; }
        const name = nameIn.value.trim();
        if (editing && editing !== name) {
            S.table.removeCalc(editing);
            for (const p of S.plots) { for (const k of Object.keys(p.slots)) { p.slots[k] = (p.slots[k] ?? []).map(x => (x === editing ? name : x)); } }
        }
        S.table.setCalc(name, formula.value.trim(), c);
        back.remove();
        saveSoon();
        event('lp-columns');
        event('lp-structure');
    };
    setTimeout(() => (editing ? formula : nameIn).focus(), 0);
    if (existing) { check(); }
}

/* ---------- compare with another run ---------- */
document.addEventListener('lp-compare', e => {
    const m = (e as CustomEvent<HostToView & { type: 'compare' }>).detail;
    if (!m.file) { S.cmp = null; S.cmpFile = null; S.compareMode = null; event('lp-toolbar'); event('lp-structure'); return; }
    if (!m.data) { S.cmp = new Table(); S.cmpFile = m.file; event('lp-toolbar'); return; }
    const d = m.data;
    if (!S.cmp) { return; }
    if (d.type === 'schema') { S.cmp.applySchema(d.file, d.format, d.columns); }
    else if (d.type === 'rows') { S.cmp.applyRows(d.first, d.count, d.dropped, d.columns); event('lp-dirty'); }
    else if (d.type === 'error') { notify(`The comparison file couldn't be read: ${d.message}`, 'warning'); }
});
document.addEventListener('lp-schema', e => {
    // A new run in a watched folder: compare with the run before it again
    const reason = (e as CustomEvent<string>).detail;
    if (S.compareMode === 'previous' && (reason === 'switched' || reason === 'opened' || reason === 'layout')) { setTimeout(() => send({ type: 'compare', target: 'previous' }), 300); }
});
const base = (f: string) => f.split(/[\\/]/).pop() ?? f;
extensions.toolbarRight.push(() => `<button class="tbtn ${S.cmpFile ? 'on' : ''}" data-compare title="Overlay another run, dashed">${ic('sync')}<span>${S.cmpFile ? `vs ${esc(base(S.cmpFile))}` : 'Compare'}</span></button>`);
extensions.wireToolbar.push(tool => {
    const b = tool.querySelector<HTMLElement>('[data-compare]');
    if (!b) { return; }
    b.onclick = () => {
        import('./menus').then(({ showMenu }) => showMenu(b, [
            { note: 'Overlay another file with the same columns as dashed lines, lined up from the start of each run.' },
            { sep: true },
            { label: 'Previous Run in This Folder', strong: S.compareMode === 'previous', run: () => { S.compareMode = 'previous'; saveSoon(); send({ type: 'compare', target: 'previous' }); } },
            { label: 'Pick a File…', run: () => { S.compareMode = 'pick'; send({ type: 'compare', target: 'pick' }); } },
            { label: 'Stop Comparing', disabled: !S.cmpFile, run: () => { S.compareMode = null; saveSoon(); send({ type: 'compare', target: null }); } },
        ]));
    };
});

/* ---------- measurement cursors ---------- */
const measuring = new Map<number, { a?: number; b?: number }>();
const canMeasure = (p: Plot) => !!TYPES[p.type].cart;
extensions.plotMenu.push(p => canMeasure(p) ? [{ label: measuring.has(p.id) ? 'Stop Measuring' : 'Measure Between Two Points', run: () => { if (measuring.has(p.id)) { measuring.delete(p.id); } else { measuring.set(p.id, {}); notify('Click two points on the plot to measure between them.'); } event('lp-redraw', p.id); } }] : []);
extensions.commands.measure = () => { const p = S.plots.find(x => x.id === S.sel); if (p && canMeasure(p)) { measuring.set(p.id, {}); event('lp-redraw', p.id); } };

chartCreated.push((p, ref) => {
    ref.chart.getZr().on('click', (e: { offsetX: number; offsetY: number }) => {
        const m = measuring.get(p.id);
        if (!m) { return; }
        const v = ref.chart.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]) as number[] | undefined;
        if (!v || !Number.isFinite(v[0])) { return; }
        if (m.a === undefined || m.b !== undefined) { m.a = v[0]; m.b = undefined; } else { m.b = v[0]; }
        event('lp-redraw', p.id);
    });
});

decorate.push((p, option, ref) => {
    ref.card.querySelector('.measure')?.remove();
    const m = measuring.get(p.id);
    if (!m) { return; }
    const series = (option.series ?? []) as { id?: string; name?: string; data?: unknown[]; itemStyle?: { color?: string } }[];
    const marks = [m.a, m.b].filter((x): x is number => x !== undefined).map((x, i) => ({ xAxis: x, label: { formatter: i ? 'B' : 'A', color: 'inherit' } }));
    series.push({ type: 'line', id: '__measure', data: [], markLine: { symbol: 'none', silent: true, animation: false, lineStyle: { type: 'solid', width: 1.5 }, data: marks } } as never);
    const timeX = (option.xAxis as { type?: string } | undefined)?.type === 'time';
    const fx = (x: number) => (timeX ? new Date(x).toLocaleTimeString('en-GB', { hour12: false }) : fmt(x));
    const dx = m.a !== undefined && m.b !== undefined ? m.b - m.a : null;
    const dxText = dx === null ? '' : timeX ? `${fmt(dx / 1000)} s` : fmt(dx);
    const near = (data: unknown[], x: number) => {
        let best: number | null = null, bd = Infinity;
        for (const d of data) { const pt = d as (number | null)[]; if (!Array.isArray(pt) || pt[0] === null || pt[1] === null) { continue; } const dd = Math.abs((pt[0] as number) - x); if (dd < bd) { bd = dd; best = pt[1] as number; } }
        return best;
    };
    const rows = dx === null ? '' : series.filter(s => s.id !== '__measure' && Array.isArray(s.data) && s.data.length && Array.isArray(s.data[0])).slice(0, 4).map(s => {
        const ya = near(s.data!, m.a!), yb = near(s.data!, m.b!);
        const dy = ya !== null && yb !== null ? yb - ya : null;
        return `<div><i style="background:${s.itemStyle?.color ?? 'currentColor'}"></i>${esc(s.name ?? '')}: Δ ${fmt(dy)}${dy !== null && dx ? ` · slope ${fmt(dy / (timeX ? dx / 1000 : dx))}${timeX ? '/s' : ''}` : ''}</div>`;
    }).join('');
    const box = el(`<div class="measure" role="status"><b>${m.a === undefined ? 'Click a point for A' : m.b === undefined ? `A ${fx(m.a)} · click a point for B` : `A ${fx(m.a)} → B ${fx(m.b)} · ΔX ${dxText}`}</b>${rows}<button class="lnk" data-stop>Done</button></div>`);
    $('[data-stop]', box).onclick = () => { measuring.delete(p.id); event('lp-redraw', p.id); };
    ref.card.querySelector('.card-b')?.appendChild(box);
});

export type { echarts };
