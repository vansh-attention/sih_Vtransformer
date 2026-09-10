/**
 * Vendors the ONNX Runtime binaries and downloads model weights.
 *
 * Neither is in git: together they are ~230MB and both are reproducible. Manifest V3
 * forbids remote code, so everything the extension uses must sit on disk locally —
 * hence vendoring rather than a CDN.
 *
 *   npm install && node setup.mjs
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, createWriteStream, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const ORT_DIST = 'node_modules/onnxruntime-web/dist';

/** Model choices are the outcome of Spike A1, not arbitrary. */
const MODELS = [
  {
    // The operating point: ~10ms/crop on WebGPU. fp32 ON PURPOSE — int8 is 10x SLOWER
    // on WebGPU because ORT has no native int8 matmul there. See FINDINGS.md.
    name: 'mobilevit_fp32.onnx',
    url: 'https://huggingface.co/Xenova/mobilevit-small/resolve/main/onnx/model.onnx',
    dests: ['extension/models', 'spikes/a-webgpu-vit'],
  },
  {
    name: 'mobilevit_int8.onnx',
    url: 'https://huggingface.co/Xenova/mobilevit-small/resolve/main/onnx/model_quantized.onnx',
    dests: ['spikes/a-webgpu-vit'],
  },
  {
    // Face detection. 1.2MB, MIT, from the ONNX Model Zoo. Size was the deciding
    // factor: client resources are 20% of the grade.
    name: 'ultraface_rfb320.onnx',
    url: 'https://media.githubusercontent.com/media/onnx/models/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx',
    dests: ['extension/models'],
  },
  {
    // Kept only so the spike can reproduce the "ViT-base is too slow" measurement.
    name: 'vit_base_int8.onnx',
    url: 'https://huggingface.co/Xenova/vit-base-patch16-224/resolve/main/onnx/model_quantized.onnx',
    dests: ['spikes/a-webgpu-vit'],
  },
];

function vendorOrt(dest) {
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of readdirSync(ORT_DIST)) {
    if (f.endsWith('.wasm') || f.endsWith('.mjs')) {
      copyFileSync(`${ORT_DIST}/${f}`, `${dest}/${f}`);
      n++;
    }
  }
  console.log(`  ${dest}: ${n} runtime files`);
}

async function fetchModel(m) {
  const first = `${m.dests[0]}/${m.name}`;
  mkdirSync(m.dests[0], { recursive: true });

  if (!existsSync(first)) {
    process.stdout.write(`  downloading ${m.name} ... `);
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`${m.name}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(first));
    console.log(`${(statSync(first).size / 1048576).toFixed(1)}MB`);
  } else {
    console.log(`  ${m.name} already present`);
  }

  for (const d of m.dests.slice(1)) {
    mkdirSync(d, { recursive: true });
    copyFileSync(first, `${d}/${m.name}`);
  }
}

if (!existsSync(ORT_DIST)) {
  console.error('onnxruntime-web not found. Run `npm install` first.');
  process.exit(1);
}

console.log('vendoring ONNX Runtime:');
vendorOrt('extension/ort');
vendorOrt('spikes/a-webgpu-vit/ort');

console.log('fetching models:');
for (const m of MODELS) await fetchModel(m);

// ---------------------------------------------------------------------------
// PII layer 3's name gazetteer, built from public datasets.
//
// Generated rather than committed: it is ~1MB of derived data. It is also NOT optional
// — without it layer 3 silently detects nothing, and a fresh clone fails two test files
// with no obvious cause. (Which is exactly what happened the first time setup.sh was
// run on a clean checkout.)
//
// Sources are taken WHOLESALE. No entry is ever added because it appears in
// bench/holdout/ — that would be tuning against the holdout.
// ---------------------------------------------------------------------------

const GAZETTEER = 'extension/models/name-gazetteer.json';
const NAME_SOURCES = {
  given: [
    'https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/first%20names/all.txt',
  ],
  family: [
    'https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/surnames/all.txt',
  ],
  // The general-purpose lists are Western-skewed; this product serves Indian users.
  givenCsv: [
    'https://raw.githubusercontent.com/laxmimerit/indian-names-dataset/master/Indian-Female-Names.csv',
    'https://raw.githubusercontent.com/laxmimerit/indian-names-dataset/master/Indian-Male-Names.csv',
  ],
};

async function buildGazetteer() {
  if (existsSync(GAZETTEER)) {
    console.log('  name gazetteer already present');
    return;
  }
  process.stdout.write('  building name gazetteer ... ');

  const clean = (s) => s.trim().toLowerCase();
  const valid = (s) => /^[a-z][a-z'-]*$/.test(s);

  const given = new Set();
  const family = new Set();

  for (const url of NAME_SOURCES.given) {
    const text = await (await fetch(url)).text();
    for (const line of text.split('\n')) {
      const n = clean(line);
      if (n.length >= 3 && valid(n)) given.add(n);
    }
  }
  for (const url of NAME_SOURCES.family) {
    const text = await (await fetch(url)).text();
    for (const line of text.split('\n')) {
      const n = clean(line);
      if (n.length >= 4 && valid(n)) family.add(n);
    }
  }
  for (const url of NAME_SOURCES.givenCsv) {
    const text = await (await fetch(url)).text();
    for (const line of text.split('\n').slice(1)) {
      const first = line.split(',')[0] ?? '';
      for (const tok of clean(first).split(/[\s.]+/)) {
        if (tok.length >= 3 && valid(tok)) given.add(tok);
      }
    }
  }

  mkdirSync('extension/models', { recursive: true });
  writeFileSync(GAZETTEER, JSON.stringify(
    { given: [...given].sort(), family: [...family].sort() }, null, 0));
  console.log(`${given.size} given, ${family.size} family, `
    + `${(statSync(GAZETTEER).size / 1024).toFixed(0)}KB`);
}

console.log('name gazetteer:');
await buildGazetteer();

// Test assets. Deliberately NOT committed: a repo should not carry third-party
// images, and this one is a real person's likeness.
const ASSETS = [{
  name: 'bench/assets/face-test.jpg',
  url: 'https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/messi5.jpg',
}];

console.log('fetching test assets:');
for (const a of ASSETS) {
  mkdirSync('bench/assets', { recursive: true });
  if (existsSync(a.name)) { console.log(`  ${a.name} already present`); continue; }
  const res = await fetch(a.url);
  if (!res.ok) throw new Error(`${a.name}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(a.name));
  console.log(`  ${a.name} ${(statSync(a.name).size / 1024).toFixed(0)}KB`);
}

console.log('\nsetup complete. Build with: node build.mjs');
