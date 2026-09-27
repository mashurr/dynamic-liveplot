// Extension points: later modules add toolbar buttons, menu items, commands and pickers here.

import type { MenuItem } from './menus';
import type { Plot } from './state';

export const extensions = {
    toolbarRight: [] as (() => string)[],
    wireToolbar: [] as ((tool: HTMLElement) => void)[],
    layoutMenu: [] as (() => MenuItem[])[],
    plotMenu: [] as ((p: Plot) => MenuItem[])[],
    openTypes: (p: Plot) => { document.dispatchEvent(new CustomEvent('lp-select', { detail: p.id })); },
    recommend: (_cols: string[]): string[] => ['line'],
    autoPlot: (): { count: number; how: string } => ({ count: 0, how: '' }),
    commands: {} as Record<string, () => void>,
};
export const afterAdd: ((p: Plot, slot: string, col: string) => void)[] = [];
/** Adjust a built chart option before it's applied (measurement lines, overlays). */
export const decorate: ((p: Plot, option: Record<string, unknown>, ref: { chart: unknown; card: HTMLElement }) => void)[] = [];
/** Called once when a card's chart is created. */
export const chartCreated: ((p: Plot, ref: { chart: import('echarts').ECharts; card: HTMLElement; host: HTMLElement }) => void)[] = [];
export const groupSections: ((stack: HTMLElement, makeCard: (p: Plot) => HTMLElement) => Set<number>)[] = [];
