/**
 * Build the extension. esbuild bundles TS -> JS; the .wasm and .onnx assets are copied
 * verbatim because MV3 forbids remote code, so everything must ship locally.
 */
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('extension/dist', { recursive: true });

const common = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  platform: 'browser',
  // ORT resolves its own .wasm/.mjs at runtime from ort.env.wasm.wasmPaths; bundling
  // them would defeat that and inline megabytes into the JS.
  external: ['*.wasm'],
  logLevel: 'info',
};

await esbuild.build({
  ...common,
  entryPoints: ['extension/src/background/index.ts'],
  outfile: 'extension/dist/background.js',
});

await esbuild.build({
  ...common,
  entryPoints: ['extension/src/offscreen/index.ts'],
  outfile: 'extension/dist/offscreen.js',
});

console.log('built extension/dist/');
