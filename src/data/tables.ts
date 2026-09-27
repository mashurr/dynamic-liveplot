// Files that hold tables: SQLite databases, Parquet files and Excel workbooks.

import * as fs from 'node:fs';
import * as path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import * as XLSX from 'xlsx';
import type { TableInfo } from './protocol';
import type { Flat } from './json';

let sqlJs: Promise<SqlJsStatic> | null = null;
const sql = () => (sqlJs ??= initSqlJs({ locateFile: (f: string) => path.join(__dirname, f) }));
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function open(file: string, SQL: SqlJsStatic): Database {
    const bytes = fs.readFileSync(file);
    if (bytes.length >= 16 && bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3') { throw new Error(`${path.basename(file)} isn't a SQLite database.`); }
    return new SQL.Database(bytes);
}

/** Plain JavaScript values: BigInt to number, blobs to a size note. */
function plain(v: unknown): unknown {
    if (typeof v === 'bigint') { return Number(v); }
    if (v instanceof Uint8Array) { return `<${v.length} bytes>`; }
    return v;
}

export async function sqliteTables(file: string): Promise<TableInfo[]> {
    const db = open(file, await sql());
    try {
        const res = db.exec(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`);
        const names = (res[0]?.values ?? []).map(r => String(r[0]));
        return names.map(name => {
            let rows = 0, columns = 0;
            try { rows = Number(db.exec(`SELECT count(*) FROM ${quote(name)}`)[0]?.values[0][0] ?? 0); } catch { /* unreadable view */ }
            try { columns = db.exec(`PRAGMA table_info(${quote(name)})`)[0]?.values.length ?? 0; } catch { /* unknown */ }
            return { name, rows, columns };
        });
    } finally { db.close(); }
}

/** Rows added after `afterRowid` (every row when the table has no rowid). */
export async function sqliteRows(file: string, table: string, afterRowid: number): Promise<{ rows: Flat[]; lastRowid: number; hasRowid: boolean }> {
    const db = open(file, await sql());
    try {
        let stmt, hasRowid = true;
        try { stmt = db.prepare(`SELECT rowid AS "__rowid__", * FROM ${quote(table)} WHERE rowid > ? ORDER BY rowid`); stmt.bind([afterRowid]); }
        catch { hasRowid = false; stmt = db.prepare(`SELECT * FROM ${quote(table)}`); }
        const rows: Flat[] = [];
        let last = afterRowid;
        while (stmt.step()) {
            const o = stmt.getAsObject() as Record<string, unknown>;
            if (hasRowid) { last = Number(o.__rowid__); delete o.__rowid__; }
            for (const k of Object.keys(o)) { o[k] = plain(o[k]); }
            rows.push(o);
        }
        stmt.free();
        return { rows, lastRowid: last, hasRowid };
    } finally { db.close(); }
}

export async function parquetInfo(file: string): Promise<TableInfo[]> {
    const buf = await asyncBufferFromFile(file);
    const meta = await parquetMetadataAsync(buf);
    return [{ name: path.basename(file), rows: Number(meta.num_rows), columns: meta.schema.length - 1 }];
}

/** Reads a Parquet file in chunks, calling back with each batch of rows and the share read so far. */
export async function parquetRows(file: string, onRows: (rows: Flat[], done: number) => void, chunk = 50000, from = 0, to = Infinity) {
    const buf = await asyncBufferFromFile(file);
    const meta = await parquetMetadataAsync(buf);
    const total = Math.min(Number(meta.num_rows), to);
    for (let start = from; start < total; start += chunk) {
        const rows = await parquetReadObjects({ file: buf, metadata: meta, compressors, rowStart: start, rowEnd: Math.min(total, start + chunk) });
        onRows(rows.map(r => { const o: Flat = {}; for (const [k, v] of Object.entries(r)) { o[k] = plain(v); } return o; }), Math.min(1, (start + chunk - from) / (total - from)));
    }
}

function workbook(file: string) {
    return XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true, dense: true });
}

export function excelSheets(file: string): TableInfo[] {
    const wb = workbook(file);
    return wb.SheetNames.map(name => {
        const ws = wb.Sheets[name], ref = ws['!ref'];
        const r = ref ? XLSX.utils.decode_range(ref) : null;
        return { name, rows: r ? Math.max(0, r.e.r - r.s.r) : 0, columns: r ? r.e.c - r.s.c + 1 : 0 };
    });
}

/** A sheet's rows, using its first non-empty row as the header. */
export function excelRows(file: string, sheet: string): Flat[] {
    const wb = workbook(file), ws = wb.Sheets[sheet];
    if (!ws) { throw new Error(`There's no sheet called "${sheet}" in ${path.basename(file)}.`); }
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
    // The header is the first row filled at least half as wide as the widest of the first rows,
    // so a title or notes above the table are skipped
    const filled = (r: unknown[]) => r.filter(v => v !== null && v !== '').length;
    const widest = Math.max(0, ...grid.slice(0, 20).map(filled));
    const h = grid.findIndex(r => filled(r) >= Math.max(1, Math.ceil(widest / 2)));
    if (h < 0) { return []; }
    const seen = new Map<string, number>();
    const names = grid[h].map((v, i) => {
        let n = v === null || v === '' ? `column ${i + 1}` : String(v).trim();
        const k = seen.get(n) ?? 0;
        seen.set(n, k + 1);
        if (k) { n = `${n} (${k + 1})`; }
        return n;
    });
    return grid.slice(h + 1).map(r => Object.fromEntries(names.map((n, i) => [n, r[i] ?? null])));
}
