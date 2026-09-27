// Working out what kind of values a column holds, and turning raw cells into those values.
// Raw cells are strings for CSV and whatever JSON produced for JSON and JSON Lines.

import type { Kind } from './protocol';

const EMPTY = new Set(['', 'none', 'null', 'nan', 'na', 'n/a', '-']);
const TIME_NAME = /(^|[_ .-])(time|timestamp|ts|date|datetime|epoch|when)$|^(time|timestamp|ts|date|datetime|epoch)([_ .-]|$)/i;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
const EPOCH_S: [number, number] = [9.46e8, 4.1e9]; // 2000 to 2099
const EPOCH_MS: [number, number] = [9.46e11, 4.1e12];

export function isEmpty(raw: unknown): boolean {
    if (raw === null || raw === undefined) { return true; }
    if (typeof raw === 'string') { return EMPTY.has(raw.trim().toLowerCase()); }
    if (typeof raw === 'number') { return Number.isNaN(raw); }
    if (raw instanceof Date) { return Number.isNaN(raw.getTime()); }
    return false;
}

/** A number, or NaN for anything that isn't one. */
export function toNum(raw: unknown): number {
    if (typeof raw === 'number') { return raw; }
    if (typeof raw === 'boolean') { return raw ? 1 : 0; }
    if (typeof raw !== 'string' || raw.length === 0) { return NaN; }
    const fast = +raw;
    if (fast === fast && (fast !== 0 || raw.trim() !== '')) { return fast; }
    const s = raw.trim();
    if (!s) { return NaN; }
    const l = s.toLowerCase();
    if (l === 'inf' || l === '+inf' || l === 'infinity') { return Infinity; }
    if (l === '-inf' || l === '-infinity') { return -Infinity; }
    return NaN;
}

function numLike(raw: unknown): boolean {
    if (typeof raw === 'number' || typeof raw === 'boolean') { return true; }
    if (typeof raw !== 'string') { return false; }
    return !Number.isNaN(toNum(raw)) || /^[+-]?(inf|infinity)$/i.test(raw.trim());
}

/** Seconds since the epoch. `scale` converts numeric cells (1 for seconds, 0.001 for milliseconds). */
export function toTime(raw: unknown, scale: number): number {
    if (raw instanceof Date) { return raw.getTime() / 1000; }
    if (typeof raw === 'number') { return raw * scale; }
    if (typeof raw !== 'string') { return NaN; }
    const s = raw.trim();
    if (!s) { return NaN; }
    const n = Number(s);
    if (!Number.isNaN(n)) { return n * scale; }
    const t = Date.parse(s.length > 10 && s[10] === ' ' ? s.slice(0, 10) + 'T' + s.slice(11) : s);
    return Number.isNaN(t) ? NaN : t / 1000;
}

export function toText(raw: unknown): string | null {
    if (isEmpty(raw)) { return null; }
    if (typeof raw === 'string') { return raw; }
    if (raw instanceof Date) { return raw.toISOString(); }
    if (typeof raw === 'object') { return JSON.stringify(raw); }
    return String(raw);
}

/** A list of numbers: a JSON array, or a "[1, 2, 3]" cell. Null if it isn't one. */
export function toArray(raw: unknown): Float64Array | null {
    if (raw instanceof Float64Array) { return raw; }
    if (Array.isArray(raw)) {
        if (!raw.every(v => typeof v === 'number' || v === null)) { return null; }
        return Float64Array.from(raw, v => (v === null ? NaN : v));
    }
    if (typeof raw !== 'string') { return null; }
    const s = raw.trim();
    if (s.length < 2 || s[0] !== '[' || s[s.length - 1] !== ']') { return null; }
    const inner = s.slice(1, -1).trim();
    if (!inner) { return new Float64Array(0); }
    const parts = inner.includes(',') ? inner.split(',') : inner.split(/[\s;]+/);
    const out = new Float64Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
        let v = +parts[i];
        if (Number.isNaN(v)) {
            v = toNum(parts[i]);
            if (Number.isNaN(v) && !isEmpty(parts[i])) { return null; }
        }
        out[i] = v;
    }
    return out;
}

/** A dictionary cell like {"ch": "A"} or Python's {'ch': 'A'}. */
export function toBindings(raw: unknown): Record<string, string> | null {
    let obj: unknown = raw;
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (s[0] !== '{' || s[s.length - 1] !== '}') { return null; }
        try { obj = JSON.parse(s); } catch {
            try { obj = JSON.parse(s.replace(/'/g, '"')); } catch { return null; }
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { return null; }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (v !== null && v !== undefined) { out[k] = String(v); }
    }
    return out;
}

export interface Detected {
    kind: Kind;
    /** For time columns stored as numbers: 1 for seconds, 0.001 for milliseconds. */
    scale: number;
}

function inRange(v: number, [lo, hi]: [number, number]): boolean { return v >= lo && v <= hi; }

/** Decide a column's kind from sample cells. A column with no values yet counts as numbers. */
export function detectKind(name: string, samples: unknown[]): Detected {
    const vals = samples.filter(v => !isEmpty(v));
    if (!vals.length) { return { kind: 'num', scale: 1 }; }
    if (vals.every(v => toArray(v) !== null) && vals.some(v => Array.isArray(v) || (typeof v === 'string' && v.trim().startsWith('[')))) {
        return { kind: 'array', scale: 1 };
    }
    if (vals.every(v => v instanceof Date)) { return { kind: 'time', scale: 1 }; }
    if (vals.every(numLike)) {
        if (TIME_NAME.test(name)) {
            const nums = vals.map(toNum).filter(Number.isFinite);
            if (nums.length && nums.every(v => inRange(v, EPOCH_S))) { return { kind: 'time', scale: 1 }; }
            if (nums.length && nums.every(v => inRange(v, EPOCH_MS))) { return { kind: 'time', scale: 0.001 }; }
        }
        return { kind: 'num', scale: 1 };
    }
    if (vals.every(v => typeof v === 'string' && DATE_TEXT.test(v.trim()) && !Number.isNaN(toTime(v, 1)))) {
        return { kind: 'time', scale: 1 };
    }
    return { kind: 'text', scale: 1 };
}

/** Whether a cell still fits a column of this kind (used to widen a number column to text). */
export function fits(kind: Kind, raw: unknown): boolean {
    if (isEmpty(raw)) { return true; }
    switch (kind) {
        case 'num': return numLike(raw);
        case 'time': return raw instanceof Date || !Number.isNaN(toTime(raw, 1));
        case 'array': return toArray(raw) !== null;
        default: return true;
    }
}
