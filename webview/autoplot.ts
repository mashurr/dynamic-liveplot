// Picks a first set of plots for a file nobody has laid out yet.

import { cols, dn, newPlot, S, type Plot } from './state';

export function monotonic(name: string): boolean {
    const t = S.table, a = t.numbers(name, 0, t.length);
    if (a.length < 5 || !(a[a.length - 1] > a[0])) { return false; }
    for (let i = 1; i < a.length; i++) { if (!(a[i] >= a[i - 1])) { return false; } }
    return true;
}

export function autoPlot(): { count: number; how: string } {
    const all = cols();
    const time = all.find(c => c.kind === 'time')?.name;
    const nums = all.filter(c => c.kind === 'num').map(c => c.name);
    const x = time ?? nums.find(monotonic) ?? null;
    const ys = nums.filter(c => c !== x && !(time && monotonic(c)));
    const X = x ? [x] : [];
    const plots: Plot[] = ys.slice(0, 6).map(c => newPlot(dn(c), 'line', { x: X, y: [c] }));
    if (!plots.length) { plots.push(newPlot('Plot 1', 'line', {}, { autoTitle: true })); }
    setPlots(plots);
    return { count: plots.length, how: x ? `Plotted against ${x}.` : '' };
}

export function setPlots(plots: Plot[]) {
    S.plots = plots;
    const n = plots.length;
    S.grid = n <= 1 ? { columns: 1, rows: 1 } : n <= 2 ? { columns: 2, rows: 1 } : n <= 4 ? { columns: 2, rows: 2 } : { columns: 3, rows: 2 };
    S.sel = null;
}
