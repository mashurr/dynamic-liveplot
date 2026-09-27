// Talking to the extension host: notifications with actions, commands and file saves.

import { send } from './state';

let token = 0;
const waiting = new Map<number, (choice: string | null) => void>();

/** Show a VS Code notification and resolve with the chosen action (or null). */
export function ask(message: string, actions: string[] = [], level: 'info' | 'warning' | 'error' = 'info'): Promise<string | null> {
    const t = ++token;
    send({ type: 'ask', token: t, message, actions, level });
    return new Promise(r => waiting.set(t, r));
}
export const notify = (message: string, level: 'info' | 'warning' | 'error' = 'info') => { void ask(message, [], level); };
export function answered(t: number, choice: string | null) { waiting.get(t)?.(choice); waiting.delete(t); }
export const run = (command: string, arg?: unknown) => send({ type: 'run', command, arg });
