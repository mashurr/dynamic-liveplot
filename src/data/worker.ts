// Entry point of the data worker thread: one Source per open file or folder.

import { parentPort } from 'node:worker_threads';
import type { FromWorker, ToWorker } from './protocol';
import { Source } from './source';

const sources = new Map<number, Source>();
const port = parentPort!;

function post(m: FromWorker, transfer?: ArrayBuffer[]) { port.postMessage(m, transfer ?? []); }

port.on('message', (m: ToWorker) => {
    if (m.type === 'open') {
        sources.get(m.id)?.close();
        const s = new Source(m.id, m.spec, m.options ?? {}, post);
        sources.set(m.id, s);
        s.start();
    } else if (m.type === 'resend') {
        sources.get(m.id)?.resend();
    } else if (m.type === 'close') {
        sources.get(m.id)?.close();
        sources.delete(m.id);
    }
});
