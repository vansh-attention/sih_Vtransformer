/**
 * Crop classification — SIH26171. The non-face half of the vision layer.
 *
 * The DOM tells us an `<img>` exists, its position, and its alt text if the author
 * bothered. It cannot tell us what is IN the image, what a `<canvas>` is drawing, or
 * what is inside a cross-origin `<iframe>`. Those regions are exactly what the extractor
 * flags with `needsVision`, and this is what looks at them.
 *
 * Model: MobileViT-small, fp32, WebGPU. ~10 ms/crop (Spike A1).
 * fp32 ON PURPOSE — int8 is ~10x SLOWER on WebGPU because ORT has no native int8 matmul
 * there. See spikes/a-webgpu-vit/FINDINGS.md before "optimising" this to a smaller file.
 *
 * HONEST LIMITS
 * This is an ImageNet-1k classifier. Its vocabulary is objects and animals, not user
 * interfaces, so on a screenshot crop it returns things like "web site", "envelope" or
 * "monitor". That is genuinely useful for photographic content and genuinely weak for
 * UI chrome. We report the confidence and let the prompt decide whether to trust it,
 * rather than dressing a 12% guess up as a description.
 *
 * The high-value signal is PERSON PRESENCE: a large share of ImageNet classes are
 * garments and accessories, so a crop coming back "suit" / "jersey" / "sunglasses" is
 * strong evidence a human being is in that image — a PII signal the DOM cannot give us.
 */

import * as ort from 'onnxruntime-web/webgpu';
import type { BoundingBox } from '../contracts.ts';

const INPUT_SIDE = 256;   // MobileViT's exported graph hard-codes 256x256.

let session: ort.InferenceSession | null = null;
let labels: string[] = [];
let backend: string | null = null;

/**
 * ImageNet classes that imply a person is present.
 *
 * The classifier has no "person" class — ImageNet-1k deliberately excludes one — so
 * clothing and accessories are the proxy. Treated as a PII HINT, never as a redaction
 * on its own: the face detector decides what gets blurred. This only raises the
 * question.
 */
const PERSON_INDICATORS = new Set([
  'suit', 'jersey', 'sweatshirt', 'cardigan', 'jean', 'miniskirt', 'gown',
  'academic gown', 'bow tie', 'Windsor tie', 'necklace', 'sunglasses',
  'sunglass', 'lab coat', 'kimono', 'poncho', 'brassiere', 'maillot',
  'swimming trunks', 'bathing cap', 'football helmet', 'crash helmet',
  'baseball player', 'scuba diver', 'groom', 'bridegroom',
]);

export async function loadClassifier(
  modelUrl: string,
  labelsUrl: string,
): Promise<{ ms: number; backend: string }> {
  if (session) return { ms: 0, backend: backend! };

  ort.env.wasm.wasmPaths = chrome.runtime.getURL('ort/');
  labels = await (await fetch(labelsUrl)).json();

  const buf = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer());
  const t0 = performance.now();
  for (const ep of ['webgpu', 'wasm'] as const) {
    try {
      session = await ort.InferenceSession.create(buf, { executionProviders: [ep] });
      backend = ep;
      return { ms: Math.round(performance.now() - t0), backend: ep };
    } catch (e) {
      console.warn(`[vision] classifier: ${ep} unavailable`, e);
    }
  }
  throw new Error('classifier: no execution provider available');
}

function softmaxTop(logits: Float32Array, k: number): Array<{ label: string; p: number }> {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  let sum = 0;
  const exp = new Float32Array(logits.length);
  for (let i = 0; i < logits.length; i++) { exp[i] = Math.exp(logits[i] - max); sum += exp[i]; }

  return Array.from(exp, (v, i) => ({ label: labels[i] ?? `class_${i}`, p: v / sum }))
    .sort((a, b) => b.p - a.p)
    .slice(0, k);
}

export interface CropResult {
  id: string;
  label: string;
  confidence: number;
  likelyPerson: boolean;
  top: Array<{ label: string; p: number }>;
}

/**
 * Classify one region of an already-captured screenshot.
 *
 * Crops rather than the whole frame: running the model on the full page would cost
 * ~10 ms for a single averaged answer about everything at once, which is useless. The
 * DOM already told us exactly which regions it cannot describe.
 */
export async function classifyCrop(
  bitmap: ImageBitmap,
  box: BoundingBox,
  id: string,
): Promise<CropResult | null> {
  if (!session) throw new Error('classifier not loaded');

  // Tiny regions carry no classifiable content and would burn 10ms to return noise.
  if (box.w < 24 || box.h < 24) return null;

  const canvas = new OffscreenCanvas(INPUT_SIDE, INPUT_SIDE);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, INPUT_SIDE, INPUT_SIDE);

  const { data } = ctx.getImageData(0, 0, INPUT_SIDE, INPUT_SIDE);
  const n = INPUT_SIDE * INPUT_SIDE;
  const input = new Float32Array(3 * n);
  // MobileViT was trained on plain 0..1 inputs, without ImageNet mean/std normalisation.
  for (let i = 0; i < n; i++) {
    input[i]         = data[i * 4] / 255;
    input[n + i]     = data[i * 4 + 1] / 255;
    input[2 * n + i] = data[i * 4 + 2] / 255;
  }

  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, INPUT_SIDE, INPUT_SIDE]),
  });
  const logits = out[session.outputNames[0]].data as Float32Array;
  const top = softmaxTop(logits, 3);

  return {
    id,
    label: top[0].label,
    confidence: Math.round(top[0].p * 1000) / 1000,
    likelyPerson: top.some((t) => PERSON_INDICATORS.has(t.label) && t.p > 0.08),
    top: top.map((t) => ({ label: t.label, p: Math.round(t.p * 1000) / 1000 })),
  };
}
