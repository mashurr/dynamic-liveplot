// Starts the data worker once and routes its messages to the panel that opened each source.

import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { FromWorker, OpenOptions, SourceSpec, ToWorker } from './data/protocol';

export class DataClient {
    private worker: Worker | null = null;
    private listeners = new Map<number, (m: FromWorker) => void>();
    private nextId = 1;

    constructor(private outDir: string) {}

    private get port(): Worker {
        if (!this.worker) {
            this.worker = new Worker(path.join(this.outDir, 'worker.js'));
            this.worker.on('message', (m: FromWorker) => this.listeners.get(m.id)?.(m));
            this.worker.on('error', e => { for (const [id, l] of this.listeners) { l({ type: 'error', id, message: `The data reader stopped: ${e.message}` }); } });
            this.worker.on('exit', () => { this.worker = null; });
        }
        return this.worker;
    }

    open(spec: SourceSpec, listener: (m: FromWorker) => void, options?: OpenOptions): number {
        const id = this.nextId++;
        this.listeners.set(id, listener);
        this.send({ type: 'open', id, spec, options });
        return id;
    }

    resend(id: number) { this.send({ type: 'resend', id }); }

    range(id: number, from: number, to: number) { this.send({ type: 'range', id, from, to }); }

    close(id: number) {
        this.listeners.delete(id);
        if (this.worker) { this.send({ type: 'close', id }); }
    }

    private send(m: ToWorker) { this.port.postMessage(m); }

    dispose() { void this.worker?.terminate(); this.worker = null; }
}
