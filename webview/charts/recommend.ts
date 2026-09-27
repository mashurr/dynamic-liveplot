// Which chart types suit a set of columns, best first. Only registered types are returned.

import { TYPES } from './registry';
import { kindOf, S } from '../state';

export function recommend(list: string[]): string[] {
    const kinds = list.map(c => kindOf(c)).filter(Boolean);
    const n = (k: string) => kinds.filter(x => x === k).length;
    const texts = list.filter(c => kindOf(c) === 'text');
    const uniq = (c: string) => S.table.categories(c).length;
    const out: string[] = [];
    if (n('array')) { out.push('spectrum', 'spectrogram', 'surface'); }
    if (n('text') >= 2 && /from|source|src/i.test(texts[0])) { out.push('sankey', 'chord', 'graph'); }
    if (n('text') >= 2) { out.push('treemap', 'sunburst', 'heatmap', 'sankey', 'bar3d'); }
    if (n('text') === 1 && n('num') === 0) { out.push(uniq(texts[0]) <= 6 ? 'donut' : 'bar', uniq(texts[0]) <= 6 ? 'bar' : 'hbar', 'pie', 'funnel'); }
    if (n('text') === 1 && n('num') >= 1) { out.push('bar', 'box', 'violin', 'strip', 'stackedBar', 'pie'); }
    if (['open', 'high', 'low', 'close'].every(w => list.some(c => c.toLowerCase().includes(w)))) { out.unshift('candlestick'); }
    if (n('time') && n('num')) { out.push('line', 'area', 'step', 'scatter'); }
    if (!n('time') && n('num') >= 3) { out.push('scatterMatrix', 'parallel', 'correlation', 'bubble', 'radar', 'scatter3d'); }
    if (!n('time') && n('num') === 2) { out.push('scatter', 'line', 'density2d', 'polar'); }
    if (n('num') === 1 && !n('time') && !n('text')) { out.push('line', 'histogram', 'gauge', 'kpi', 'box'); }
    if (!out.length) { out.push('line'); }
    return [...new Set(out)].filter(id => TYPES[id] && !TYPES[id].later);
}
