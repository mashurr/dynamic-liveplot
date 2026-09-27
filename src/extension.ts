import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DataClient } from './dataClient';
import { Layouts } from './layouts';
import { Panel } from './panel';
import { registerSidebar } from './sidebar';
import type { Layout } from './view/protocol';

const DATA_GLOB = '**/*.{csv,tsv,txt,jsonl,ndjson,json,sqlite,sqlite3,db,parquet,xlsx}';
const EDITOR = 'dynamicLiveplot.file';
const FOLDER_VIEW = 'dynamicLiveplot.folder';

let data: DataClient;
let layouts: Layouts;
let context: vscode.ExtensionContext;

export function activate(ctx: vscode.ExtensionContext) {
    context = ctx;
    data = new DataClient(path.join(ctx.extensionPath, 'out'));
    layouts = new Layouts(ctx);

    const refreshSidebar = registerSidebar(ctx, layouts);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    status.command = 'dynamicLiveplot.togglePause';
    Panel.onChange = () => {
        refreshSidebar();
        const p = Panel.active;
        if (!p) { status.hide(); return; }
        const icon = { live: '$(pulse)', paused: '$(debug-pause)', finished: '$(check)', static: '$(graph)', reading: '$(sync~spin)', waiting: '$(watch)' }[p.viewState.state];
        status.text = `${icon} ${p.viewState.text}${p.viewState.alerts ? `  $(warning) ${p.viewState.alerts}` : ''}`;
        status.tooltip = p.viewState.state === 'live' || p.viewState.state === 'paused' ? 'Dynamic Liveplot: click to pause or resume' : 'Dynamic Liveplot';
        status.backgroundColor = p.viewState.alerts ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
        status.show();
    };

    offerGrowingFiles(ctx);

    ctx.subscriptions.push(
        status,
        { dispose: () => data.dispose() },
        vscode.window.registerCustomEditorProvider(EDITOR, {
            openCustomDocument: (uri: vscode.Uri) => ({ uri, dispose() {} }),
            resolveCustomEditor: (doc: vscode.CustomDocument, panel: vscode.WebviewPanel) => {
                if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'vscode-remote') {
                    panel.webview.html = `<p style="font-family: sans-serif; padding: 1em">Dynamic Liveplot can only read files on disk.</p>`;
                    return;
                }
                new Panel(panel, { kind: 'file', path: doc.uri.fsPath }, ctx, data, layouts);
            },
        } as vscode.CustomReadonlyEditorProvider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }),
        vscode.window.registerWebviewPanelSerializer(FOLDER_VIEW, {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: { path?: string } | undefined) {
                if (state?.path) { new Panel(panel, { kind: 'folder', path: state.path }, ctx, data, layouts); } else { panel.dispose(); }
            },
        }),
        vscode.commands.registerCommand('dynamicLiveplot.open', openFile),
        vscode.commands.registerCommand('dynamicLiveplot.watchFolder', watchFolder),
        vscode.commands.registerCommand('dynamicLiveplot.openAsText', (p?: Panel) => {
            const file = (p instanceof Panel ? p : Panel.active)?.currentFile;
            if (file) { void vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'default'); }
        }),
        vscode.commands.registerCommand('dynamicLiveplot.reveal', (p?: Panel) => {
            const file = (p instanceof Panel ? p : Panel.active)?.currentFile;
            if (file) { void vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(file)); }
        }),
        vscode.commands.registerCommand('dynamicLiveplot.watchParent', (p?: Panel) => {
            const file = (p instanceof Panel ? p : Panel.active)?.currentFile;
            if (file) { void watchFolder(vscode.Uri.file(path.dirname(file))); }
        }),
        vscode.commands.registerCommand('dynamicLiveplot.openCurrentFile', (p?: Panel) => {
            const file = (p instanceof Panel ? p : Panel.active)?.currentFile;
            if (file) { void openFile(vscode.Uri.file(file)); }
        }),
        vscode.commands.registerCommand('dynamicLiveplot.applyLayout', (layout: Layout, name?: string) => {
            if (Panel.active && layout?.plots) { Panel.active.applyLayout(layout, 'named', name); }
        }),
        vscode.commands.registerCommand('dynamicLiveplot.saveLayoutAs', (p?: Panel) => (p instanceof Panel ? p : Panel.active)?.saveLayoutAs() ?? noView()),
        vscode.commands.registerCommand('dynamicLiveplot.saveFolderLayout', (p?: Panel) => (p instanceof Panel ? p : Panel.active)?.saveFolderLayout() ?? noView()),
        vscode.commands.registerCommand('dynamicLiveplot.loadLayout', (p?: Panel) => (p instanceof Panel ? p : Panel.active)?.loadLayout() ?? noView()),
        vscode.commands.registerCommand('dynamicLiveplot.applyLayoutFile', (uri: vscode.Uri) => (Panel.active ?? [...Panel.all].at(-1))?.loadLayout(uri) ?? noView()),
        vscode.commands.registerCommand('dynamicLiveplot.switchFile', async (p?: Panel) => {
            const panel = p instanceof Panel ? p : Panel.active;
            const dir = panel ? path.dirname(panel.currentFile || panel.spec.path) : undefined;
            const pick = await pickDataFile(dir);
            if (pick) { void openFile(pick); }
        }),
    );

    // Commands that act on the active view
    for (const name of ['addPlot', 'autoPlot', 'togglePause', 'toggleColumns', 'changeChartType', 'editBindings', 'export', 'linkZoom']) {
        ctx.subscriptions.push(vscode.commands.registerCommand(`dynamicLiveplot.${name}`, () => {
            if (Panel.active) { Panel.active.command(name); } else { void vscode.window.showInformationMessage('Open a file or folder in Dynamic Liveplot first.'); }
        }));
    }
}

/** A CSV or JSON Lines file opened as text that is still growing: offer to plot it live, once per file. */
function offerGrowingFiles(ctx: vscode.ExtensionContext) {
    const offered = new Set<string>(), QUIET = 'quietFolders';
    const check = async (doc: vscode.TextDocument) => {
        const file = doc.uri.fsPath;
        if (doc.uri.scheme !== 'file' || !/\.(csv|tsv|jsonl|ndjson)$/i.test(file) || offered.has(file)) { return; }
        if (ctx.workspaceState.get<string[]>(QUIET, []).includes(path.dirname(file))) { return; }
        offered.add(file);
        const size = () => fs.promises.stat(file).then(s => s.size, () => -1);
        const before = await size();
        await new Promise(r => setTimeout(r, 2500));
        if (before < 0 || (await size()) <= before) { return; }
        const pick = await vscode.window.showInformationMessage(`${path.basename(file)} is still being written. Plot it live?`, 'Plot Live', 'Not for This Folder');
        if (pick === 'Plot Live') { await vscode.commands.executeCommand('vscode.openWith', doc.uri, EDITOR); }
        if (pick === 'Not for This Folder') { await ctx.workspaceState.update(QUIET, [...ctx.workspaceState.get<string[]>(QUIET, []), path.dirname(file)]); }
    };
    const scan = () => { for (const e of vscode.window.visibleTextEditors) { void check(e.document); } };
    ctx.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(scan));
    scan();
}

function noView() { void vscode.window.showInformationMessage('Open a file or folder in Dynamic Liveplot first.'); }

async function pickDataFile(dir?: string): Promise<vscode.Uri | undefined> {
    const files = await vscode.workspace.findFiles(DATA_GLOB, '**/{node_modules,.git}/**', 5000);
    const items = files
        .filter(f => !/(^|[\\/])(package(-lock)?|tsconfig|settings|launch|tasks)\.json$/.test(f.fsPath))
        .map(f => ({ label: path.basename(f.fsPath), description: vscode.workspace.asRelativePath(path.dirname(f.fsPath)), uri: f, near: dir && path.dirname(f.fsPath) === dir ? 0 : 1 }))
        .sort((a, b) => a.near - b.near || a.description.localeCompare(b.description) || a.label.localeCompare(b.label));
    if (!items.length) {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Plot', filters: { 'Data files': ['csv', 'tsv', 'txt', 'jsonl', 'ndjson', 'json', 'sqlite', 'sqlite3', 'db', 'parquet', 'xlsx'] } });
        return picked?.[0];
    }
    return (await vscode.window.showQuickPick(items, { placeHolder: 'Pick a data file to plot', matchOnDescription: true }))?.uri;
}

async function openFile(uri?: vscode.Uri) {
    if (!(uri instanceof vscode.Uri)) {
        const active = vscode.window.activeTextEditor?.document.uri;
        uri = active && /\.(csv|tsv|txt|jsonl|ndjson|json)$/i.test(active.fsPath) ? active : await pickDataFile();
    }
    if (uri) { await vscode.commands.executeCommand('vscode.openWith', uri, EDITOR); }
}

async function watchFolder(uri?: vscode.Uri) {
    if (!(uri instanceof vscode.Uri)) {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Watch', defaultUri: folders[0]?.uri });
        uri = picked?.[0];
    }
    if (!uri) { return; }
    const existing = [...Panel.all].find(p => p.spec.kind === 'folder' && p.spec.path === uri!.fsPath);
    if (existing) { existing.webviewPanel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel(FOLDER_VIEW, `${path.basename(uri.fsPath)}/`, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    new Panel(panel, { kind: 'folder', path: uri.fsPath }, context, data, layouts);
}

export function deactivate() {
    data?.dispose();
}
