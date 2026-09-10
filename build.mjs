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

/**
 * Emit a ready-to-load Firefox build.
 *
 * Firefox needs a DIFFERENT manifest, and the instruction "copy manifest.firefox.json
 * over manifest.json first" is a trap: forget it and the extension silently refuses to
 * load, and doing it in place leaves the tree Firefox-only until someone undoes it.
 * A separate output directory removes the step entirely.
 */
{
  const { cpSync, rmSync, existsSync, copyFileSync } = await import('node:fs');
  const OUT = 'dist-firefox';
  rmSync(OUT, { recursive: true, force: true });
  cpSync('extension', OUT, {
    recursive: true,
    filter: (src) => !src.includes('manifest.json'),
  });
  copyFileSync('extension/manifest.firefox.json', `${OUT}/manifest.json`);
  rmSync(`${OUT}/manifest.firefox.json`, { force: true });
  const hasModels = existsSync(`${OUT}/models/ultraface_rfb320.onnx`);
  console.log(`built ${OUT}/  (load this one in Firefox${hasModels ? '' : ' — run setup.mjs for models'})`);
}

console.log('built extension/dist/');
