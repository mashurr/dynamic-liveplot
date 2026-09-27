// Context menus and the grid-size picker, drawn inside the view.

import { $, $$, el, esc } from './util';

export interface MenuItem { label?: string; run?: () => void; disabled?: boolean; strong?: boolean; hint?: string; sep?: boolean; note?: string; html?: string }

let menu: HTMLElement | null = null;
export function closeMenu() { menu?.remove(); menu = null; }
document.addEventListener('mousedown', e => { if (menu && !menu.contains(e.target as Node)) { closeMenu(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); } });
window.addEventListener('blur', closeMenu);

export function showMenu(at: MouseEvent | HTMLElement, items: MenuItem[]): HTMLElement {
    closeMenu();
    const m = el(`<div class="ctx" role="menu">${items.map((it, i) => it.sep ? '<hr>' : it.note ? `<div class="note">${esc(it.note)}</div>` : it.html ? it.html : `<div class="mi ${it.disabled ? 'dis' : ''} ${it.strong ? 'strong' : ''}" data-i="${i}" role="menuitem" tabindex="-1">${esc(it.label)}${it.hint ? `<span class="h">${esc(it.hint)}</span>` : ''}</div>`).join('')}</div>`);
    document.body.appendChild(m);
    menu = m;
    let x: number, y: number;
    if (at instanceof HTMLElement) { const b = at.getBoundingClientRect(); x = b.left; y = b.bottom + 2; } else { x = at.clientX; y = at.clientY; }
    x = Math.max(4, Math.min(x, window.innerWidth - m.offsetWidth - 6));
    y = Math.max(4, Math.min(y, window.innerHeight - m.offsetHeight - 6));
    m.style.left = x + 'px'; m.style.top = y + 'px';
    const entries = $$('.mi:not(.dis)', m);
    for (const n of entries) { n.onclick = () => { const it = items[+n.dataset.i!]; closeMenu(); it.run?.(); }; }
    m.onkeydown = e => {
        const i = entries.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown') { entries[(i + 1) % entries.length]?.focus(); e.preventDefault(); }
        if (e.key === 'ArrowUp') { entries[(i - 1 + entries.length) % entries.length]?.focus(); e.preventDefault(); }
        if (e.key === 'Enter' && i >= 0) { entries[i].click(); e.preventDefault(); }
    };
    entries[0]?.focus();
    return m;
}

export function gridPicker(anchor: HTMLElement, cur: { columns: number; rows: number }, apply: (columns: number, rows: number) => void) {
    const m = showMenu(anchor, [{ html: `<div class="gridpick-l">${cur.columns} × ${cur.rows}</div><div class="gridpick">${Array.from({ length: 36 }, (_, i) => `<span data-c="${i % 6 + 1}" data-r="${Math.floor(i / 6) + 1}" role="button" aria-label="${i % 6 + 1} by ${Math.floor(i / 6) + 1}"></span>`).join('')}</div>` }]);
    const cells = $$('.gridpick span', m), label = $('.gridpick-l', m);
    const hl = (c: number, r: number) => { for (const s of cells) { s.classList.toggle('hl', +s.dataset.c! <= c && +s.dataset.r! <= r); } label.textContent = `${c} × ${r}`; };
    hl(cur.columns, cur.rows);
    for (const s of cells) {
        s.onmouseenter = () => hl(+s.dataset.c!, +s.dataset.r!);
        s.onclick = () => { closeMenu(); apply(+s.dataset.c!, +s.dataset.r!); };
    }
}
