// Where layouts live: auto-saved per file or folder in workspace state.

import * as vscode from 'vscode';
import type { SourceSpec } from './data/protocol';
import type { Layout, LayoutOrigin } from './view/protocol';

export interface LoadedLayout {
    layout: Layout;
    origin: LayoutOrigin;
    name?: string;
}

export class Layouts {
    constructor(private readonly ctx: vscode.ExtensionContext) {}

    private key(spec: SourceSpec) { return `layout:${spec.kind}:${spec.path}${spec.kind === 'file' && spec.table ? '#' + spec.table : ''}`; }

    load(spec: SourceSpec): LoadedLayout | null {
        const layout = this.ctx.workspaceState.get<Layout>(this.key(spec));
        return layout ? { layout, origin: 'restored' } : null;
    }

    /** The table or sheet last plotted from a database or workbook. */
    lastTable(file: string): string | undefined { return this.ctx.workspaceState.get<string>(`table:${file}`); }
    async rememberTable(file: string, table: string) { await this.ctx.workspaceState.update(`table:${file}`, table); }

    async save(spec: SourceSpec, layout: Layout) {
        await this.ctx.workspaceState.update(this.key(spec), layout);
    }
}
