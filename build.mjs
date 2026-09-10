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
  // Split, not bundled to one file: the dynamic vision-handlers import becomes its own
  // chunk, so Chrome's service worker does not carry ONNX Runtime it never runs.
  // (Chrome routes vision to the offscreen document; only Firefox loads the chunk.)
  splitting: true,
  outdir: 'extension/dist',
  entryNames: 'background',
  chunkNames: 'chunks/[name]-[hash]',
});

await esbuild.build({
  ...common,
  entryPoints: ['extension/src/offscreen/index.ts'],
  outfile: 'extension/dist/offscreen.js',
});

await esbuild.build({
  ...common,
  entryPoints: ['extension/src/content/index.ts'],
  outfile: 'extension/dist/content.js',
  // Injected via chrome.scripting.executeScript, which does not support ES modules.
  format: 'iife',
});

await esbuild.build({
  ...common,
  entryPoints: ['extension/src/panel/index.ts'],
  outfile: 'extension/dist/panel.js',
});

// The Chrome and Firefox manifests differ only in host-specific keys. Anything else
// diverging means one browser is quietly running a different extension.
{
  const { readFileSync } = await import('node:fs');
  const chrome = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  const firefox = JSON.parse(readFileSync('extension/manifest.firefox.json', 'utf8'));
  const HOST_SPECIFIC = new Set([
    'background', 'permissions', 'side_panel', 'sidebar_action', 'browser_specific_settings',
  ]);
  const drift = [...new Set([...Object.keys(chrome), ...Object.keys(firefox)])]
    .filter((k) => !HOST_SPECIFIC.has(k))
    .filter((k) => JSON.stringify(chrome[k]) !== JSON.stringify(firefox[k]));
  if (drift.length) {
    console.error(`\n✘ manifests have drifted on non-host keys: ${drift.join(', ')}`);
    process.exit(1);
  }
  console.log('manifests aligned (chrome ↔ firefox)');
}

console.log('built extension/dist/');
