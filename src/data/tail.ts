// Holds one file open and reads whatever was appended since the last read.
// The handle follows the file itself, so reading carries on through a rename; Node opens
// files with delete sharing on Windows, so other programs can still rename or delete it.

import * as fs from 'node:fs';

const READ_SIZE = 1 << 18;

export type Change = 'none' | 'truncated' | 'replaced' | 'missing';

export class Tail {
    private fd: number | null = null;
    private ino = 0;
    private dev = 0;
    position = 0;
    size = 0;
    private buf = Buffer.allocUnsafe(READ_SIZE);

    constructor(public path: string) {}

    get isOpen(): boolean { return this.fd !== null; }

    open(): boolean {
        this.close();
        try {
            const fd = fs.openSync(this.path, 'r');
            const st = fs.fstatSync(fd);
            if (!st.isFile()) { fs.closeSync(fd); return false; }
            this.fd = fd; this.ino = st.ino; this.dev = st.dev; this.size = st.size; this.position = 0;
            return true;
        } catch {
            return false;
        }
    }

    close() {
        if (this.fd !== null) { try { fs.closeSync(this.fd); } catch { /* already gone */ } }
        this.fd = null;
    }

    /** The next piece of the file, or null at the current end. */
    read(): Buffer | null {
        if (this.fd === null) { return null; }
        let n: number;
        try { n = fs.readSync(this.fd, this.buf, 0, READ_SIZE, this.position); } catch { return null; }
        if (n <= 0) { return null; }
        this.position += n;
        if (this.position > this.size) { this.size = this.position; }
        return this.buf.subarray(0, n);
    }

    /** What happened to the file since we opened it. Refreshes `size`. */
    check(): Change {
        if (this.fd === null) { return 'missing'; }
        let held: fs.Stats;
        try { held = fs.fstatSync(this.fd); } catch { return 'missing'; }
        let atPath: fs.Stats | null = null;
        try { atPath = fs.statSync(this.path); } catch { atPath = null; }
        if (atPath && (atPath.ino !== this.ino || atPath.dev !== this.dev)) { return 'replaced'; }
        this.size = held.size;
        if (held.size < this.position) { return 'truncated'; }
        return atPath ? 'none' : 'missing';
    }

    /** True if `path` names the file this handle holds (a rename, not a new file). */
    isSameFile(path: string): boolean {
        try { const st = fs.statSync(path); return st.ino === this.ino && st.dev === this.dev; } catch { return false; }
    }
}
