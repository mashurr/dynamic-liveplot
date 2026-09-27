// Registers every chart type.

import { buildBars, buildRadar, buildWaterfall } from './compare';
import { buildBox, buildDensity, buildHist, buildStrip, buildViolin } from './distribution';
import { register, sl, dots, SHADE, SPLIT, X, XR, Y } from './registry';
import { buildCorr, buildDensity2d, buildMatrix, buildParallel, buildScatter } from './relationship';
import { buildCart, buildStream } from './trend';
import { buildFunnel, buildPie, buildTree } from './composition';
import { buildFlow } from './flow';
import { buildCalendar, buildHeatmap, buildSpectrogram, buildSpectrum } from './matrix';
import { buildCandle, buildErr } from './finance';
import { buildGauge, buildKpi, buildPolar } from './polar';
import { buildBar3d, buildScatter3d, buildSurface } from './gl3d';
import { buildCustom, buildMap } from './other';

const CAT = sl('cat', 'Category', ['text', 'num', 'time'], { hint: 'Row number when empty' });
const VALS = sl('y', 'Values', ['num'], { max: 6, hint: 'Counts rows when empty' });
const DIST = sl('y', 'Values', ['num'], { max: 6, req: true });
const GROUP = sl('group', 'Group by', ['text']);
const COLOR = sl('split', 'Colour by', ['text']);
const VAL1 = sl('y', 'Value', ['num'], { hint: 'Counts rows when empty' });
const TEXT1 = (id: string, label: string) => sl(id, label, ['text'], { req: true });
const NUMR = (id: string, label: string) => sl(id, label, ['num'], { req: true });

register(
    // Trend
    { id: 'line', label: 'Line', group: 'Trend', desc: 'Numbers over rows or time', slots: [X, Y, SPLIT, SHADE], cart: true, glyph: '<path d="M3 22l8-9 7 5 8-11 11 6"/>', build: c => buildCart(c, 'line') },
    { id: 'area', label: 'Area', group: 'Trend', desc: 'Line with the area filled', slots: [X, Y, SPLIT, SHADE], cart: true, glyph: '<path class="f2" d="M3 25V18l8-7 7 4 8-9 11 5v14z"/><path d="M3 18l8-7 7 4 8-9 11 5"/>', build: c => buildCart(c, 'area') },
    { id: 'step', label: 'Step', group: 'Trend', desc: 'Values that hold until they change', slots: [X, Y, SPLIT, SHADE], cart: true, glyph: '<path d="M3 22h7v-8h8v4h8V7h11"/>', build: c => buildCart(c, 'step') },
    { id: 'stackedArea', label: 'Stacked area', group: 'Trend', desc: 'Parts adding up over time', slots: [X, Y, SPLIT], cart: true, glyph: '<path class="f2" d="M3 25v-7l9-4 9 3 16-6v14z"/><path class="f" d="M3 25v-4l9-2 9 2 16-3v7z"/>', build: c => buildCart(c, 'stack') },
    { id: 'streamgraph', label: 'Streamgraph', group: 'Trend', desc: 'One number split by a text column, flowing', slots: [XR, sl('y', 'Value', ['num'], { req: true }), sl('split', 'Split by', ['text'], { req: true })], glyph: '<path class="f2" d="M3 14c6-8 12 2 18-4s10-2 16 1c-6 3-10 9-16 6S9 20 3 14z"/><path class="f" d="M3 14c6 2 12-1 18 1s10 0 16-3c-6 1-10 5-16 4S9 17 3 14z"/>', build: buildStream },
    // Compare
    { id: 'bar', label: 'Bar', group: 'Compare', desc: 'Compare values per category', slots: [CAT, VALS, SPLIT], agg: true, glyph: '<path class="f" d="M5 25V14h6v11zM15 25V6h6v19zM25 25V11h6v14z"/>', build: c => buildBars(c, 'bar') },
    { id: 'hbar', label: 'Horizontal bar', group: 'Compare', desc: 'Bars with long category names', slots: [CAT, VALS, SPLIT], agg: true, glyph: '<path class="f" d="M4 4h18v5H4zM4 12h28v5H4zM4 20h12v5H4z"/>', build: c => buildBars(c, 'hbar') },
    { id: 'stackedBar', label: 'Stacked bar', group: 'Compare', desc: 'Totals and their parts', slots: [CAT, VALS, SPLIT], agg: true, glyph: '<path class="f" d="M6 25v-7h6v7zM17 25v-10h6v10zM28 25v-6h6v6z"/><path class="f2" d="M6 18v-8h6v8zM17 15V5h6v10zM28 19v-7h6v7z"/>', build: c => buildBars(c, 'stackedBar') },
    { id: 'bar100', label: '100% stacked bar', group: 'Compare', desc: 'Shares per category', slots: [CAT, VALS, SPLIT], agg: true, glyph: '<path class="f" d="M6 25v-10h6v10zM17 25V11h6v14zM28 25v-7h6v7z"/><path class="f2" d="M6 15V4h6v11zM17 11V4h6v7zM28 18V4h6v14z"/>', build: c => buildBars(c, 'bar100') },
    { id: 'lollipop', label: 'Lollipop', group: 'Compare', desc: 'Lighter bars for many categories', slots: [CAT, VALS], agg: true, glyph: '<path d="M8 25V12M20 25V6M32 25V15"/>' + dots([[8, 11, 2.6], [20, 5, 2.6], [32, 14, 2.6]]), build: c => buildBars(c, 'lollipop') },
    { id: 'waterfall', label: 'Waterfall', group: 'Compare', desc: 'How steps add up to a total', slots: [CAT, sl('y', 'Change', ['num'], { req: true })], agg: true, glyph: '<path class="f" d="M4 25V12h6v13zM13 12V6h6v6zM22 6v5h6V6z"/><path class="f2" d="M31 25V11h6v14z"/>', build: buildWaterfall },
    { id: 'radar', label: 'Radar', group: 'Compare', desc: 'Several numbers on spokes', slots: [sl('y', 'Spokes', ['num'], { max: 8, req: true, min: 3 }), GROUP], glyph: '<path class="m" d="M20 3l14 10-5 13H11L6 13z"/><path class="f2" d="M20 7l10 7-4 9h-9l-6-10z"/>', build: buildRadar },
    // Distribution
    { id: 'histogram', label: 'Histogram', group: 'Distribution', desc: 'How values are spread', slots: [DIST], bins: true, glyph: '<path class="f" d="M4 25v-5h5v5zM9 25V13h5v12zM14 25V5h5v20zM19 25V9h5v16zM24 25v-8h5v8zM29 25v-3h5v3z"/>', build: buildHist },
    { id: 'density', label: 'Density curve', group: 'Distribution', desc: 'Smooth histogram', slots: [DIST], glyph: '<path class="f2" d="M3 25c6 0 8-18 14-18s8 13 12 13 5 5 8 5z"/><path d="M3 25c6 0 8-18 14-18s8 13 12 13 5 5 8 5"/>', build: c => buildDensity(c, false) },
    { id: 'ecdf', label: 'ECDF', group: 'Distribution', desc: 'Share of values below each level', slots: [DIST], glyph: '<path d="M3 25h5v-3h5v-5h5v-7h6V7h6V5h7"/>', build: c => buildDensity(c, true) },
    { id: 'box', label: 'Box plot', group: 'Distribution', desc: 'Median, quartiles and outliers', slots: [DIST, GROUP], glyph: '<path d="M11 3v5M11 20v5M29 6v4M29 18v5"/><rect class="f2" x="6" y="8" width="10" height="12"/><rect class="f2" x="24" y="10" width="10" height="8"/><path d="M6 14h10M24 13h10"/>', build: buildBox },
    { id: 'violin', label: 'Violin', group: 'Distribution', desc: 'Box plot showing the full shape', slots: [DIST, GROUP], glyph: '<path class="f2" d="M11 3c-3 5-6 7-3 11s3 7 3 11c0-4 0-7 3-11s0-6-3-11zM29 5c-2 4-6 6-2 10s2 6 2 9c0-3-1-5 2-9s0-6-2-10z"/><path d="M8 14h6M26 14h6"/>', build: buildViolin },
    { id: 'strip', label: 'Strip plot', group: 'Distribution', desc: 'Every value as a dot per group', slots: [DIST, GROUP], glyph: dots([[8, 8], [11, 12], [9, 17], [12, 20], [10, 14], [22, 6], [19, 10], [21, 15], [30, 11], [32, 16], [29, 19], [31, 22]]), build: buildStrip },
    // Relationship
    { id: 'scatter', label: 'Scatter', group: 'Relationship', desc: 'One number against another', slots: [XR, Y, COLOR], cart: true, glyph: dots([[6, 20], [10, 17], [13, 19], [16, 13], [20, 14], [23, 9], [27, 11], [31, 6], [34, 8], [18, 18]]), build: c => buildScatter(c, false) },
    { id: 'bubble', label: 'Bubble', group: 'Relationship', desc: 'Scatter with a size column', slots: [XR, sl('y', 'Y', ['num'], { req: true }), sl('size', 'Size', ['num'], { req: true }), COLOR], cart: true, glyph: '<circle class="f2" cx="10" cy="18" r="5"/><circle class="f2" cx="22" cy="10" r="7"/><circle class="f" cx="31" cy="19" r="3"/>', build: c => buildScatter(c, true) },
    { id: 'density2d', label: '2D density', group: 'Relationship', desc: 'Where points pile up', slots: [sl('x', 'X', ['num'], { req: true }), sl('y', 'Y', ['num'], { req: true })], glyph: '<path class="f2" d="M6 16h7v7H6zM13 9h7v7h-7zM20 16h7v7h-7z"/><path class="f" d="M13 16h7v7h-7zM20 9h7v7h-7z"/>', build: buildDensity2d },
    { id: 'scatterMatrix', label: 'Scatter matrix', group: 'Relationship', desc: 'Every pair of numbers at once', slots: [sl('y', 'Columns', ['num'], { max: 4, req: true, min: 2 })], glyph: '<rect class="m" x="5" y="3" width="13" height="10"/><rect class="m" x="22" y="3" width="13" height="10"/><rect class="m" x="5" y="15" width="13" height="10"/><rect class="m" x="22" y="15" width="13" height="10"/>' + dots([[25, 10, 1], [29, 7, 1], [32, 5, 1], [8, 22, 1], [12, 19, 1], [15, 17, 1]]), build: buildMatrix },
    { id: 'parallel', label: 'Parallel coordinates', group: 'Relationship', desc: 'Many numbers per row as lines', slots: [sl('y', 'Axes', ['num'], { max: 8, req: true, min: 2 }), COLOR], glyph: '<path class="m" d="M6 3v22M16 3v22M26 3v22M36 3v22"/><path d="M6 8l10 9 10-12 10 8M6 20l10-6 10 9 10-15"/>', build: buildParallel },
    { id: 'correlation', label: 'Correlation matrix', group: 'Relationship', desc: 'Which numbers move together', slots: [sl('y', 'Columns', ['num'], { max: 10, req: true, min: 2 })], glyph: '<path class="f" d="M8 4h8v7H8zM16 11h8v7h-8zM24 18h8v7h-8z"/><path class="f2" d="M16 4h8v7h-8zM24 4h8v7h-8zM8 11h8v7H8zM24 11h8v7h-8zM8 18h8v7H8zM16 18h8v7h-8z"/>', build: buildCorr },
    // Composition
    { id: 'pie', label: 'Pie', group: 'Composition', desc: 'Shares of a whole', slots: [TEXT1('cat', 'Category'), VAL1], agg: true, glyph: '<circle class="f2" cx="20" cy="14" r="11"/><path class="f" d="M20 14V3a11 11 0 0 1 10.4 14.6z"/>', build: c => buildPie(c, 'pie') },
    { id: 'donut', label: 'Donut', group: 'Composition', desc: 'Pie with a hole', slots: [TEXT1('cat', 'Category'), VAL1], agg: true, glyph: '<circle class="m" cx="20" cy="14" r="9" stroke-width="5" opacity=".45"/><path d="M20 5a9 9 0 0 1 8.6 11.7" stroke-width="5"/>', build: c => buildPie(c, 'donut') },
    { id: 'rose', label: 'Rose', group: 'Composition', desc: 'Slices sized by radius', slots: [TEXT1('cat', 'Category'), VAL1], agg: true, glyph: '<path class="f" d="M20 14V2a12 12 0 0 1 12 12z"/><path class="f2" d="M20 14h8a8 8 0 0 1-8 8zM20 14v6a6 6 0 0 1-6-6zM20 14h-10a10 10 0 0 1 10-10z"/>', build: c => buildPie(c, 'rose') },
    { id: 'treemap', label: 'Treemap', group: 'Composition', desc: 'Nested shares as boxes', slots: [sl('levels', 'Levels', ['text'], { max: 3, req: true }), VAL1], glyph: '<path class="f" d="M3 3h20v14H3z"/><path class="f2" d="M24 3h13v8H24zM24 12h13v13H24zM3 18h9v7H3zM13 18h10v7H13z"/>', build: c => buildTree(c, false) },
    { id: 'sunburst', label: 'Sunburst', group: 'Composition', desc: 'Nested shares as rings', slots: [sl('levels', 'Levels', ['text'], { max: 3, req: true }), VAL1], glyph: '<circle class="f" cx="20" cy="14" r="5"/><path class="f2" d="M20 3a11 11 0 0 1 11 11h-4a7 7 0 0 0-7-7zM9 14a11 11 0 0 1 11-11v4a7 7 0 0 0-7 7z"/><path class="m" d="M20 25a11 11 0 0 0 11-11"/>', build: c => buildTree(c, true) },
    { id: 'funnel', label: 'Funnel', group: 'Composition', desc: 'Drop-off between stages', slots: [TEXT1('cat', 'Stage'), VAL1], agg: true, glyph: '<path class="f" d="M4 3h32l-4 6H8z"/><path class="f2" d="M9 10h22l-4 6H13zM14 17h12l-3 7h-6z"/>', build: buildFunnel },
    // Flow
    { id: 'sankey', label: 'Sankey', group: 'Flow', desc: 'Amounts flowing between stages', slots: [TEXT1('source', 'From'), TEXT1('target', 'To'), VAL1], glyph: '<path class="f" d="M3 3h4v12H3zM33 3h4v8h-4zM33 14h4v11h-4z"/><path class="f2" d="M7 3c14 0 12 0 26 0v8C19 11 21 15 7 15zM7 11c14 0 12 3 26 3v11C19 25 21 15 7 15z"/>', build: c => buildFlow(c, 'sankey') },
    { id: 'chord', label: 'Chord', group: 'Flow', desc: 'Flows between groups in a circle', slots: [TEXT1('source', 'From'), TEXT1('target', 'To'), VAL1], glyph: '<circle class="m" cx="20" cy="14" r="11"/><path class="f2" d="M11 8c6 4 12 4 18 0-2 6-2 10 0 14-6-4-12-4-18 0 2-5 2-9 0-14z"/>', build: c => buildFlow(c, 'chord') },
    { id: 'graph', label: 'Network', group: 'Flow', desc: 'Links between names', slots: [TEXT1('source', 'From'), TEXT1('target', 'To'), VAL1], glyph: '<path class="m" d="M9 8l11 6 11-8M20 14l-8 9M20 14l10 8"/>' + dots([[9, 8, 2.6], [20, 14, 3.2], [31, 6, 2.4], [12, 23, 2.2], [30, 22, 2.6]]), build: c => buildFlow(c, 'graph') },
    // Matrix & signal
    { id: 'heatmap', label: 'Heatmap', group: 'Matrix & signal', desc: 'A value for each pair of categories', slots: [sl('x', 'Columns of', ['text', 'num'], { req: true }), sl('cat', 'Rows of', ['text'], { req: true }), VAL1], agg: true, glyph: '<path class="f" d="M4 3h8v7H4zM20 10h8v7h-8zM28 17h8v8h-8zM12 17h8v8h-8z"/><path class="f2" d="M12 3h8v7h-8zM28 3h8v7h-8zM4 10h8v7H4zM4 17h8v8H4zM20 17h8v8h-8zM12 10h8v7h-8zM20 3h8v7h-8zM28 10h8v7h-8z"/>', build: buildHeatmap },
    { id: 'spectrum', label: 'Spectrum', group: 'Matrix & signal', desc: 'Latest array value by bin', slots: [sl('spec', 'Spectrum', ['array'], { max: 4, req: true })], cart: true, glyph: '<path d="M3 23h5l2-1 3-16 3 16 3 1h4l2-8 2 8h10"/>', build: buildSpectrum },
    { id: 'spectrogram', label: 'Spectrogram', group: 'Matrix & signal', desc: 'Spectrum history as a heatmap', slots: [sl('spec', 'Spectrum', ['array'], { req: true })], glyph: '<path class="f2" d="M4 3h32v22H4z"/><path class="f" d="M4 10h32v3H4zM4 17h32v2H4z"/>', build: buildSpectrogram },
    { id: 'calendar', label: 'Calendar heatmap', group: 'Matrix & signal', desc: 'Daily totals on a calendar', slots: [sl('x', 'Date', ['time'], { req: true }), VAL1], agg: true, glyph: '<path class="f2" d="M4 4h6v6H4zM11 4h6v6h-6zM25 4h6v6h-6zM4 11h6v6H4zM18 11h6v6h-6zM25 11h6v6h-6zM11 18h6v6h-6z"/><path class="f" d="M18 4h6v6h-6zM11 11h6v6h-6zM4 18h6v6H4zM18 18h6v6h-6zM32 11h5v6h-5z"/>', build: buildCalendar },
    // Finance & uncertainty
    { id: 'candlestick', label: 'Candlestick', group: 'Finance & uncertainty', desc: 'Open, high, low, close per row', slots: [X, NUMR('open', 'Open'), NUMR('high', 'High'), NUMR('low', 'Low'), NUMR('close', 'Close')], glyph: '<path d="M9 3v22M20 6v18M31 4v19"/><rect class="f" x="6" y="8" width="6" height="10"/><rect class="f2" x="17" y="10" width="6" height="8"/><rect class="f" x="28" y="7" width="6" height="12"/>', build: buildCandle },
    { id: 'errorBars', label: 'Error bars', group: 'Finance & uncertainty', desc: 'Values with ± error', slots: [X, sl('y', 'Y', ['num'], { req: true }), NUMR('err', '± Error')], cart: true, glyph: '<path d="M8 6v10M5 6h6M5 16h6M20 10v10M17 10h6M17 20h6M32 4v8M29 4h6M29 12h6"/>' + dots([[8, 11, 2], [20, 15, 2], [32, 8, 2]]), build: c => buildErr(c, false) },
    { id: 'errorBand', label: 'Error band', group: 'Finance & uncertainty', desc: 'Line with a shaded ± band', slots: [X, sl('y', 'Y', ['num'], { req: true }), NUMR('err', '± Error')], cart: true, glyph: '<path class="f2" d="M3 16l10-8 10 4 14-9v9l-14 8-10-4L3 24z"/><path d="M3 20l10-6 10 4 14-9"/>', build: c => buildErr(c, true) },
    // Polar & gauges
    { id: 'polar', label: 'Polar', group: 'Polar & gauges', desc: 'Angle and radius, like phase and gain', slots: [NUMR('angle', 'Angle (degrees)'), sl('y', 'Radius', ['num'], { req: true }), COLOR], glyph: '<circle class="m" cx="20" cy="14" r="11"/><circle class="m" cx="20" cy="14" r="6"/>' + dots([[25, 8], [28, 13], [14, 18], [22, 20], [16, 9]]), build: buildPolar },
    { id: 'gauge', label: 'Gauge', group: 'Polar & gauges', desc: 'The latest value on a dial', slots: [sl('y', 'Value', ['num'], { req: true })], glyph: '<path class="m" d="M6 22a14 14 0 0 1 28 0" stroke-width="3"/><path d="M6 22a14 14 0 0 1 19-13" stroke-width="3"/><path d="M20 22l6-8"/>', build: buildGauge },
    { id: 'kpi', label: 'Big number', group: 'Polar & gauges', desc: 'Latest value with a sparkline', slots: [sl('y', 'Value', ['num'], { req: true })], glyph: '<text x="4" y="17" font-size="14" font-weight="700" class="f" font-family="monospace">42.1</text><path d="M4 24l6-2 6 1 6-3 6 1 8-3"/>', build: buildKpi },
    // 3D
    { id: 'surface', label: '3D surface', group: '3D', desc: 'A value over a 2D grid, or spectrum history', slots: [sl('z', 'Height (number or spectrum)', ['num', 'array'], { req: true }), sl('x', 'X (for numbers)', ['num']), sl('y', 'Y (for numbers)', ['num'])], gl: true, glyph: '<path class="m" d="M4 18l12-7 20 4-12 8z"/><path d="M4 18c4-6 8-2 12-7s12 2 20 4M10 15l18 5M16 11l12 9"/>', build: buildSurface },
    { id: 'scatter3d', label: '3D scatter', group: '3D', desc: 'Three numbers per point', slots: [sl('x', 'X', ['num'], { req: true }), sl('y', 'Y', ['num'], { req: true }), sl('z', 'Z', ['num'], { req: true }), COLOR], gl: true, glyph: '<path class="m" d="M8 22V4M8 22l24 0M8 22l-5 4"/>' + dots([[14, 12], [20, 16], [25, 9], [29, 14], [17, 7]]), build: buildScatter3d },
    { id: 'bar3d', label: '3D bar', group: '3D', desc: 'A value for each pair of categories', slots: [sl('x', 'X', ['text'], { req: true }), sl('cat', 'Y', ['text'], { req: true }), sl('z', 'Height', ['num'])], gl: true, agg: true, glyph: '<path class="f" d="M8 24V12l4-2v12zM18 22V6l4-2v16zM28 24V14l4-2v10z"/><path class="f2" d="M4 22V14l4-2v12zM14 24V10l4-2v14zM24 22V9l4-2v15z"/>', build: buildBar3d },
    // Other
    { id: 'map', label: 'Map', group: 'Other', desc: 'Points by latitude and longitude, on world outlines', slots: [NUMR('lat', 'Latitude'), NUMR('lon', 'Longitude'), sl('y', 'Size by', ['num']), COLOR], glyph: '<path class="f2" d="M6 8c3-3 8-3 10 0s6 4 9 2 8-2 9 3-4 7-8 6-6 3-10 2-7-4-9-7-3-4-1-6z"/>' + dots([[14, 12, 2], [26, 15, 2]]), build: buildMap },
    { id: 'custom', label: 'Custom (ECharts)', group: 'Other', desc: 'Write any ECharts option; columns come in as a dataset', slots: [], custom: true, glyph: '<path d="M13 5c-3 0-4 1-4 4v2c0 2-1 3-3 3 2 0 3 1 3 3v2c0 3 1 4 4 4M27 5c3 0 4 1 4 4v2c0 2 1 3 3 3-2 0-3 1-3 3v2c0 3-1 4-4 4"/>', build: buildCustom },
);

export { TYPES, TYPE_LIST, GROUPS, glyph } from './registry';
