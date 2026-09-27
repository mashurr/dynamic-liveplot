// Streaming CSV: records come out only once they are complete, so a line that is still
// being written (or a quoted cell spanning lines) is held back until the rest arrives.

const QUOTE = 34, NL = 10;
const CANDIDATES = [',', '\t', ';', '|'];

export class CsvTokenizer {
    private field = '';
    private record: string[] = [];
    private inQuotes = false;
    private quoteAtEnd = false;
    private readonly delim: number;

    constructor(readonly delimiter: string) { this.delim = delimiter.charCodeAt(0); }

    /** True while a record has started but not finished. */
    get pending(): boolean { return this.inQuotes || this.field !== '' || this.record.length > 0; }

    feed(chunk: string, out: string[][]) {
        const n = chunk.length, D = this.delim;
        let i = 0, start = 0;
        if (this.quoteAtEnd) {
            this.quoteAtEnd = false;
            if (n && chunk.charCodeAt(0) === QUOTE) { this.field += '"'; i = start = 1; } else { this.inQuotes = false; }
        }
        while (i < n) {
            // Fast path: a whole line without quotes splits natively in one call
            if (!this.inQuotes && i === start && this.field === '' && this.record.length === 0) {
                const nl = chunk.indexOf('\n', i);
                const q = nl < 0 ? 0 : chunk.indexOf('"', i);
                if (nl >= 0 && (q < 0 || q > nl)) {
                    const end = nl > i && chunk.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
                    if (end > i) { out.push(chunk.slice(i, end).split(this.delimiter)); }
                    i = start = nl + 1;
                    continue;
                }
            }
            const c = chunk.charCodeAt(i);
            if (this.inQuotes) {
                if (c !== QUOTE) { const q = chunk.indexOf('"', i); i = q < 0 ? n : q; continue; }
                this.field += chunk.slice(start, i);
                if (i + 1 >= n) { this.quoteAtEnd = true; i++; start = i; continue; }
                if (chunk.charCodeAt(i + 1) === QUOTE) { this.field += '"'; i += 2; } else { this.inQuotes = false; i++; }
                start = i;
                continue;
            }
            if (c === D) {
                this.record.push(this.field + chunk.slice(start, i));
                this.field = ''; i++; start = i;
            } else if (c === NL) {
                let f = this.field + chunk.slice(start, i);
                if (f.charCodeAt(f.length - 1) === 13) { f = f.slice(0, -1); }
                this.record.push(f);
                if (this.record.length > 1 || this.record[0] !== '') { out.push(this.record); }
                this.record = []; this.field = ''; i++; start = i;
            } else if (c === QUOTE && i === start && this.field === '') {
                this.inQuotes = true; i++; start = i;
            } else {
                i++;
            }
        }
        this.field += chunk.slice(start, n);
    }
}

/** Count delimiters outside quotes on each complete line of a sample. */
function counts(sample: string, d: string): number[] {
    const out: number[] = [];
    let n = 0, q = false;
    for (let i = 0; i < sample.length; i++) {
        const c = sample[i];
        if (c === '"') { q = !q; } else if (!q && c === d) { n++; } else if (!q && c === '\n') { out.push(n); n = 0; if (out.length >= 30) { break; } }
    }
    return out;
}

/** Pick the delimiter whose count is the same on most lines. Commas win ties. */
export function sniffDelimiter(sample: string, fileName: string): string {
    if (/\.tsv$/i.test(fileName)) { return '\t'; }
    let best = ',', bestScore = -1;
    for (const d of CANDIDATES) {
        const c = counts(sample, d);
        if (!c.length || c[0] === 0) { continue; }
        const same = c.filter(x => x === c[0]).length / c.length;
        const score = same * 1000 + Math.min(c[0], 50);
        if (same >= 0.8 && score > bestScore) { best = d; bestScore = score; }
    }
    return best;
}

/** Column names from a header record: blanks get a name, repeats get a number. */
export function headerNames(record: string[]): string[] {
    const seen = new Map<string, number>();
    return record.map((raw, i) => {
        let name = raw.trim() || `column ${i + 1}`;
        const n = seen.get(name) ?? 0;
        seen.set(name, n + 1);
        if (n) { name = `${name} (${n + 1})`; }
        return name;
    });
}

/** A first line made only of numbers is data, not a header. */
export function looksHeaderless(record: string[]): boolean {
    return record.length > 1 && record.every(c => c.trim() !== '' && !Number.isNaN(Number(c.trim())));
}
