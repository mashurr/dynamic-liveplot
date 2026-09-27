import * as esbuild from 'esbuild';
import fs from 'node:fs';
import { feature } from 'topojson-client';

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

const GL_EXPR = `function __lpExpr(src) {
  var toks = src.match(/\\d*\\.?\\d+|width|height|dpr|[-+*\\/()\\[\\],]/g) || [];
  if (toks.join('') !== src.replace(/\\s+/g, '')) { throw new Error('bad'); }
  return function (width, height, dpr) {
    var i = 0, env = { width: width, height: height, dpr: dpr };
    function peek() { return toks[i]; }
    function expr() { var v = term(); while (peek() === '+' || peek() === '-') { var o = toks[i++], r = term(); v = o === '+' ? v + r : v - r; } return v; }
    function term() { var v = factor(); while (peek() === '*' || peek() === '/') { var o = toks[i++], r = factor(); v = o === '*' ? v * r : v / r; } return v; }
    function factor() {
      var t = toks[i++];
      if (t === '(') { var v = expr(); i++; return v; }
      if (t === '-') { return -factor(); }
      if (t === '[') { var a = [expr()]; while (peek() === ',') { i++; a.push(expr()); } i++; return a; }
      if (t in env) { return env[t]; }
      return parseFloat(t);
    }
    i = 0;
    return expr();
  };
}
`;

// Assets loaded on demand by the webview: ECharts GL (expects ECharts as a global) and world outlines for maps
function copyAssets() {
    fs.mkdirSync('out', { recursive: true });
    // ECharts GL evaluates a few size expressions ("width * 1.0 / 16") with new Function, which the
    // webview's CSP forbids; swap in a small arithmetic evaluator instead of allowing eval
    const gl = fs.readFileSync('node_modules/echarts-gl/dist/echarts-gl.min.js', 'utf8');
    const call = 'new Function("width","height","dpr","return "+t[1])';
    if (gl.split(call).length !== 2) { throw new Error('echarts-gl changed: the size-expression patch no longer applies'); }
    fs.writeFileSync('out/gl.js', GL_EXPR + gl.replace(call, '__lpExpr(t[1])'));
    const topo = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-110m.json', 'utf8'));
    fs.writeFileSync('out/world.json', JSON.stringify(feature(topo, topo.objects.countries)));
}
copyAssets();

if (watch) {
    await Promise.all(contexts.map(context => context.watch()));
} else {
    await Promise.all(contexts.map(context => context.rebuild()));
    await Promise.all(contexts.map(context => context.dispose()));
}
