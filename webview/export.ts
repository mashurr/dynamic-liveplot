// Export: one plot or the whole grid as an image, a self-contained HTML report, and the plotted data as CSV.
// Everything is made in the webview and handed to the host, which asks where to save it.

import * as echarts from 'echarts';
import { TYPES } from './charts/registry';
import { alpha, theme } from './charts/ctx';
import { extensions } from './hooks';
import { notify } from './host';
import { disposeChart, renderChart, type CardRef } from './render';
import { colInfo, dn, plotCols, rowRange, rowStep, S, send, type Plot } from './state';
import { esc, fmt, fmtInt, ic } from './util';

const chartOf = (p: Plot) => {
    const host = document.querySelector<HTMLElement>(`.card[data-id="${p.id}"] .chart-host`);
    return host ? echarts.getInstanceByDom(host) ?? null : null;
};
const cardOf = (p: Plot) => document.querySelector<HTMLElement>(`.card[data-id="${p.id}"]`);

/** Plots far off screen have no chart; draw them for the export, then let them go again. */
function withAllDrawn<T>(plots: Plot[], fn: () => T): T {
    const refs = plots.map(p => (cardOf(p) as (HTMLElement & { _ref?: CardRef }) | null)?._ref).filter((r): r is CardRef => !!r);
    for (const r of refs) { if (!r.chart) { r.pinned = true; renderChart(r, true); } }
    try { return fn(); } finally { for (const r of refs) { if (r.pinned) { r.pinned = false; if (!r.near) { disposeChart(r); r.ver = undefined; } } } }
}
const bg = () => theme().bg;
const fileBase = () => (S.table.file || S.path).split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'liveplot';
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'plot';
const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) { s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); } return btoa(s); };
const utf8b64 = (text: string) => b64(new TextEncoder().encode(text));
const dataUrlB64 = (url: string) => url.slice(url.indexOf(',') + 1);

function save(name: string, data: string, encoding: 'base64' | 'utf8', filter: string) {
    send({ type: 'save', name, data, encoding, filter });
}

// 3D layers are only composed at the screen's own pixel ratio; above it zrender redraws just the 2D parts
const ratio = (p: Plot) => (TYPES[p.type]?.gl ? window.devicePixelRatio || 1 : 2);

/** A card's title and legend chips, laid out for export: chips follow the title and wrap onto more lines
 *  (or, with one line only, end in "+N more"). Positions are relative to the card. */
interface Piece { kind: 'text' | 'swatch'; x: number; y: number; w: number; text?: string; font?: string; color: string; dashed?: boolean }
const LINE = 18;
function header(card: HTMLElement, oneLine: boolean): { pieces: Piece[]; extra: number } {
    const V = theme(), W = card.getBoundingClientRect().width, g = document.createElement('canvas').getContext('2d')!;
    const fontOf = (el: Element | null, fb: string) => { if (!el) { return fb; } const cs = getComputedStyle(el); return `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; };
    const titleEl = card.querySelector('.card-t'), chipEl = card.querySelector('.legend .chip');
    const tFont = fontOf(titleEl, `600 12px ${V.ui}`), cFont = fontOf(chipEl, `400 11.5px ${V.ui}`), vFont = fontOf(chipEl?.querySelector('b') ?? null, `500 11.5px ${V.mono}`);
    const pieces: Piece[] = [], title = titleEl?.textContent ?? '';
    g.font = tFont;
    const tw = Math.min(g.measureText(title).width, W - 20);
    pieces.push({ kind: 'text', x: 10, y: 15, w: tw, text: title, font: tFont, color: V.fg });
    const chips = [...card.querySelectorAll<HTMLElement>('.legend .chip')].map(chip => {
        const i = chip.querySelector('i'), cs = i ? getComputedStyle(i) : null, dashed = cs?.borderStyle === 'dashed';
        return {
            name: [...chip.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim(),
            value: chip.querySelector('b')?.textContent ?? '',
            color: cs ? (dashed ? cs.borderColor : cs.backgroundColor) : V.muted, dashed, off: chip.classList.contains('off'),
        };
    });
    const widthOf = (c: typeof chips[number]) => { g.font = cFont; let w = 13 + g.measureText(c.name).width; if (c.value) { g.font = vFont; w += 5 + g.measureText(c.value).width; } return w; };
    let x = 10 + tw + 14, y = 15, lines = 0, lastX = x;
    for (let k = 0; k < chips.length; k++) {
        const c = chips[k], w = widthOf(c);
        if (x + w > W - 10) {
            if (oneLine || lines >= 6) {
                g.font = cFont;
                const more = `+${chips.length - k} more`;
                if (x + g.measureText(more).width > W - 10 && pieces.length > 1) { pieces.splice(-3); x = lastX; }
                pieces.push({ kind: 'text', x, y, w: 0, text: more, font: cFont, color: V.muted });
                break;
            }
            lines++; x = 10; y += LINE;
        }
        lastX = x;
        pieces.push({ kind: 'swatch', x, y: y - 4, w: 8, color: c.color, dashed: c.dashed });
        g.font = cFont;
        const nw = g.measureText(c.name).width;
        pieces.push({ kind: 'text', x: x + 13, y, w: nw, text: c.name, font: cFont, color: c.off ? alpha(V.muted, 0.45) : V.muted });
        pieces.push({ kind: 'text', x: x + 13 + nw + 5, y, w: 0, text: c.value, font: vFont, color: V.fg });
        x += w + 12;
    }
    return { pieces, extra: lines * LINE };
}

/** Draw one card (border, header, chart) onto a canvas at (x, y) in CSS pixels; returns the height used. */
function drawCard(g: CanvasRenderingContext2D, p: Plot, x: number, y: number, oneLine: boolean): number {
    const card = cardOf(p), c = chartOf(p);
    if (!card) { return 0; }
    const V = theme(), o = card.getBoundingClientRect(), h = header(card, oneLine), H = o.height + h.extra;
    g.save();
    g.translate(x, y);
    g.fillStyle = V.bg; g.fillRect(0, 0, o.width, H);
    g.strokeStyle = V.border; g.lineWidth = 1; g.strokeRect(0.5, 0.5, o.width - 1, H - 1);
    g.textBaseline = 'middle';
    for (const pc of h.pieces) {
        if (pc.kind === 'swatch') {
            if (pc.dashed) { g.setLineDash([2, 1.5]); g.strokeStyle = pc.color; g.lineWidth = 1.5; g.strokeRect(pc.x, pc.y, 8, 8); g.setLineDash([]); } else { g.fillStyle = pc.color; g.fillRect(pc.x, pc.y, 8, 8); }
        } else if (pc.text) {
            g.font = pc.font!; g.fillStyle = pc.color;
            g.fillText(pc.w && pc === h.pieces[0] ? fit(g, pc.text, pc.w) : pc.text, pc.x, pc.y);
        }
    }
    const host = card.querySelector<HTMLElement>('.chart-host')?.getBoundingClientRect();
    if (c && host) { g.drawImage(c.getRenderedCanvas({ pixelRatio: ratio(p), backgroundColor: V.bg }), host.left - o.left, host.top - o.top + h.extra, host.width, host.height); }
    g.restore();
    return H;
}
function fit(g: CanvasRenderingContext2D, text: string, w: number): string {
    if (g.measureText(text).width <= w + 1) { return text; }
    let t = text;
    while (t.length > 1 && g.measureText(t + '…').width > w) { t = t.slice(0, -1); }
    return t + '…';
}

/** A plot as a PNG data URL: the whole card (title, legend, chart) at twice the screen resolution. */
function png(p: Plot): string | null {
    const card = cardOf(p);
    if (!card || !chartOf(p)) { return null; }
    const r = card.getBoundingClientRect(), k = ratio(p), canvas = document.createElement('canvas');
    canvas.width = Math.round(r.width * k); canvas.height = Math.round((r.height + header(card, false).extra) * k);
    const g = canvas.getContext('2d')!;
    g.scale(k, k);
    drawCard(g, p, 0, 0, false);
    return canvas.toDataURL('image/png');
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** A plot as SVG: the card's header, then the same chart option drawn again by the SVG renderer, off screen. */
function svg(p: Plot): string | null {
    const c = chartOf(p), card = cardOf(p), host = card?.querySelector<HTMLElement>('.chart-host');
    if (!c || !card || !host) { return null; }
    const V = theme(), o = card.getBoundingClientRect(), hr = host.getBoundingClientRect(), h = header(card, false), H = o.height + h.extra;
    const off = echarts.init(null as unknown as HTMLElement, null, { renderer: 'svg', ssr: true, width: c.getWidth(), height: c.getHeight() });
    let inner: string;
    try {
        off.setOption({ ...c.getOption(), animation: false, backgroundColor: 'transparent' });
        inner = off.renderToSVGString();
    } finally { off.dispose(); }
    const body = h.pieces.map(pc => (pc.kind === 'swatch'
        ? (pc.dashed ? `<rect x="${pc.x}" y="${pc.y}" width="8" height="8" fill="none" stroke="${pc.color}" stroke-width="1.5" stroke-dasharray="2 1.5"/>` : `<rect x="${pc.x}" y="${pc.y}" width="8" height="8" fill="${pc.color}"/>`)
        : pc.text ? `<text x="${pc.x}" y="${pc.y}" dominant-baseline="central" fill="${pc.color}" style="font:${xml(pc.font!)}">${xml(pc.text)}</text>` : '')).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${H}" viewBox="0 0 ${o.width} ${H}"><rect width="100%" height="100%" fill="${V.bg}"/>${body}${inner.replace('<svg ', `<svg x="${hr.left - o.left}" y="${hr.top - o.top + h.extra}" `)}</svg>`;
}

async function copyImage(p: Plot) {
    const url = png(p);
    if (!url) { return; }
    try {
        const bin = atob(dataUrlB64(url)), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
        const blob = new Blob([bytes], { type: 'image/png' });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        notify(`Copied "${p.title}" as an image.`);
    } catch (e) {
        notify(`Couldn't copy the image: ${(e as Error).message}. Use Save as PNG instead.`, 'warning');
    }
}

/** The whole grid, laid out as on screen, with each plot's title. */
function gridPng(): string | null {
    const stack = document.querySelector<HTMLElement>('.lp-stack');
    const cards = S.plots.map(p => ({ p, card: cardOf(p) })).filter(x => x.card && x.card.offsetParent);
    if (!stack || !cards.length) { return null; }
    const V = theme(), r0 = stack.getBoundingClientRect(), pad = 16, head = 34, k = 2;
    const rects = cards.map(x => x.card!.getBoundingClientRect());
    const W = Math.max(...rects.map(r => r.right)) - r0.left + pad * 2, H = Math.max(...rects.map(r => r.bottom)) - r0.top + pad * 2 + head;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(W * k); canvas.height = Math.ceil(H * k);
    const g = canvas.getContext('2d')!;
    g.scale(k, k);
    g.fillStyle = V.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = V.fg; g.font = `600 14px ${V.ui}`; g.textBaseline = 'middle';
    g.fillText(`${fileBase()}  ·  ${new Date().toLocaleString()}`, pad, pad + 10);
    for (let i = 0; i < cards.length; i++) { drawCard(g, cards[i].p, rects[i].left - r0.left + pad, rects[i].top - r0.top + pad + head, true); }
    return canvas.toDataURL('image/png');
}

/** The rows a plot shows (after skip and window) for its columns, as CSV text. */
function plotCsv(p: Plot): string {
    const t = S.table, [a, b] = rowRange(p), step = rowStep(), cols = plotCols(p).filter(c => colInfo(c) && colInfo(c)!.kind !== 'array');
    const q = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const getters = cols.map(c => {
        const kind = colInfo(c)!.kind;
        if (kind === 'text') { const tx = t.texts(c, a, b); return (i: number) => q(tx[i] ?? ''); }
        const nums = t.numbers(c, a, b);
        return kind === 'time' ? (i: number) => (Number.isFinite(nums[i]) ? new Date(nums[i] * 1000).toISOString() : '') : (i: number) => (Number.isFinite(nums[i]) ? String(nums[i]) : '');
    });
    const lines = [['row', ...cols.map(dn)].map(q).join(',')];
    for (let i = 0; i < b - a; i++) { lines.push([String((t.start + a + i) * step + 1), ...getters.map(f => f(i))].join(',')); }
    return lines.join('\n') + '\n';
}

function stats(p: Plot): string {
    const t = S.table, [a, b] = rowRange(p);
    const rows = plotCols(p).filter(c => colInfo(c)?.kind === 'num').map(c => {
        const v = t.numbers(c, a, b);
        let n = 0, sum = 0, lo = Infinity, hi = -Infinity, last = NaN;
        for (const x of v) { if (Number.isFinite(x)) { n++; sum += x; lo = Math.min(lo, x); hi = Math.max(hi, x); last = x; } }
        return n ? `<tr><td>${esc(dn(c))}</td><td>${fmt(lo)}</td><td>${fmt(hi)}</td><td>${fmt(sum / n)}</td><td>${fmt(last)}</td></tr>` : '';
    }).join('');
    return rows ? `<table><tr><th>Column</th><th>Min</th><th>Max</th><th>Mean</th><th>Last</th></tr>${rows}</table>` : '';
}

/** A single HTML file with every plot as an image and a small table of numbers under each. Opens anywhere, offline. */
function report(): string {
    const V = theme(), when = new Date();
    const rows = S.detail ? `rows ${fmtInt(S.detail.from + 1)}–${fmtInt(S.detail.from + S.table.length)} of the file` : S.stride > 1 ? `an overview of ${fmtInt(S.fileRows)} rows (1 in ${fmtInt(S.stride)} shown)` : `${fmtInt(S.table.length)} rows`;
    const figs = S.plots.map(p => {
        const url = png(p), w = Math.round(cardOf(p)?.getBoundingClientRect().width ?? 480);
        return `<figure>${url ? `<img src="${url}" alt="${esc(p.title)}" style="width:${w}px">` : `<p><b>${esc(p.title)}</b></p><p class="none">Nothing drawn yet.</p>`}<figcaption>${esc(TYPES[p.type]?.label ?? p.type)}</figcaption>${stats(p)}</figure>`;
    }).join('\n');
    const cols = S.table.info().map(c => `<tr><td>${esc(dn(c.name))}</td><td>${c.kind}</td></tr>`).join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fileBase())}: plots</title>
<style>
:root { color-scheme: ${V.dark ? 'dark' : 'light'}; }
body { margin: 0; padding: 24px; background: ${V.bg}; color: ${V.fg}; font: 13px/1.5 ${V.ui}; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 28px 0 8px; }
.meta { color: ${V.muted}; margin: 0 0 20px; }
main { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
figure { margin: 0; min-width: 0; }
figcaption { color: ${V.muted}; font-size: 12px; margin-top: 4px; }
img { max-width: 100%; height: auto; display: block; }
table { border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 2px 12px 2px 0; border-bottom: 1px solid ${V.border}; } th { color: ${V.muted}; font-weight: 600; }
.none { color: ${V.muted}; }
</style></head><body>
<h1>${esc(S.table.file ? S.table.file.split(/[\\/]/).pop()! : S.name)}</h1>
<p class="meta">${esc(S.table.file || S.path)} · ${rows} · ${esc(when.toLocaleString())} · made with Dynamic Liveplot</p>
<main>
${figs}
</main>
<h2>Columns</h2>
<table><tr><th>Name</th><th>Kind</th></tr>${cols}</table>
</body></html>
`;
}

function exportGrid() {
    const url = withAllDrawn(S.plots, gridPng);
    if (!url) { notify('There are no plots to export yet.'); return; }
    save(`${safe(fileBase())} plots.png`, dataUrlB64(url), 'base64', 'PNG image');
}

function exportMenuItems(p: Plot | null) {
    const gl = p ? !!TYPES[p.type]?.gl : false;
    return [
        ...(p ? [
            { label: `Save "${p.title}" as PNG…`, run: () => { const u = png(p); if (u) { save(`${safe(p.title)}.png`, dataUrlB64(u), 'base64', 'PNG image'); } } },
            { label: `Save "${p.title}" as SVG…`, disabled: gl, hint: gl ? 'not for 3D' : undefined, run: () => { const s = svg(p); if (s) { save(`${safe(p.title)}.svg`, utf8b64(s), 'base64', 'SVG image'); } } },
            { label: 'Copy Image', run: () => void copyImage(p) },
            { label: 'Save Plotted Data as CSV…', run: () => save(`${safe(p.title)}.csv`, utf8b64(plotCsv(p)), 'base64', 'CSV') },
            { sep: true },
        ] : []),
        { label: 'Save All Plots as PNG…', run: exportGrid },
        { label: 'Save Report as HTML…', run: () => save(`${safe(fileBase())} report.html`, utf8b64(withAllDrawn(S.plots, report)), 'base64', 'HTML') },
    ];
}

function exportMenu(anchor: HTMLElement) {
    const p = S.plots.find(x => x.id === S.sel) ?? null;
    void import('./menus').then(({ showMenu }) => showMenu(anchor, [
        ...exportMenuItems(p),
        { sep: true },
        { note: 'Images and reports use the current theme. The report is one HTML file that opens anywhere, offline.' },
    ]));
}

extensions.toolbarRight.push(() => `<button class="tbtn icon" data-export title="Export plots, a report or data" aria-label="Export">${ic('download')}</button>`);
extensions.wireToolbar.push(tool => { const b = tool.querySelector<HTMLElement>('[data-export]'); if (b) { b.onclick = () => exportMenu(b); } });
extensions.plotMenu.push(p => [{ sep: true }, ...exportMenuItems(p).slice(0, 4)]);
extensions.commands.export = () => { const b = document.querySelector<HTMLElement>('[data-export]'); if (b) { exportMenu(b); } };
