// One Dynamic Liveplot view: a webview showing a file (custom editor) or the newest file in a folder.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DataClient } from './dataClient';
import type { FromWorker, SourceSpec } from './data/protocol';
import type { Layouts } from './layouts';
import type { HostToView, Layout, ViewToHost } from './view/protocol';

/** The newest data file of the same kind in the same folder that is older than `file`. */
export function previousFile(file: string): string | undefined {
    const dir = path.dirname(file), ext = path.extname(file).toLowerCase();
    let mine = Infinity;
    try { mine = fs.statSync(file).mtimeMs; } catch { /* gone */ }
    const others = fs.readdirSync(dir).filter(n => path.extname(n).toLowerCase() === ext).map(n => path.join(dir, n)).filter(p => p !== file)
        .map(p => { try { return { p, t: fs.statSync(p).mtimeMs }; } catch { return null; } }).filter((x): x is { p: string; t: number } => !!x && x.t <= mine)
        .sort((a, b) => b.t - a.t);
    return others[0]?.p;
}

export interface PanelState {
    state: 'live' | 'paused' | 'finished' | 'static' | 'reading' | 'waiting';
    text: string;
    alerts: number;
}

export class Panel {
    static readonly all = new Set<Panel>();
    static active: Panel | undefined;
    static onChange: () => void = () => {};

    private sourceId: number;
    private readyCount = 0;
    private queue: HostToView[] = [];
    private disposed = false;
    private file = '';
    private tokens = 0;
    private compareId: number | null = null;
    lastLayout: Layout | null = null;
    private wasVisible = true;
    viewState: PanelState = { state: 'waiting', text: 'Waiting for data', alerts: 0 };

    constructor(
        readonly webviewPanel: vscode.WebviewPanel,
        public spec: SourceSpec,
        private readonly ctx: vscode.ExtensionContext,
        private readonly data: DataClient,
        private readonly layouts: Layouts,
    ) {
        Panel.all.add(this);
        const wv = webviewPanel.webview;
        wv.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'out'), vscode.Uri.joinPath(ctx.extensionUri, 'media')] };
        wv.html = this.html();
        wv.onDidReceiveMessage((m: ViewToHost) => this.fromView(m));
        webviewPanel.onDidChangeViewState(() => this.focusChanged());
        webviewPanel.onDidDispose(() => this.dispose());
        if (spec.kind === 'folder') { webviewPanel.title = `${path.basename(spec.path)}/`; }
        webviewPanel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'tab.svg');
        if (spec.kind === 'file' && !spec.table) {
            const last = layouts.lastTable(spec.path);
            if (last) { this.spec = { ...spec, table: last }; webviewPanel.title = `${path.basename(spec.path)} › ${last}`; }
        }
        this.sourceId = data.open(this.spec, m => this.fromWorker(m));
        this.focusChanged();
    }

    get currentFile(): string { return this.file || (this.spec.kind === 'file' ? this.spec.path : ''); }

    post(m: HostToView) {
        if (this.disposed) { return; }
        if (this.readyCount === 0) { this.queue.push(m); return; }
        void this.webviewPanel.webview.postMessage(m);
    }

    command(name: string, arg?: unknown) { this.post({ type: 'command', name, arg }); }

    private fromWorker(m: FromWorker) {
        if (m.type === 'schema') { this.file = m.file; }
        if (m.type === 'renamed') { this.file = m.to; }
        this.post(m as HostToView);
    }

    private async fromView(m: ViewToHost) {
        switch (m.type) {
            case 'ready': {
                const first = this.readyCount === 0;
                this.readyCount++;
                const saved = this.layouts.load(this.spec);
                void this.webviewPanel.webview.postMessage({
                    type: 'init', mode: this.spec.kind, path: this.spec.path, name: path.basename(this.spec.path),
                    layout: saved?.layout ?? null, origin: saved?.origin ?? 'none', originName: saved?.name,
                    glUri: this.uri('out', 'gl.js'), mapUri: this.uri('out', 'world.json'), table: this.spec.kind === 'file' ? this.spec.table : undefined,
                } satisfies HostToView);
                if (first) {
                    for (const q of this.queue) { void this.webviewPanel.webview.postMessage(q); }
                    this.queue = [];
                } else {
                    this.data.resend(this.sourceId);
                }
                break;
            }
            case 'layout':
                this.lastLayout = m.layout;
                await this.layouts.save(this.spec, m.layout);
                break;
            case 'compare':
                await this.compare(m.target);
                break;
            case 'range':
                this.data.range(this.sourceId, m.from, m.to);
                break;
            case 'table':
                if (this.spec.kind !== 'file' || this.spec.table === m.name) { break; }
                this.data.close(this.sourceId);
                this.spec = { ...this.spec, table: m.name };
                void this.layouts.rememberTable(this.spec.path, m.name);
                this.webviewPanel.title = `${path.basename(this.spec.path)} › ${m.name}`;
                this.readyCount = 0;
                this.queue = [];
                void this.webviewPanel.webview.postMessage({ type: 'command', name: 'reinit' });
                this.sourceId = this.data.open(this.spec, w => this.fromWorker(w));
                break;
            case 'state':
                this.viewState = { state: m.state, text: m.text, alerts: m.alerts };
                Panel.onChange();
                break;
            case 'ask': {
                const show = m.level === 'error' ? vscode.window.showErrorMessage : m.level === 'warning' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
                const choice = await show(m.message, ...m.actions);
                this.post({ type: 'answer', token: m.token, choice: choice ?? null });
                break;
            }
            case 'input': {
                const v = await vscode.window.showInputBox({ prompt: m.prompt, value: m.value });
                this.post({ type: 'answer', token: m.token, choice: v?.trim() ? v.trim() : null });
                break;
            }
            case 'run':
                await vscode.commands.executeCommand(m.command, this, m.arg);
                break;
            case 'save': {
                const dir = path.dirname(this.currentFile || this.spec.path);
                const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(dir, m.name)), filters: { [m.filter]: [path.extname(m.name).slice(1)] } });
                if (!target) { return; }
                await vscode.workspace.fs.writeFile(target, Buffer.from(m.data, m.encoding));
                void vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}.`);
                break;
            }
        }
    }

    private stopCompare() {
        if (this.compareId !== null) { this.data.close(this.compareId); this.compareId = null; }
    }

    private async compare(target: 'previous' | 'pick' | null) {
        this.stopCompare();
        if (!target) { this.post({ type: 'compare', file: null }); return; }
        const current = this.currentFile;
        let file: string | undefined;
        if (target === 'previous') {
            file = previousFile(current);
            if (!file) { void vscode.window.showInformationMessage(`There's no earlier data file next to ${path.basename(current)} to compare with.`); this.post({ type: 'compare', file: null }); return; }
        } else {
            const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Compare', defaultUri: vscode.Uri.file(path.dirname(current)), filters: { 'Data files': ['csv', 'tsv', 'txt', 'jsonl', 'ndjson', 'json', 'parquet'] } });
            file = picked?.[0]?.fsPath;
            if (!file) { this.post({ type: 'compare', file: null }); return; }
        }
        const f = file;
        this.post({ type: 'compare', file: f });
        this.compareId = this.data.open({ kind: 'file', path: f }, m => this.post({ type: 'compare', file: f, data: m }));
    }

    async saveLayoutAs() {
        if (!this.lastLayout) { void vscode.window.showInformationMessage('Nothing to save yet.'); return; }
        const name = await vscode.window.showInputBox({ prompt: 'Name this layout', placeHolder: 'bench default', value: path.basename(this.spec.path).replace(/\.[^.]+$/, ''), validateInput: v => (v.trim() ? null : 'Type a name') });
        if (!name) { return; }
        const file = vscode.Uri.file(path.join(this.layouts.namedDir(this.spec), `${name.trim().replace(/[\\/:*?"<>|]+/g, '-')}.liveplot.json`));
        await this.layouts.write(file, this.lastLayout);
        const open = await vscode.window.showInformationMessage(`Saved layout "${name.trim()}" to ${vscode.workspace.asRelativePath(file)}.`, 'Open File');
        if (open) { await vscode.window.showTextDocument(file); }
    }

    async saveFolderLayout() {
        if (!this.lastLayout) { void vscode.window.showInformationMessage('Nothing to save yet.'); return; }
        const folder = this.layouts.folderOf(this.spec), file = vscode.Uri.file(path.join(folder, '.liveplot.json'));
        let exists = false;
        try { await vscode.workspace.fs.stat(file); exists = true; } catch { /* new */ }
        if (exists) {
            const ok = await vscode.window.showWarningMessage(`Replace the folder layout in ${path.basename(folder)}/?`, { modal: true }, 'Replace');
            if (ok !== 'Replace') { return; }
        }
        await this.layouts.write(file, this.lastLayout);
        void vscode.window.showInformationMessage(`Saved ${path.basename(folder)}/.liveplot.json. Anyone who opens files in this folder without a layout of their own gets it; commit it to share.`);
    }

    async loadLayout(uri?: vscode.Uri) {
        if (!uri) {
            const files = await this.layouts.list();
            if (!files.length) { void vscode.window.showInformationMessage('No saved layouts yet. Use Save Layout As… to make one.'); return; }
            const pick = await vscode.window.showQuickPick(files.map(f => ({ label: path.basename(f.fsPath).replace(/\.liveplot\.json$/, '') || path.basename(f.fsPath), description: vscode.workspace.asRelativePath(path.dirname(f.fsPath)), uri: f })), { placeHolder: 'Pick a layout to apply' });
            uri = pick?.uri;
        }
        if (!uri) { return; }
        try {
            const layout = await this.layouts.read(uri);
            this.applyLayout(layout, path.basename(uri.fsPath) === '.liveplot.json' ? 'team' : 'named', path.basename(uri.fsPath).replace(/\.liveplot\.json$/, ''));
        } catch (e) { void vscode.window.showErrorMessage((e as Error).message); }
    }

    /** Ask the view a question and get the chosen action back (used by commands). */
    nextToken() { return ++this.tokens; }

    applyLayout(layout: Layout, origin: 'named' | 'team', originName?: string) { this.post({ type: 'layout', layout, origin, originName }); }

    private focusChanged() {
        if (this.webviewPanel.visible !== this.wasVisible) { this.wasVisible = this.webviewPanel.visible; this.post({ type: 'visible', visible: this.wasVisible }); }
        if (this.webviewPanel.active) { Panel.active = this; } else if (Panel.active === this) { Panel.active = undefined; }
        void vscode.commands.executeCommand('setContext', 'dynamicLiveplot.active', !!Panel.active);
        Panel.onChange();
    }

    private uri(...parts: string[]): string {
        return this.webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, ...parts)).toString();
    }

    private html(): string {
        const wv = this.webviewPanel.webview;
        const nonce = Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
        const csp = [
            `default-src 'none'`,
            `img-src ${wv.cspSource} data: blob:`,
            `style-src ${wv.cspSource} 'unsafe-inline'`,
            `font-src ${wv.cspSource}`,
            `script-src 'nonce-${nonce}' ${wv.cspSource}`,
            `connect-src ${wv.cspSource}`,
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${this.uri('media', 'viewer.css')}" rel="stylesheet">
<title>Dynamic Liveplot</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${this.uri('out', 'webview.js')}"></script>
</body>
</html>`;
    }

    dispose() {
        if (this.disposed) { return; }
        this.disposed = true;
        this.data.close(this.sourceId);
        this.stopCompare();
        Panel.all.delete(this);
        if (Panel.active === this) { Panel.active = undefined; }
        void vscode.commands.executeCommand('setContext', 'dynamicLiveplot.active', !!Panel.active);
        Panel.onChange();
    }
}
