// Chart types described as data: which slots each has, what column kinds fill them, and how it draws.

import type { Kind } from '../../src/data/protocol';
import type { Built, Ctx } from './ctx';

export interface Slot {
    id: string;
    label: string;
    kinds: Kind[];
    max: number;
    req: boolean;
    min?: number;
    hint?: string;
}

export interface ChartType {
    id: string;
    label: string;
    group: string;
    desc: string;
    slots: Slot[];
    /** Cartesian x/y chart: log axes, right axis, limits, shading and linked zoom apply. */
    cart?: boolean;
    /** Has a "summarise each category by" option. */
    agg?: boolean;
    bins?: boolean;
    gl?: boolean;
    custom?: boolean;
    later?: string;
    glyph: string;
    build: (ctx: Ctx) => Built;
}

export const sl = (id: string, label: string, kinds: Kind[], o: Partial<Slot> = {}): Slot => ({ id, label, kinds, max: 1, req: false, ...o });
export const X = sl('x', 'X axis', ['num', 'time'], { hint: 'Row number when empty' });
export const XR = sl('x', 'X axis', ['num', 'time'], { req: true });
export const Y = sl('y', 'Y values', ['num'], { max: 8, req: true });
export const SPLIT = sl('split', 'Split by', ['text'], { hint: 'One series per value' });
export const SHADE = sl('shade', 'Shade phases of', ['text'], { hint: 'Shades each stretch of the same value' });

export const GROUPS = ['Trend', 'Compare', 'Distribution', 'Relationship', 'Composition', 'Flow', 'Matrix & signal', 'Finance & uncertainty', 'Polar & gauges', '3D', 'Other'];
export const dots = (pts: number[][]) => pts.map(([x, y, r = 1.7]) => `<circle class="f" cx="${x}" cy="${y}" r="${r}"/>`).join('');

export const TYPE_LIST: ChartType[] = [];
export const TYPES: Record<string, ChartType> = {};

export function register(...types: ChartType[]) {
    for (const t of types) { TYPE_LIST.push(t); TYPES[t.id] = t; }
    TYPE_LIST.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
}

export const glyph = (id: string) => `<svg class="gl" viewBox="0 0 40 28" aria-hidden="true">${TYPES[id]?.glyph ?? ''}</svg>`;
