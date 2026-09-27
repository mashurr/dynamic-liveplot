// One open source: a file, or the newest file in a folder. Reads what's there, keeps
// tailing it, and posts schema, row deltas and status to the extension host.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CsvTokenizer, headerNames, looksHeaderless, sniffDelimiter } from './csv';
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
    }

    private feedCsv(text: string) {
        if (!this.csv) {
            this.sniff += text;
            if (!this.sniff.includes('\n') && this.sniff.length < 1 << 20) { return; }
            this.csv = new CsvTokenizer(sniffDelimiter(this.sniff, this.file));
            text = this.sniff; this.sniff = '';
        }
        const records: string[][] = [];
        this.csv.feed(text, records);
        for (const r of records) {
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
        const cells: Cell[] = new Array(this.store.columns.length).fill(null);
        let widened = false;
        for (let i = 0; i < this.detected.length; i++) {
            const d = this.detected[i];
            if (!d) { continue; }
            const raw = r[i];
            switch (d.kind) {
                case 'num': {
                    const v = toNum(raw);
                    if (Number.isNaN(v) && !isEmpty(raw) && this.store.rows < WIDEN_ROWS) { this.store.widenToText(d.col); d.kind = 'text'; widened = true; cells[d.col] = toText(raw); } else { cells[d.col] = v; }
                    break;
                }
                case 'time': cells[d.col] = toTime(raw, d.scale); break;
                case 'text': cells[d.col] = toText(raw); break;
                case 'array': cells[d.col] = toArray(raw); break;
            }
        }
        this.store.append(cells);
        if (widened) { this.store.resend(); this.postSchema('columns'); }
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
        this.post({ type: 'status', id: this.id, file: this.file, state: this.state, bytesRead: read, size, rows: this.store.rows, lastGrowth: this.lastGrowth, badLines: this.badLines });
    }

    private error(message: string) { this.post({ type: 'error', id: this.id, message }); }
}
