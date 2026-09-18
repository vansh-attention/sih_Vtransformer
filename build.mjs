/**
 * Build the extension. esbuild bundles TS -> JS; the .wasm and .onnx assets are copied
 * verbatim because MV3 forbids remote code, so everything must ship locally.
 */
import * as esbuild from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';

/**
 * Clear the output first.
 *
 * Code-split chunks are named by content hash, so every change to the vision handlers
 * left the previous chunk behind and nothing ever removed it. Four handler chunks had
 * accumulated here, three of them dead, and they went into the extension zip: 1.6 MB
 * shipped where a clean build produces 1.4 MB. A fresh clone built 200 KB smaller than
 * this machine did, which is the only reason it was noticed.
 */
rmSync('extension/dist', { recursive: true, force: true });
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

/**
 * Stamp the build with WHAT IT IS and HOW TO START ITS SERVER.
 *
 * The panel used to print `cd server && .venv/bin/uvicorn main:app --port 8975` whenever
 * the reasoning server was unreachable. For anyone holding the ZIP that command is
 * fiction: the zip ships no `server/` directory at all, so there is nothing to cd into
 * and no venv to run — and "Run on this tab" can never work for them however carefully
 * they follow it. That is the exact "walk the recipient's path" failure this project has
 * already been bitten by once.
 *
 * So the build records the truth about itself. Here that is an ABSOLUTE path, because a
 * relative `cd server` is only correct if the reader's shell happens to be sitting in
 * the repository root. The packager overwrites this file with the scan-only variant.
 */
{
  const { writeFileSync, existsSync } = await import('node:fs');
  const root = process.cwd();
  const venv = `${root}/server/.venv/bin/uvicorn`;
  writeFileSync('extension/build-info.json', `${JSON.stringify({
    variant: 'repo',
    root,
    // Needed on a fresh clone: the venv does not exist until setup runs.
    setupNeeded: !existsSync(venv),
    setupCommand: `cd ${JSON.stringify(root)} && ./setup.sh`,
    // Two processes, and the panel can only see one of them. ollama first: uvicorn
    // starts happily without it and then reports the model missing, which reads as a
    // different fault than it is.
    /**
     * NO `cd`, and no shell chaining. One absolute command per line.
     *
     * The original advice was `cd server && .venv/bin/uvicorn main:app --port 8975`,
     * which is wrong twice over: both paths are relative, so the command only works
     * if the reader's shell already sits in the repository root. Verifying it by
     * pasting it the way a user would showed both halves failing in turn — first
     * "no such file or directory" for the binary, then `Could not import module
     * "main"` once the binary was absolute but the cd had not taken effect.
     *
     * `--app-dir` tells uvicorn where to import from, so the command depends on no
     * working directory at all and survives being pasted anywhere.
     */
    startCommands: [
      'ollama serve',
      `${JSON.stringify(`${root}/server/.venv/bin/uvicorn`)} main:app --port 8975`
        + ` --app-dir ${JSON.stringify(`${root}/server`)}`,
    ],
  }, null, 2)}\n`);
  console.log(`stamped extension/build-info.json (repo build at ${root})`);
}

/**
 * Vendor the panel's typefaces into the extension.
 *
 * MV3 forbids remote code and a Google Fonts <link> is both a remote fetch and a
 * privacy leak — on a tool whose entire claim is that nothing leaves the machine,
 * the panel calling out to fonts.googleapis.com on open would be the single most
 * embarrassing byte in the project. They ship locally or not at all.
 *
 * Inter is the variable file: one 48 KB woff2 covers every weight we use.
 */
{
  const { cpSync, mkdirSync, rmSync } = await import('node:fs');
  const FONTS = 'extension/fonts';
  /**
   * CLEAR IT FIRST — the same rule as extension/dist above, learned the same way.
   *
   * Vendoring without clearing leaves every font a previous design used sitting in the
   * directory, and the packager ships whatever is there. Inter and three weights of
   * JetBrains Mono survived the move to Geist and Archivo Black and were going out in
   * the zip: 91 KB of typefaces no stylesheet references, downloaded by everyone.
   */
  rmSync(FONTS, { recursive: true, force: true });
  mkdirSync(FONTS, { recursive: true });
  // Three roles, three faces. Archivo Black for the wordmark and the headline
  // figures — heavy, square, institutional, the register of a stamp on a
  // government form. Geist for UI text and Geist Mono for tokens and byte
  // counts; both are variable, so one file each covers every weight.
  const vendor = [
    ['node_modules/@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2',
     `${FONTS}/archivo-black.woff2`],
    ['node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
     `${FONTS}/geist-var.woff2`],
    ['node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2',
     `${FONTS}/geist-mono-var.woff2`],
  ];
  for (const [from, to] of vendor) cpSync(from, to);
  console.log(`vendored ${vendor.length} font files -> ${FONTS}/`);
}

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
