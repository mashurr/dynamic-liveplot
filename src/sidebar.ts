// The Dynamic Liveplot sidebar: open views and saved layouts.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { FOLDER_LAYOUT, type Layouts } from './layouts';
import { Panel } from './panel';

class OpenViews implements vscode.TreeDataProvider<Panel> {
    readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;
    getChildren() { return [...Panel.all]; }
    getTreeItem(p: Panel): vscode.TreeItem {
        const item = new vscode.TreeItem(p.webviewPanel.title, vscode.TreeItemCollapsibleState.None);
        item.description = p.viewState.text;
        item.tooltip = p.spec.kind === 'folder' ? `Watching ${p.spec.path}` : p.currentFile;
        item.iconPath = new vscode.ThemeIcon(p.spec.kind === 'folder' ? 'eye' : p.viewState.state === 'live' ? 'pulse' : 'graph-line', p.viewState.alerts ? new vscode.ThemeColor('errorForeground') : undefined);
        item.command = { command: 'dynamicLiveplot.revealView', title: 'Show', arguments: [p] };
        return item;
    }
}

class SavedLayouts implements vscode.TreeDataProvider<vscode.Uri> {
    readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;
    constructor(private layouts: Layouts) {}
    getChildren() { return this.layouts.list(); }
    getTreeItem(uri: vscode.Uri): vscode.TreeItem {
        const base = path.basename(uri.fsPath), folder = base === FOLDER_LAYOUT;
        const item = new vscode.TreeItem(folder ? `${path.basename(path.dirname(uri.fsPath))}/ (folder layout)` : base.replace(/\.liveplot\.json$/, ''), vscode.TreeItemCollapsibleState.None);
        item.description = vscode.workspace.asRelativePath(path.dirname(uri.fsPath));
        item.tooltip = `${uri.fsPath}\nClick to apply to the active Dynamic Liveplot view.`;
        item.iconPath = new vscode.ThemeIcon(folder ? 'folder-library' : 'layout');
        item.contextValue = 'layout';
        item.resourceUri = uri;
        item.command = { command: 'dynamicLiveplot.applyLayoutFile', title: 'Apply', arguments: [uri] };
        return item;
    }
}

export function registerSidebar(ctx: vscode.ExtensionContext, layouts: Layouts) {
    const open = new OpenViews(), saved = new SavedLayouts(layouts);
    const refresh = () => open.changed.fire();
    const watcher = vscode.workspace.createFileSystemWatcher('**/{*.liveplot.json,.liveplot.json}');
    ctx.subscriptions.push(
        vscode.window.createTreeView('dynamicLiveplot.views', { treeDataProvider: open }),
        vscode.window.createTreeView('dynamicLiveplot.layouts', { treeDataProvider: saved }),
        watcher, watcher.onDidCreate(() => saved.changed.fire()), watcher.onDidDelete(() => saved.changed.fire()),
        layouts.changed.event(() => saved.changed.fire()),
        vscode.commands.registerCommand('dynamicLiveplot.revealView', (p: Panel) => p.webviewPanel.reveal()),
        vscode.commands.registerCommand('dynamicLiveplot.openLayoutFile', (uri: vscode.Uri) => vscode.window.showTextDocument(uri)),
    );
    return refresh;
}
