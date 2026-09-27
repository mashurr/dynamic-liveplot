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

    private key(spec: SourceSpec) { return `layout:${spec.kind}:${spec.path}`; }

    load(spec: SourceSpec): LoadedLayout | null {
        const layout = this.ctx.workspaceState.get<Layout>(this.key(spec));
        return layout ? { layout, origin: 'restored' } : null;
    }

    async save(spec: SourceSpec, layout: Layout) {
        await this.ctx.workspaceState.update(this.key(spec), layout);
    }
}
