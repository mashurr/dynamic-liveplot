// Small helpers shared by the view: DOM, formatting, statistics, icons and colours.

export const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
export const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => Array.from(r.querySelectorAll(s)) as T[];
export function el<T extends HTMLElement = HTMLElement>(html: string): T {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild as T;
}
export const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const fin = Number.isFinite;
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const fmtInt = (n: number) => n.toLocaleString('en-US');
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const trunc = (s: unknown, n = 14) => { const t = String(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export function fmt(v: unknown): string {
    if (typeof v !== 'number' || !Number.isFinite(v)) { return '—'; }
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e6 || a < 1e-3)) { return v.toExponential(2); }
    return String(Number(v.toPrecision(4)));
}
export function fmtTime(sec: unknown, withDate = false): string {
    if (typeof sec !== 'number' || !Number.isFinite(sec)) { return '—'; }
    const d = new Date(sec * 1000);
    const t = d.toLocaleTimeString('en-GB', { hour12: false });
    return withDate ? `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${t}` : t;
}
export function hexA(hex: string, a: number): string {
    if (!hex || hex[0] !== '#') { return hex; }
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
export function uniqOrdered<T>(arr: ArrayLike<T>): T[] {
    const seen = new Set<T>(), out: T[] = [];
    for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v !== null && v !== undefined && (v as unknown) !== '' && !seen.has(v)) { seen.add(v); out.push(v); } }
    return out;
}
export function rolling(arr: (number | null)[], w: number): (number | null)[] {
    const out: (number | null)[] = new Array(arr.length);
    let sum = 0, cnt = 0;
    for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v !== null) { sum += v; cnt++; }
        if (i >= w) { const o = arr[i - w]; if (o !== null) { sum -= o; cnt--; } }
        out[i] = cnt ? sum / cnt : null;
    }
    return out;
}
export function lastFinite(arr: ArrayLike<unknown>): number | null {
    for (let i = arr.length - 1; i >= 0; i--) { const v = arr[i]; if (typeof v === 'number' && Number.isFinite(v)) { return v; } }
    return null;
}
export interface Quart { q1: number; med: number; q3: number; lo: number; hi: number; out: number[]; min: number; max: number }
export function quart(vals: (number | null)[]): Quart | null {
    const a = vals.filter((v): v is number => v !== null).sort((x, y) => x - y);
    if (!a.length) { return null; }
    const q = (p: number) => { const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
    const q1 = q(.25), med = q(.5), q3 = q(.75), iqr = q3 - q1;
    const lo = a.find(v => v >= q1 - 1.5 * iqr)!, hi = [...a].reverse().find(v => v <= q3 + 1.5 * iqr)!;
    return { q1, med, q3, lo, hi, out: a.filter(v => v < lo || v > hi), min: a[0], max: a[a.length - 1] };
}
export interface Stats { n: number; mean: number; std: number; min: number; max: number }
export function stats(vals: (number | null)[]): Stats | null {
    let n = 0, s = 0, min = Infinity, max = -Infinity;
    for (const v of vals) { if (v === null) { continue; } n++; s += v; if (v < min) { min = v; } if (v > max) { max = v; } }
    if (!n) { return null; }
    const mean = s / n;
    let ss = 0;
    for (const v of vals) { if (v !== null) { ss += (v - mean) ** 2; } }
    return { n, mean, std: Math.sqrt(ss / Math.max(1, n - 1)), min, max };
}
export function kde(vals: (number | null)[], lo: number, hi: number, n = 80): [number, number][] {
    const a = vals.filter((v): v is number => v !== null);
    const st = stats(a);
    if (!st || st.n < 2) { return []; }
    const sample = a.length > 4000 ? a.filter((_, i) => i % Math.ceil(a.length / 4000) === 0) : a;
    const h = 1.06 * (st.std || 1) * Math.pow(sample.length, -0.2) || 1;
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
        const x = lo + (hi - lo) * i / (n - 1);
        let d = 0;
        for (const v of sample) { const u = (x - v) / h; d += Math.exp(-0.5 * u * u); }
        out.push([x, d / (sample.length * h * Math.sqrt(2 * Math.PI))]);
    }
    return out;
}
export const AGGS: Record<string, (a: number[]) => number | null> = {
    count: a => a.length,
    sum: a => a.reduce((s, v) => s + v, 0),
    mean: a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null),
    median: a => quart(a)?.med ?? null,
    min: a => (a.length ? a.reduce((m, v) => (v < m ? v : m), Infinity) : null),
    max: a => (a.length ? a.reduce((m, v) => (v > m ? v : m), -Infinity) : null),
    last: a => (a.length ? a[a.length - 1] : null),
};
export function groupBy(keys: ArrayLike<unknown>, vals: (number | null)[] | null, labels: unknown[], agg: string): (number | null)[] {
    const m = new Map<unknown, number[]>(labels.map(l => [l, []]));
    for (let i = 0; i < keys.length; i++) {
        const b = m.get(keys[i]);
        if (!b) { continue; }
        if (vals) { const v = vals[i]; if (v !== null) { b.push(v); } } else { b.push(1); }
    }
    return labels.map(l => { const b = m.get(l)!; return vals ? (AGGS[agg] ?? AGGS.mean)(b) : b.length; });
}
export function pearson(x: (number | null)[], y: (number | null)[]): number {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a === null || b === null) { continue; } n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b; }
    const d = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    return d ? (n * sxy - sx * sy) / d : 0;
}
export const jitter = (i: number) => ((i * 9301 + 49297) % 233280) / 233280 - 0.5;

// Okabe–Ito based, tuned per theme so every colour reads on its background
const PALETTE_LIGHT = ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#3A9AD9', '#9A8A00', '#6B6B6B'];
const PALETTE_DARK = ['#56B4E9', '#E69F00', '#2EBD8E', '#FF7A45', '#E08FC0', '#6FA8FF', '#F0E442', '#B0B0B0'];
export const RAMP = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];
export const isDark = () => !document.body.classList.contains('vscode-light') && !document.body.classList.contains('vscode-high-contrast-light');
export const palette = () => (isDark() ? PALETTE_DARK : PALETTE_LIGHT);
export const pal = (i: number) => palette()[((i % 8) + 8) % 8];

const ICONS: Record<string, string> = {
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l4 4"/>',
    chevR: '<path d="M6 4l4 4-4 4"/>', chevL: '<path d="M10 4L6 8l4 4"/>', chevD: '<path d="M4 6l4 4 4-4"/>',
    eye: '<path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/>',
    table: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6h12M2 9.5h12M6.5 6v7.5"/>',
    pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>', play: '<path d="M5 3l8 5-8 5z"/>', plus: '<path d="M8 3v10M3 8h10"/>',
    grid: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 8h12M6 2.5v11M10 2.5v11"/>',
    more: '<circle class="f" cx="3.5" cy="8" r="1.1"/><circle class="f" cx="8" cy="8" r="1.1"/><circle class="f" cx="12.5" cy="8" r="1.1"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>', download: '<path d="M8 2v8.5M4.5 7L8 10.5 11.5 7M2.5 13.5h11"/>',
    link: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/>',
    wand: '<path d="M2.5 13.5l7.3-7.3 1.5 1.5-7.3 7.3z"/><path d="M11 1.5v2.2M14.5 5h-2.2M13.6 2.4l-1.5 1.5"/>',
    layout: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6.5h12M6.5 6.5v7"/>',
    info: '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.9v.2"/>',
    sync: '<path d="M2.5 6h9.5l-2.5-2.5M13.5 10H4l2.5 2.5"/>', flag: '<path d="M3.5 14.5v-12M3.5 3h8l-2 3 2 3h-8"/>',
    sidebar: '<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M5.5 2.5v11"/>',
    ruler: '<path d="M1.8 10.5l8.7-8.7 3.7 3.7-8.7 8.7z"/><path d="M4.5 8l1.2 1.2M6.5 6l1.8 1.8M8.5 4l1.2 1.2"/>',
    folder: '<path d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z"/>',
};
export const ic = (name: string, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
