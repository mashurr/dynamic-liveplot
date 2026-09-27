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
export const groupSections: ((stack: HTMLElement, makeCard: (p: Plot) => HTMLElement) => Set<number>)[] = [];
