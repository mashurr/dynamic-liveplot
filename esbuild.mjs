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
