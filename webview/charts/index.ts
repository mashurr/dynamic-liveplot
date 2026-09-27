// Registers every chart type.

import { register, SHADE, SPLIT, X, Y } from './registry';
import { buildCart } from './trend';

register(
    { id: 'line', label: 'Line', group: 'Trend', desc: 'Numbers over rows or time', slots: [X, Y, SPLIT, SHADE], cart: true, glyph: '<path d="M3 22l8-9 7 5 8-11 11 6"/>', build: c => buildCart(c, 'line') },
);

export { TYPES, TYPE_LIST, GROUPS, glyph } from './registry';
