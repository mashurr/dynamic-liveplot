// Messages between the extension host and a Dynamic Liveplot webview, and the saved layout format.

import type { FromWorker } from '../data/protocol';

export interface SeriesStyle {
    color?: string;
    name?: string;
    axis?: 'left' | 'right';
    smooth?: number;
    width?: number;
}

export interface Limit {
    value: number;
    alert: 'above' | 'below';
}

export interface PlotOptions {
    log?: boolean;
    logRight?: boolean;
    stats?: boolean;
    window?: number;
    skip?: number;
    summary?: string;
    bins?: number;
    slices?: number;
    limits?: Limit[];
    custom?: string;
}

export interface PlotSpec {
    title: string;
    autoTitle?: boolean;
    type: string;
    group?: string | null;
    slots: Record<string, string[]>;
    series?: Record<string, SeriesStyle>;
    options?: PlotOptions;
}

export interface GroupSpec {
    id: string;
    name: string;
    color: string;
    collapsed?: boolean;
}

export interface Calculated {
    name: string;
    formula: string;
}

/** The `*.liveplot.json` format. Columns are referenced by their raw names. */
export interface Layout {
    $schema?: string;
    version: 1;
    grid: { columns: number; rows: number };
    bindings?: Record<string, string>;
    calculated?: Calculated[];
    groups?: GroupSpec[];
    plots: PlotSpec[];
    view?: { columnsHidden?: boolean; linkZoom?: boolean; compare?: 'previous' };
}

export type LayoutOrigin = 'restored' | 'team' | 'named' | 'none';

export interface InitMessage {
    type: 'init';
    mode: 'file' | 'folder';
    path: string;
    name: string;
    layout: Layout | null;
    origin: LayoutOrigin;
    originName?: string;
    glUri: string;
    mapUri: string;
    table?: string;
}

export type HostToView =
    | InitMessage
    | (FromWorker & { type: 'schema' | 'rows' | 'bindings' | 'status' | 'renamed' | 'error' | 'tables' | 'detail' })
    | { type: 'command'; name: string; arg?: unknown }
    | { type: 'layout'; layout: Layout; origin: LayoutOrigin; originName?: string }
    | { type: 'answer'; token: number; choice: string | null }
    /** The tab was shown or hidden (hidden views stop drawing). */
    | { type: 'visible'; visible: boolean }
    /** Data for the file being compared against (a previous run), or null when comparison stops. */
    | { type: 'compare'; file: string | null; data?: FromWorker };

export type ViewToHost =
    | { type: 'ready' }
    | { type: 'table'; name: string }
    /** Read every row in [from, to) (the file's own row numbers), for detail inside an overview. */
    | { type: 'range'; from: number; to: number }
    /** Compare against a file: 'previous' picks the newest older file in the same folder. */
    | { type: 'compare'; target: 'previous' | 'pick' | null }
    | { type: 'layout'; layout: Layout }
    | { type: 'state'; state: 'live' | 'paused' | 'finished' | 'static' | 'reading' | 'waiting'; text: string; alerts: number }
    | { type: 'ask'; token: number; message: string; actions: string[]; level?: 'info' | 'warning' | 'error' }
    | { type: 'input'; token: number; prompt: string; value?: string }
    | { type: 'run'; command: string; arg?: unknown }
    | { type: 'save'; name: string; data: string; encoding: 'base64' | 'utf8'; filter: string };
