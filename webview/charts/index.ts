// Registers every chart type.

import { buildBars, buildRadar, buildWaterfall } from './compare';
import { buildBox, buildDensity, buildHist, buildStrip, buildViolin } from './distribution';
import { register, sl, dots, SHADE, SPLIT, X, XR, Y } from './registry';
import { buildCorr, buildDensity2d, buildMatrix, buildParallel, buildScatter } from './relationship';
import { buildCart, buildStream } from './trend';

const CAT = sl('cat', 'Category', ['text', 'num', 'time'], { hint: 'Row number when empty' });
const VALS = sl('y', 'Values', ['num'], { max: 6, hint: 'Counts rows when empty' });
const DIST = sl('y', 'Values', ['num'], { max: 6, req: true });
const GROUP = sl('group', 'Group by', ['text']);
const COLOR = sl('split', 'Colour by', ['text']);

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
);

export { TYPES, TYPE_LIST, GROUPS, glyph } from './registry';
