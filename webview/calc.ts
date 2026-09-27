// Formulas for calculated columns, e.g. `idd_mA * vdd_V` or `sqrt([imu.ax]^2 + [imu.ay]^2)`.
// Parsed into closures (never evaluated as code), so they're safe in untrusted workspaces.

export type Getter = (col: string) => number;
export interface Compiled { run: (get: Getter) => number; deps: string[] }

const FUNCS: Record<string, (...a: number[]) => number> = {
    abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    min: Math.min, max: Math.max, pow: Math.pow, round: Math.round, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
    hypot: Math.hypot, db: (x: number) => 10 * Math.log10(x), clamp: (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x)),
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
export const FUNCTION_NAMES = Object.keys(FUNCS);

type Tok = { t: 'num' | 'name' | 'op'; v: string; at: number };

function lex(src: string): Tok[] {
    const out: Tok[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }
        const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
        if (num) { out.push({ t: 'num', v: num[0], at: i }); i += num[0].length; continue; }
        if (c === '[') {
            const end = src.indexOf(']', i);
            if (end < 0) { throw new Error(`A column name started at ${i + 1} with [ has no closing ].`); }
            out.push({ t: 'name', v: src.slice(i + 1, end), at: i }); i = end + 1; continue;
        }
        const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
        if (name) { out.push({ t: 'name', v: name[0], at: i }); i += name[0].length; continue; }
        if ('+-*/^%(),'.includes(c)) { out.push({ t: 'op', v: c, at: i }); i++; continue; }
        throw new Error(`"${c}" at position ${i + 1} isn't allowed in a formula.`);
    }
    return out;
}

/** Compile a formula. `has` says whether a column exists (so typos are reported up front). */
export function compile(src: string, has: (col: string) => boolean): Compiled {
    const toks = lex(src), deps = new Set<string>();
    let i = 0;
    const peek = () => toks[i];
    const expect = (v: string) => { const t = toks[i++]; if (!t || t.v !== v) { throw new Error(`Expected "${v}"${t ? ` at position ${t.at + 1}` : ' at the end'}.`); } };
    type Node = (g: Getter) => number;
    const expr = (): Node => {
        let left = term();
        while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
            const op = toks[i++].v, l = left, r = term();
            left = op === '+' ? g => l(g) + r(g) : g => l(g) - r(g);
        }
        return left;
    };
    const term = (): Node => {
        let left = unary();
        while (peek()?.t === 'op' && '*/%'.includes(peek().v)) {
            const op = toks[i++].v, l = left, r = unary();
            left = op === '*' ? g => l(g) * r(g) : op === '/' ? g => l(g) / r(g) : g => l(g) % r(g);
        }
        return left;
    };
    const unary = (): Node => {
        if (peek()?.t === 'op' && peek().v === '-') { i++; const x = unary(); return g => -x(g); }
        if (peek()?.t === 'op' && peek().v === '+') { i++; return unary(); }
        return power();
    };
    const power = (): Node => {
        const base = primary();
        if (peek()?.t === 'op' && peek().v === '^') { i++; const ex = unary(); return g => Math.pow(base(g), ex(g)); }
        return base;
    };
    const primary = (): Node => {
        const t = toks[i++];
        if (!t) { throw new Error('The formula ends too early.'); }
        if (t.t === 'num') { const v = Number(t.v); return () => v; }
        if (t.t === 'op' && t.v === '(') { const x = expr(); expect(')'); return x; }
        if (t.t === 'name') {
            if (peek()?.t === 'op' && peek().v === '(' && FUNCS[t.v.toLowerCase()]) {
                i++;
                const args: Node[] = [];
                if (!(peek()?.t === 'op' && peek().v === ')')) {
                    args.push(expr());
                    while (peek()?.t === 'op' && peek().v === ',') { i++; args.push(expr()); }
                }
                expect(')');
                const f = FUNCS[t.v.toLowerCase()];
                return g => f(...args.map(a => a(g)));
            }
            if (has(t.v)) { deps.add(t.v); const name = t.v; return g => g(name); }
            if (t.v.toLowerCase() in CONSTS) { const v = CONSTS[t.v.toLowerCase()]; return () => v; }
            throw new Error(`There's no column called "${t.v}". Put names with spaces or symbols in [brackets].`);
        }
        throw new Error(`"${t.v}" at position ${t.at + 1} isn't expected here.`);
    };
    if (!toks.length) { throw new Error('Type a formula, for example idd_mA * vdd_V.'); }
    const root = expr();
    if (i < toks.length) { throw new Error(`"${toks[i].v}" at position ${toks[i].at + 1} isn't expected here.`); }
    return { run: root, deps: [...deps] };
}
