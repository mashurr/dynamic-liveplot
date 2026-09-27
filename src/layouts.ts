// Where layouts live: auto-saved per file or folder in workspace state, named layouts as
// `*.liveplot.json` files under .vscode/liveplot, and a folder layout in `<folder>/.liveplot.json`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { SourceSpec } from './data/protocol';
import type { Layout, LayoutOrigin } from './view/protocol';

export interface LoadedLayout {
    layout: Layout;
    origin: LayoutOrigin;
    name?: string;
}

export const FOLDER_LAYOUT = '.liveplot.json';

/** Checks a parsed file looks like a layout; returns a message if not. */
export function layoutProblem(v: unknown): string | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { return 'it isn\'t a JSON object'; }
    const l = v as Partial<Layout>;
    if (l.version !== 1) { return 'its "version" isn\'t 1'; }
    if (!Array.isArray(l.plots)) { return 'it has no "plots" list'; }
    if (l.plots.some(p => !p || typeof p !== 'object' || typeof p.type !== 'string' || typeof p.slots !== 'object')) { return 'a plot is missing its "type" or "slots"'; }
    return null;
}

export class Layouts {
    readonly changed = new vscode.EventEmitter<void>();
    constructor(private readonly ctx: vscode.ExtensionContext) {}

    private key(spec: SourceSpec) { return `layout:${spec.kind}:${spec.path}${spec.kind === 'file' && spec.table ? '#' + spec.table : ''}`; }

    /** The folder a source belongs to (the watched folder, or the file's folder). */
    folderOf(spec: SourceSpec) { return spec.kind === 'folder' ? spec.path : path.dirname(spec.path); }

    load(spec: SourceSpec): LoadedLayout | null {
        const layout = this.ctx.workspaceState.get<Layout>(this.key(spec));
        if (layout) { return { layout, origin: 'restored' }; }
        const team = this.readSync(path.join(this.folderOf(spec), FOLDER_LAYOUT));
        return team ? { layout: team, origin: 'team', name: FOLDER_LAYOUT } : null;
    }

    async save(spec: SourceSpec, layout: Layout) {
        await this.ctx.workspaceState.update(this.key(spec), layout);
    }

    /** The table or sheet last plotted from a database or workbook. */
    lastTable(file: string): string | undefined { return this.ctx.workspaceState.get<string>(`table:${file}`); }
    async rememberTable(file: string, table: string) { await this.ctx.workspaceState.update(`table:${file}`, table); }

    private readSync(file: string): Layout | null {
        try {
            const v = JSON.parse(fs.readFileSync(file, 'utf8'));
            return layoutProblem(v) ? null : v as Layout;
        } catch { return null; }
    }

    async read(uri: vscode.Uri): Promise<Layout> {
        const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        let v: unknown;
        try { v = JSON.parse(text); } catch (e) { throw new Error(`${path.basename(uri.fsPath)} isn't valid JSON: ${(e as Error).message}`); }
        const problem = layoutProblem(v);
        if (problem) { throw new Error(`${path.basename(uri.fsPath)} isn't a Dynamic Liveplot layout: ${problem}.`); }
        return v as Layout;
    }

    async write(uri: vscode.Uri, layout: Layout) {
        // No $schema URL: the bundled schema is attached through jsonValidation, so nothing is fetched
        const { $schema: _unused, ...plain } = layout;
        const body = JSON.stringify(plain, null, 2);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
        await vscode.workspace.fs.writeFile(uri, Buffer.from(body + '\n', 'utf8'));
        this.changed.fire();
    }

    /** Where named layouts are saved: .vscode/liveplot in the source's workspace folder, else next to the data. */
    namedDir(spec: SourceSpec): string {
        const ws = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(spec.path));
        return ws ? path.join(ws.uri.fsPath, '.vscode', 'liveplot') : path.join(this.folderOf(spec), '.liveplot');
    }

    async list(): Promise<vscode.Uri[]> {
        const found = await vscode.workspace.findFiles('**/{*.liveplot.json,.liveplot.json}', '**/node_modules/**', 500);
        return found.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    }
}
