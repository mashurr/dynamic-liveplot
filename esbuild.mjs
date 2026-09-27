import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const shared = {
    bundle: true,
    minify: production,
    sourcemap: !production,
    logLevel: 'info',
};

const contexts = await Promise.all([
    // Extension host code runs in Node; `vscode` is provided at runtime
    esbuild.context({
        ...shared,
        entryPoints: { extension: 'src/extension.ts' },
        outdir: 'out',
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: ['vscode'],
    }),
    // Webview code runs in the panel's browser frame
    esbuild.context({
        ...shared,
        entryPoints: { webview: 'webview/main.ts' },
        outdir: 'out',
        platform: 'browser',
        format: 'iife',
        target: 'es2022',
    }),
    // The data worker reads and tails files off the extension host's main thread
    esbuild.context({
        ...shared,
        entryPoints: { worker: 'src/data/worker.ts' },
        outdir: 'out',
        platform: 'node',
        format: 'cjs',
        target: 'node20',
    }),
]);

if (watch) {
    await Promise.all(contexts.map(context => context.watch()));
} else {
    await Promise.all(contexts.map(context => context.rebuild()));
    await Promise.all(contexts.map(context => context.dispose()));
}
