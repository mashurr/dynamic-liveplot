// Picks a first set of plots for a file nobody has laid out yet, from the shapes of its columns.

import { TYPES } from './charts/registry';
import { cols, dn, newPlot, S, type Plot } from './state';

export function monotonic(name: string): boolean {
    const t = S.table, a = t.numbers(name, 0, t.length);
    if (a.length < 5 || !(a[a.length - 1] > a[0])) { return false; }
    for (let i = 1; i < a.length; i++) { if (!(a[i] >= a[i - 1])) { return false; } }
    return true;
}

type TextUse = 'label' | 'shade' | 'split' | 'count' | 'ignore';

/** What a text column is for: a label per row, phases to shade, groups to split by, or something to count. */
export function classifyText(name: string): TextUse {
    const t = S.table, v = t.texts(name, 0, t.length).filter((x): x is string => x !== null && x !== ''), n = v.length;
    if (!n) { return 'ignore'; }
    const counts = new Map<string, number>();
    let changes = 0;
    v.forEach((x, i) => { counts.set(x, (counts.get(x) ?? 0) + 1); if (i && x !== v[i - 1]) { changes++; } });
    const u = counts.size, avgRun = n / (changes + 1), minShare = Math.min(...counts.values()) / n;
    if (u === n && n <= 50) { return 'label'; }
    if (avgRun >= 20 && u <= 30 && n > 60) { return 'shade'; }
    if (u <= 12 && minShare >= 0.1 && avgRun <= 3) { return 'split'; }
    if (u <= 30) { return 'count'; }
    return 'ignore';
}

/** A number column that is really a code: a handful of whole numbers (error codes, levels, bins). */
export function codeLike(name: string): boolean {
    const t = S.table, a = t.numbers(name, 0, t.length), seen = new Set<number>();
    let n = 0;
    for (const x of a) { if (!Number.isFinite(x)) { continue; } if (!Number.isInteger(x)) { return false; } seen.add(x); n++; if (seen.size > 12) { return false; } }
    return n >= 10 && seen.size <= 12 && seen.size < n / 3;
}

function autoLog(p: Plot, c: string) {
    const t = S.table, a = t.numbers(c, 0, t.length);
    let lo = Infinity, hi = -Infinity, pos = true, any = false;
    for (const x of a) { if (!Number.isFinite(x)) { continue; } any = true; if (x <= 0) { pos = false; break; } lo = Math.min(lo, x); hi = Math.max(hi, x); }
    if (any && pos && hi / lo > 1000) { p.options.log = true; }
}
export { autoLog };

const has = (id: string) => !!TYPES[id];

export function autoPlot(): { count: number; how: string } {
    const all = cols(), plots: Plot[] = [];
    const time = all.find(c => c.kind === 'time')?.name;
    const nums = all.filter(c => c.kind === 'num').map(c => c.name);
    const x = time ?? nums.find(monotonic) ?? null;
    const texts = all.filter(c => c.kind === 'text').map(c => ({ name: c.name, use: classifyText(c.name) }));
    const label = texts.find(t => t.use === 'label'), split = texts.find(t => t.use === 'split'), shade = texts.find(t => t.use === 'shade');
    const counts = texts.filter(t => t.use === 'count'), used = texts.filter(t => t.use !== 'ignore');
    const codes = nums.filter(c => c !== x && codeLike(c));
    const ys = nums.filter(c => c !== x && !(time && monotonic(c)) && !codes.includes(c));
    const arrays = all.filter(c => c.kind === 'array').map(c => c.name);
    const named = (w: string) => nums.find(c => c.toLowerCase() === w);
    const X = x ? [x] : [];
    let how = '';
    if (has('candlestick') && named('open') && named('high') && named('low') && named('close')) {
        plots.push(newPlot('OHLC', 'candlestick', { x: X, open: [named('open')!], high: [named('high')!], low: [named('low')!], close: [named('close')!] }));
        ys.filter(c => !['open', 'high', 'low', 'close'].includes(c.toLowerCase())).slice(0, 2).forEach(c => plots.push(newPlot(dn(c), 'line', { x: X, y: [c] })));
        how = 'Found open, high, low and close columns, so the first chart is a candlestick.';
    } else if (used.length >= 2 && ys.length <= 1 && !time && (has('sankey') || has('treemap'))) {
        const [a, b] = used, flow = /from|source|src/i.test(a.name) || /(^|_)to(_|$)|target|dst/i.test(b.name), y = ys.slice(0, 1);
        if (flow && has('sankey')) { plots.push(newPlot(`${dn(a.name)} → ${dn(b.name)}`, 'sankey', { source: [a.name], target: [b.name], y })); if (has('chord')) { plots.push(newPlot('Flows', 'chord', { source: [a.name], target: [b.name], y })); } }
        else { plots.push(newPlot(`${dn(a.name)} › ${dn(b.name)}`, 'treemap', { levels: [a.name, b.name], y })); if (has('sunburst')) { plots.push(newPlot('Shares', 'sunburst', { levels: [a.name, b.name], y })); } }
        how = flow ? 'Two text columns look like from and to, so they show as flows.' : 'Two text columns, so they show as nested shares.';
    } else if (label && (!time || S.table.length <= 50)) {
        // One label per row in a small table (a summary per lot, per site…): bars per label read best
        const vals = nums;
        vals.slice(0, 4).forEach(c => plots.push(newPlot(dn(c), 'bar', { cat: [label.name], y: [c] }, { options: { summary: 'last' } })));
        if (vals.length === 1 && has('donut')) { plots.push(newPlot(`Share of ${dn(vals[0])}`, 'donut', { cat: [label.name], y: [vals[0]] }, { options: { summary: 'sum' } })); }
        if (vals.length >= 3) { plots.push(newPlot('All columns', 'parallel', { y: vals.slice(0, 6) })); }
        if (!vals.length) { plots.push(newPlot(dn(label.name), 'bar', { cat: [label.name] })); }
        how = `Each row is one ${dn(label.name)}, so numbers show per ${dn(label.name)}.`;
    } else if (!ys.length && (used.length || codes.length)) {
        // Nothing to measure (a log of events, say): count each text column and code
        for (const c of [...used.map(t => t.name), ...codes].slice(0, 6)) {
            const k = S.table.col(c)?.kind === 'text' ? S.table.categories(c).length : new Set(S.table.numbers(c, 0, S.table.length)).size;
            plots.push(newPlot(`${dn(c)} counts`, k <= 6 && has('donut') ? 'donut' : 'bar', { cat: [c] }));
        }
        how = 'No measurements here, so each column shows as counts.';
    } else {
        const room = 6 - (arrays.length && has('spectrum') ? 1 : 0) - (counts.length ? 1 : 0) - (split && ys.length ? 1 : 0);
        ys.slice(0, Math.max(1, room)).forEach(c => {
            const p = newPlot(dn(c), 'line', { x: X, y: [c], split: split ? [split.name] : [], shade: shade && x ? [shade.name] : [] });
            autoLog(p, c);
            plots.push(p);
        });
        if (split && ys.length) { const c = ys[ys.length > 1 ? 1 : 0]; plots.push(newPlot(`${dn(c)} by ${dn(split.name)}`, 'box', { y: [c], group: [split.name] })); }
        if (has('spectrum')) { arrays.slice(0, 1).forEach(c => plots.push(newPlot(dn(c), 'spectrum', { spec: [c] }))); }
        counts.slice(0, 1).forEach(t => plots.push(newPlot(dn(t.name), S.table.categories(t.name).length <= 6 && has('donut') ? 'donut' : 'bar', { cat: [t.name] })));
        const bits: string[] = [];
        if (x) { bits.push(`against ${x}`); }
        if (split) { bits.push(`split by ${split.name}`); }
        if (shade && x) { bits.push(`with ${shade.name} shaded`); }
        how = bits.length ? `Plotted ${bits.join(', ')}.` : '';
    }
    if (!plots.length) { plots.push(newPlot('Plot 1', 'line', {}, { autoTitle: true })); }
    setPlots(plots.slice(0, 6));
    return { count: S.plots.length, how };
}

export function setPlots(plots: Plot[]) {
    S.plots = plots;
    const n = plots.length;
    S.grid = n <= 1 ? { columns: 1, rows: 1 } : n <= 2 ? { columns: 2, rows: 1 } : n <= 4 ? { columns: 2, rows: 2 } : { columns: 3, rows: 2 };
    S.sel = null;
}
