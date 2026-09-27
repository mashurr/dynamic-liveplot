// One open source: a file, or the newest file in a folder. Reads what's there, keeps
// tailing it, and posts schema, row deltas and status to the extension host.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CsvTokenizer, headerNames, looksHeaderless, SKIPPED, sniffDelimiter } from './csv';
import { detectKind, isEmpty, toArray, toBindings, toNum, toText, toTime, type Detected } from './detect';
import { FolderWatch } from './folder';
import { flatten, jsonRows } from './json';
import type { Format, FromWorker, OpenOptions, SchemaReason, SourceSpec } from './protocol';
import { Store, type Cell } from './store';
import { Tail } from './tail';
import { excelRows, excelSheets, parquetInfo, parquetRows, sqliteRows, sqliteTables } from './tables';

const TABLE_POLL_MS = 1000;

const DETECT_ROWS = 200;
const WIDEN_ROWS = 5000;
const FLUSH_MS = 50;
const STATUS_MS = 500;
const IDLE_POLL_MS = 100;
const CHECK_MS = 500;
const SLICE_MS = 40;
const MAX_JSON_BYTES = 512 * 1024 * 1024;

export function formatOf(file: string): Format {
    if (/\.(sqlite|sqlite3|db)$/i.test(file)) { return 'sqlite'; }
    if (/\.parquet$/i.test(file)) { return 'parquet'; }
    if (/\.xlsx$/i.test(file)) { return 'xlsx'; }
    if (/\.(jsonl|ndjson)$/i.test(file)) { return 'jsonl'; }
    if (/\.json$/i.test(file)) { return 'json'; }
    return 'csv';
}

type State = 'waiting' | 'reading' | 'tailing' | 'missing';

export class Source {
    private store: Store;
    private tail: Tail | null = null;
    private file = '';
    private format: Format = 'csv';
    private reason: SchemaReason = 'opened';
    private decoder = new TextDecoder('utf-8');
    private first = true;
    private sniff = '';
    private csv: CsvTokenizer | null = null;
    private names: string[] | null = null;
    private keys = new Map<string, number>();
    private lineRest = '';
    private jsonParts: Buffer[] = [];
    private jsonBytes = 0;
    private detected: (Detected & { col: number })[] = [];
    private bindingCol = -1;
    private bindings: Record<string, string> = {};
    private buffered: unknown[][] = [];
    private ready = false;
    private caughtUp = false;
    private lastGrowth = 0;
    private badLines = 0;
    private progress = 0;
    /** Keep one row in `stride` (an overview of a file too big to keep whole). */
    private stride = 1;
    private fileRows = 0;
    private added = 0;
    private index: { offset: number; row: number }[] = [];
    private state: State = 'waiting';
    private schemaSent = false;
    private timer: NodeJS.Timeout | null = null;
    private flushTimer: NodeJS.Timeout | null = null;
    private statusTimer: NodeJS.Timeout | null = null;
    private lastCheck = 0;
    private watcher: fs.FSWatcher | null = null;
    private folder: FolderWatch | null = null;
    private closed = false;
    private table: string | null = null;
    private lastRowid = 0;
    private tableStamp = '';
    private tableTimer: NodeJS.Timeout | null = null;
    private tableBusy = false;

    constructor(private id: number, private spec: SourceSpec, private options: OpenOptions, private post: (m: FromWorker, transfer?: ArrayBuffer[]) => void) {
        this.store = this.newStore();
    }

    private newStore() { return new Store(this.options.budgetCells, this.options.budgetRows); }

    start() {
        this.statusTimer = setInterval(() => this.postStatus(), STATUS_MS);
        this.postStatus();
        if (this.spec.kind === 'folder') {
            this.folder = new FolderWatch(this.spec.path, f => this.onNewest(f));
            this.folder.start();
            if (!this.file) { this.postStatus(); }
        } else {
            this.openFile(this.spec.path, 'opened');
        }
    }

    resend() {
        if (!this.ready) { return; }
        this.store.resend();
        this.postSchema(this.reason);
        this.postStatus();
    }

    close() {
        this.closed = true;
        this.folder?.stop();
        this.stopFile();
        if (this.statusTimer) { clearInterval(this.statusTimer); }
    }

    private stopFile() {
        this.tail?.close();
        this.watcher?.close();
        this.watcher = null;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
        if (this.tableTimer) { clearInterval(this.tableTimer); this.tableTimer = null; }
    }

    private onNewest(file: string) {
        if (this.tail && this.tail.isOpen && this.tail.isSameFile(file)) { this.followRename(file); return; }
        this.openFile(file, this.file ? 'switched' : 'opened');
    }

    private followRename(to: string) {
        const from = this.file;
        if (!this.tail || to === from) { return; }
        this.tail.path = to;
        this.file = to;
        this.folder?.setCurrent(to);
        this.watchFile();
        this.post({ type: 'renamed', id: this.id, from, to });
    }

    private openFile(file: string, reason: SchemaReason) {
        this.stopFile();
        this.file = file;
        this.format = formatOf(file);
        this.reason = reason;
        this.store = this.newStore();
        this.decoder = new TextDecoder('utf-8');
        this.first = true; this.sniff = ''; this.csv = null; this.names = null;
        this.keys = new Map(); this.lineRest = ''; this.jsonParts = []; this.jsonBytes = 0;
        this.detected = []; this.bindingCol = -1; this.buffered = []; this.ready = false;
        this.caughtUp = false; this.lastGrowth = 0; this.badLines = 0;
        this.stride = 1; this.fileRows = 0; this.added = 0; this.index = [];
        this.table = null; this.lastRowid = 0;
        if (this.format === 'sqlite' || this.format === 'parquet' || this.format === 'xlsx') {
            this.tail = null;
            void this.openTables();
            return;
        }
        this.tail = new Tail(file);
        this.state = 'waiting';
        this.watchFile();
        this.schedule(0);
    }

    private stamp(): string {
        const parts = [this.file, this.file + '-wal'].map(f => { try { const st = fs.statSync(f); return `${st.size}:${st.mtimeMs}`; } catch { return '-'; } });
        return parts.join('|');
    }

    /** Lists the file's tables, then reads the chosen one (or waits for the user to pick). */
    private async openTables() {
        this.setState('reading');
        try {
            const tables = this.format === 'sqlite' ? await sqliteTables(this.file) : this.format === 'parquet' ? await parquetInfo(this.file) : excelSheets(this.file);
            if (this.closed) { return; }
            const wanted = this.spec.kind === 'file' ? this.spec.table : undefined;
            const table = wanted && tables.some(t => t.name === wanted) ? wanted : tables.length === 1 ? tables[0].name : null;
            this.post({ type: 'tables', id: this.id, file: this.file, tables, table });
            if (!tables.length) { this.error(`${path.basename(this.file)} has no ${this.format === 'xlsx' ? 'sheets' : 'tables'} to plot.`); return; }
            if (!table) { this.setState('waiting'); return; }
            this.table = table;
            this.tableStamp = this.stamp();
            await this.readTable();
            if (this.closed) { return; }
            this.atEnd();
            this.tableTimer = setInterval(() => void this.pollTable(), TABLE_POLL_MS);
        } catch (e) {
            this.error(`${path.basename(this.file)} couldn't be read: ${(e as Error).message}`);
            this.setState('missing');
        }
    }

    private async readTable() {
        const table = this.table!;
        if (this.format === 'sqlite') {
            const r = await sqliteRows(this.file, table, this.lastRowid);
            this.lastRowid = r.lastRowid;
            for (const row of r.rows) { this.object(row); }
        } else if (this.format === 'parquet') {
            const info = (await parquetInfo(this.file))[0];
            const keep = this.store.keepFor(info.columns);
            if (info.rows > keep * 1.2) { this.stride = Math.ceil(info.rows / keep); }
            await parquetRows(this.file, (rows, done) => { for (const row of rows) { this.object(row); } this.progress = done; this.scheduleFlush(); });
        } else {
            for (const row of excelRows(this.file, table)) { this.object(row); }
        }
    }

    /** SQLite tables are followed live by reading rows added since the last check; other files reload when they change. */
    private async pollTable() {
        if (this.tableBusy || this.closed) { return; }
        const now = this.stamp();
        if (now === this.tableStamp) { return; }
        this.tableStamp = now;
        this.tableBusy = true;
        try {
            if (this.format === 'sqlite') {
                const r = await sqliteRows(this.file, this.table!, this.lastRowid);
                if (!r.hasRowid) { this.openFile(this.file, 'replaced'); return; }
                if (r.rows.length) {
                    this.lastRowid = r.lastRowid;
                    for (const row of r.rows) { this.object(row); }
                    if (!this.ready) { this.finishDetect(); }
                    this.lastGrowth = Date.now();
                    this.scheduleFlush();
                }
            } else {
                if (this.spec.kind === 'file' && this.table) { this.spec = { ...this.spec, table: this.table }; }
                this.openFile(this.file, 'replaced');
            }
        } catch (e) {
            this.error(`${path.basename(this.file)} couldn't be read: ${(e as Error).message}`);
        } finally { this.tableBusy = false; }
    }

    private watchFile() {
        this.watcher?.close();
        try {
            this.watcher = fs.watch(this.file, () => this.schedule(0));
            this.watcher.on('error', () => { this.watcher?.close(); this.watcher = null; });
        } catch { this.watcher = null; }
    }

    private schedule(ms: number) {
        if (this.closed) { return; }
        if (this.timer) {
            if (ms > 0) { return; }
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => { this.timer = null; this.pump(); }, ms);
    }

    private pump() {
        const tail = this.tail;
        if (!tail || this.closed) { return; }
        if (!tail.isOpen) {
            if (!tail.open()) { this.setState('waiting'); this.schedule(IDLE_POLL_MS * 5); return; }
            this.lastCheck = Date.now();
        }
        const until = Date.now() + SLICE_MS;
        let got = false;
        for (;;) {
            const buf = tail.read();
            if (!buf) { break; }
            got = true;
            this.consume(buf);
            if (Date.now() > until) { break; }
        }
        if (got) {
            if (this.caughtUp) { this.lastGrowth = Date.now(); }
            this.setState('reading');
            this.scheduleFlush();
            this.schedule(0);
            return;
        }
        this.atEnd();
        if (Date.now() - this.lastCheck >= CHECK_MS) { this.lastCheck = Date.now(); if (this.checkFile()) { return; } }
        this.schedule(IDLE_POLL_MS);
    }

    /** Returns true when the file was reopened. */
    private checkFile(): boolean {
        const tail = this.tail!;
        const change = tail.check();
        if (change === 'truncated' || change === 'replaced') {
            if (this.format === 'json' || change === 'truncated' || this.spec.kind === 'file' || this.folder?.newest() === this.file) {
                this.openFile(this.file, change);
                return true;
            }
        }
        if (change === 'missing') {
            const moved = this.findRename();
            if (moved) { this.followRename(moved); } else { this.setState('missing'); }
        } else if (this.format === 'json' && tail.size > tail.position) {
            this.openFile(this.file, 'replaced');
            return true;
        }
        return false;
    }

    private findRename(): string | null {
        const dir = path.dirname(this.file);
        let names: string[];
        try { names = fs.readdirSync(dir); } catch { return null; }
        for (const n of names) { const full = path.join(dir, n); if (full !== this.file && this.tail!.isSameFile(full)) { return full; } }
        return null;
    }

    private atEnd() {
        if (this.format === 'json' && !this.ready) { this.parseJson(); }
        if (this.table === null && this.tail === null) { return; }
        if (!this.ready && (this.buffered.length || this.names)) { this.finishDetect(); }
        this.caughtUp = true;
        this.setState(this.state === 'missing' ? 'missing' : 'tailing');
        this.scheduleFlush();
    }

    private consume(buf: Buffer) {
        if (this.format === 'json') {
            this.jsonBytes += buf.length;
            if (this.jsonBytes > MAX_JSON_BYTES) { this.error(`${path.basename(this.file)} is larger than 512 MB. Save it as JSON Lines to plot it.`); this.tail?.close(); return; }
            this.jsonParts.push(Buffer.from(buf));
            return;
        }
        let text = this.decoder.decode(buf, { stream: true });
        if (this.first) { if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); } this.first = false; }
        if (this.format === 'jsonl') { this.feedLines(text); } else { this.feedCsv(text); }
        this.noteIndex(buf);
        this.decideStride();
    }

    /** Remember where records start, about every megabyte, so a range can be read later without re-reading from the top. */
    private noteIndex(buf: Buffer) {
        if (!this.tail || (this.format === 'csv' && (!this.csv || this.csv.quoted))) { return; }
        const nl = buf.lastIndexOf(10);
        if (nl < 0) { return; }
        const offset = this.tail.position - buf.length + nl + 1, last = this.index[this.index.length - 1];
        if (!last || offset - last.offset >= 1 << 20) { this.index.push({ offset, row: this.fileRows }); }
    }

    /** During the first read, estimate the file's rows; if they won't fit the budget, keep an evenly spaced overview. */
    private decideStride() {
        if (this.stride > 1 || this.caughtUp || !this.tail || this.fileRows < 2000 || !this.ready) { return; }
        const perRow = this.tail.position / this.fileRows, estimate = this.tail.size / perRow, keep = this.store.keep();
        if (estimate > keep * 1.2) { this.setStride(Math.ceil(estimate / keep)); }
    }

    /** Switch to keeping one row in `k`, thinning the rows kept so far to match. */
    private setStride(k: number) {
        const seen = this.store.rows;
        this.store.thin(k);
        this.stride = k;
        this.added = seen;
        this.postSchema('columns');
    }

    /** The estimate was low and the overview is about to overflow: keep every other row and double the stride. */
    private widenStride() {
        const seen = this.added - 1;
        this.store.thin(2);
        this.stride *= 2;
        this.added = seen + 1;
        this.postSchema('columns');
    }

    /** Read every row in [from, to) and send it as detail. */
    async range(from: number, to: number) {
        try {
            const count = Math.max(0, Math.min(to, from + this.store.keep()) - from);
            const detail = new Store(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
            for (const c of this.store.columns) { detail.addColumn(c.name, c.kind); }
            const take = (r: unknown[]) => { detail.append(this.cells(r, detail)); };
            if (this.format === 'parquet') {
                await parquetRows(this.file, rows => { for (const row of rows) { take(this.rawOf(row)); } }, count, from, from + count);
            } else if (this.format === 'csv' || this.format === 'jsonl') {
                await this.readRange(from, count, take);
            } else {
                throw new Error('Detail ranges are only for CSV, JSON Lines and Parquet files.');
            }
            const d = detail.delta(0);
            this.post({ type: 'detail', id: this.id, first: from, count: detail.rows, columns: detail.schema(), deltas: d.columns });
        } catch (e) { this.error(`Couldn't read that range: ${(e as Error).message}`); }
    }

    private rawOf(flat: Record<string, unknown>): unknown[] {
        const arr: unknown[] = [];
        for (const [k, v] of Object.entries(flat)) { const i = this.keys.get(k); if (i !== undefined) { arr[i] = v; } }
        return arr;
    }

    private async readRange(from: number, count: number, take: (r: unknown[]) => void) {
        let start = { offset: 0, row: -1 };
        for (const e of this.index) { if (e.row <= from) { start = e; } else { break; } }
        const fd = fs.openSync(this.file, 'r');
        try {
            const buf = Buffer.allocUnsafe(1 << 20), decoder = new TextDecoder('utf-8');
            const tok = this.format === 'csv' ? new CsvTokenizer(this.csv?.delimiter ?? ',') : null;
            let pos = start.offset, row = start.row, rest = '', got = 0;
            // row -1 means we start at the file's top and must pass the header first
            const handle = (r: unknown[]) => { if (row >= from && got < count) { take(r); got++; } row++; };
            while (got < count) {
                const n = fs.readSync(fd, buf, 0, buf.length, pos);
                if (n <= 0) { break; }
                pos += n;
                let text = decoder.decode(buf.subarray(0, n), { stream: true });
                if (pos === n && text.charCodeAt(0) === 0xfeff) { text = text.slice(1); }
                if (tok) {
                    const recs: string[][] = [];
                    tok.feed(text, recs);
                    for (const r of recs) { if (row === -1 && !looksHeaderless(r)) { row = 0; continue; } if (row === -1) { row = 0; } handle(r); if (got >= count) { break; } }
                } else {
                    const parts = (rest + text).split('\n');
                    rest = parts.pop() ?? '';
                    for (const line of parts) { const t = line.trim(); if (!t) { continue; } if (row === -1) { row = 0; } let v: unknown; try { v = JSON.parse(t); } catch { continue; } handle(this.rawOf(flatten(v))); if (got >= count) { break; } }
                }
            }
        } finally { fs.closeSync(fd); }
    }

    private feedCsv(text: string) {
        if (!this.csv) {
            this.sniff += text;
            if (!this.sniff.includes('\n') && this.sniff.length < 1 << 20) { return; }
            this.csv = new CsvTokenizer(sniffDelimiter(this.sniff, this.file));
            text = this.sniff; this.sniff = '';
        }
        const records: string[][] = [];
        // In an overview, rows that won't be kept are only counted, not split into cells
        let k = this.added;
        this.csv.want = this.stride > 1 && this.ready && this.names ? () => k++ % this.stride === 0 : null;
        this.csv.feed(text, records);
        for (const r of records) {
            if (r === SKIPPED) { this.fileRows++; this.added++; continue; }
            if (!this.names) {
                if (looksHeaderless(r)) { this.names = r.map((_, i) => `column ${i + 1}`); this.row(r); } else { this.names = headerNames(r); }
                continue;
            }
            this.row(r);
        }
    }

    private feedLines(text: string) {
        const parts = (this.lineRest + text).split('\n');
        this.lineRest = parts.pop() ?? '';
        for (const line of parts) {
            const s = line.trim();
            if (!s) { continue; }
            let v: unknown;
            try { v = JSON.parse(s); } catch { this.badLines++; continue; }
            this.object(flatten(v));
        }
    }

    private parseJson() {
        if (!this.jsonParts.length) { return; }
        const text = Buffer.concat(this.jsonParts).toString('utf8').replace(/^﻿/, '');
        this.jsonParts = [];
        let doc: unknown;
        try { doc = JSON.parse(text); } catch (e) { this.error(`${path.basename(this.file)} isn't valid JSON: ${(e as Error).message}`); return; }
        for (const r of jsonRows(doc)) { this.object(r); }
    }

    private object(flat: Record<string, unknown>) {
        const arr: unknown[] = [];
        for (const [k, v] of Object.entries(flat)) {
            let i = this.keys.get(k);
            if (i === undefined) {
                i = this.keys.size;
                this.keys.set(k, i);
                this.names = [...this.keys.keys()];
                if (this.ready) { this.addLateColumn(k, i, v); }
            }
            arr[i] = v;
        }
        this.row(arr);
    }

    private row(r: unknown[]) {
        this.fileRows++;
        if (!this.ready) {
            this.buffered.push(r);
            if (this.buffered.length >= DETECT_ROWS) { this.finishDetect(); }
            return;
        }
        this.addRow(r);
    }

    private finishDetect() {
        const names = this.names ?? [];
        this.detected = [];
        this.bindingCol = -1;
        names.forEach((name, i) => {
            const samples = this.buffered.map(r => r[i]);
            if (/^bindings?$/i.test(name) && samples.some(v => !isEmpty(v)) && samples.every(v => isEmpty(v) || toBindings(v))) { this.bindingCol = i; return; }
            const d = detectKind(name, samples);
            this.detected[i] = { ...d, col: this.store.addColumn(name, d.kind) };
        });
        this.ready = true;
        this.postSchema(this.reason);
        const rows = this.buffered;
        this.buffered = [];
        for (const r of rows) { this.addRow(r); }
    }

    private addLateColumn(name: string, raw: number, sample: unknown) {
        const d = detectKind(name, [sample]);
        this.detected[raw] = { ...d, col: this.store.addColumn(name, d.kind) };
        this.store.resend();
        this.postSchema('columns');
    }

    private addRow(r: unknown[]) {
        if (this.bindingCol >= 0) {
            const b = toBindings(r[this.bindingCol]);
            if (b && Object.entries(b).some(([k, v]) => this.bindings[k] !== v)) {
                this.bindings = { ...this.bindings, ...b };
                this.post({ type: 'bindings', id: this.id, bindings: this.bindings });
            }
        }
        // An overview keeps one row in `stride`
        if (this.stride > 1 && this.added++ % this.stride !== 0) { return; }
        if (this.stride > 1 && !this.caughtUp && this.store.rows >= this.store.keep()) { this.widenStride(); if ((this.added - 1) % this.stride !== 0) { return; } }
        let widened = false;
        // Early on, a column of numbers that meets text becomes a text column
        if (this.store.rows < WIDEN_ROWS) {
            for (let i = 0; i < this.detected.length; i++) {
                const d = this.detected[i], raw = r[i];
                if (d && d.kind === 'num' && Number.isNaN(toNum(raw)) && !isEmpty(raw)) { this.store.widenToText(d.col); d.kind = 'text'; widened = true; }
            }
        }
        this.store.append(this.cells(r, this.store));
        if (widened) { this.store.resend(); this.postSchema('columns'); }
    }

    /** One raw row as cells for a store, using the detected kinds. */
    private cells(r: unknown[], store: Store): Cell[] {
        const cells: Cell[] = new Array(store.columns.length).fill(null);
        for (let i = 0; i < this.detected.length; i++) {
            const d = this.detected[i];
            if (!d) { continue; }
            const raw = r[i];
            switch (d.kind) {
                case 'num': cells[d.col] = toNum(raw); break;
                case 'time': cells[d.col] = toTime(raw, d.scale); break;
                case 'text': cells[d.col] = toText(raw); break;
                case 'array': cells[d.col] = toArray(raw); break;
            }
        }
        return cells;
    }

    private postSchema(reason: SchemaReason) {
        this.post({ type: 'schema', id: this.id, file: this.file, format: this.format, columns: this.store.schema(), reason });
        this.schemaSent = true;
        this.scheduleFlush();
        if (Object.keys(this.bindings).length) { this.post({ type: 'bindings', id: this.id, bindings: this.bindings }); }
    }

    private scheduleFlush() {
        if (this.flushTimer) { return; }
        this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, FLUSH_MS);
    }

    private flush() {
        const s = this.store;
        if (!this.ready || (!this.schemaSent && s.rows <= s.sent)) { return; }
        this.schemaSent = false;
        const d = s.delta(s.sent);
        s.sent = s.rows;
        const transfer: ArrayBuffer[] = [];
        for (const c of d.columns) {
            if (c.values) { transfer.push(c.values.buffer as ArrayBuffer); }
            if (c.codes) { transfer.push(c.codes.buffer as ArrayBuffer); }
            if (c.packed) { transfer.push(c.packed.buffer as ArrayBuffer, c.lengths!.buffer as ArrayBuffer, c.arrayRows!.buffer as ArrayBuffer); }
        }
        this.post({ type: 'rows', id: this.id, first: d.first, count: d.count, dropped: s.offset, columns: d.columns }, transfer);
    }

    private setState(state: State) {
        if (state === this.state) { return; }
        this.state = state;
        this.postStatus();
    }

    private postStatus() {
        const t = this.tail;
        const size = t ? t.size : 100, read = t ? t.position : Math.round((this.state === 'reading' ? this.progress : 1) * 100);
        this.post({ type: 'status', id: this.id, file: this.file, state: this.state, bytesRead: read, size, rows: this.store.rows, lastGrowth: this.lastGrowth, badLines: this.badLines, stride: this.stride, fileRows: this.stride > 1 ? this.fileRows : this.store.rows });
    }

    private error(message: string) { this.post({ type: 'error', id: this.id, message }); }
}
