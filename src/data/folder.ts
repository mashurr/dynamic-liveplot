// Watches a folder and reports its newest data file whenever that changes.

import * as fs from 'node:fs';
import * as path from 'node:path';

export const WATCHED = /\.(csv|tsv|txt|jsonl|ndjson)$/i;
const POLL_MS = 1000;

export class FolderWatch {
    private current = '';
    private watcher: fs.FSWatcher | null = null;
    private poll: NodeJS.Timeout | null = null;
    private debounce: NodeJS.Timeout | null = null;

    constructor(private dir: string, private onNewest: (file: string) => void) {}

    start() {
        this.scan();
        try { this.watcher = fs.watch(this.dir, () => this.soon()); this.watcher.on('error', () => this.watcher?.close()); } catch { this.watcher = null; }
        this.poll = setInterval(() => this.scan(), POLL_MS);
    }

    stop() {
        this.watcher?.close();
        if (this.poll) { clearInterval(this.poll); }
        if (this.debounce) { clearTimeout(this.debounce); }
    }

    private soon() {
        if (this.debounce) { clearTimeout(this.debounce); }
        this.debounce = setTimeout(() => this.scan(), 100);
    }

    /** The newest matching file by modification time; ties go to the later name. */
    newest(): string {
        let best = '', bestTime = -1;
        let names: string[];
        try { names = fs.readdirSync(this.dir); } catch { return ''; }
        for (const name of names) {
            if (!WATCHED.test(name)) { continue; }
            const full = path.join(this.dir, name);
            let st: fs.Stats;
            try { st = fs.statSync(full); } catch { continue; }
            if (!st.isFile()) { continue; }
            if (st.mtimeMs > bestTime || (st.mtimeMs === bestTime && full > best)) { best = full; bestTime = st.mtimeMs; }
        }
        return best;
    }

    private scan() {
        const next = this.newest();
        if (next && next !== this.current) { this.current = next; this.onNewest(next); }
    }

    /** Tell the watcher which file is current (after following a rename). */
    setCurrent(file: string) { this.current = file; }
}
