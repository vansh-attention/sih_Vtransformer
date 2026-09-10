/**
 * Vendors the ONNX Runtime binaries and downloads model weights.
 *
 * Neither is in git: together they are ~230MB and both are reproducible. Manifest V3
 * forbids remote code, so everything the extension uses must sit on disk locally —
 * hence vendoring rather than a CDN.
 *
 *   npm install && node setup.mjs
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, createWriteStream } from 'node:fs';
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

console.log('\nsetup complete. Build with: node build.mjs');
