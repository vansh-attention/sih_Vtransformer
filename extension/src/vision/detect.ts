/**
 * Face detection + redaction, running in the offscreen document. SIH26171.
 *
 * The pure geometry lives in `faces.ts` and is unit-tested without a browser. This file
 * is the part that genuinely needs a canvas and an inference session, kept deliberately
 * thin so there is little here that can be wrong without a test catching it.
 */

import * as ort from 'onnxruntime-web/webgpu';
import type { BoundingBox } from '../contracts.ts';
import {
  computeLetterbox, decodeDetections, expandForRedaction,
  FACE_INPUT_H, FACE_INPUT_W, type Detection,
} from './faces.ts';

let session: ort.InferenceSession | null = null;
let backend: string | null = null;

export async function loadFaceModel(url: string): Promise<{ ms: number; backend: string }> {
  if (session) return { ms: 0, backend: backend! };

  ort.env.wasm.wasmPaths = chrome.runtime.getURL('ort/');
  ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);

  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const t0 = performance.now();

  // Same ladder as the main model: WebGPU, then WASM. Spike B measured the fallback
  // cost, so degrading is a known loss rather than a surprise.
  for (const ep of ['webgpu', 'wasm'] as const) {
    try {
      session = await ort.InferenceSession.create(buf, { executionProviders: [ep] });
      backend = ep;
      return { ms: Math.round(performance.now() - t0), backend: ep };
    } catch (e) {
      console.warn(`[vision] face model: ${ep} unavailable`, e);
    }
  }
  throw new Error('face model: no execution provider available');
}

/**
 * Letterbox an image into the model's fixed input and produce the NCHW tensor.
 *
 * Padding is mid-grey (127), which normalises to exactly 0 — so the padding contributes
 * nothing to the activations. Black padding would look like a strong edge to the model
 * and can invent detections along the border.
 */
function preprocess(bitmap: ImageBitmap): Float32Array {
  const lb = computeLetterbox(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(FACE_INPUT_W, FACE_INPUT_H);
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgb(127,127,127)';
  ctx.fillRect(0, 0, FACE_INPUT_W, FACE_INPUT_H);
  ctx.drawImage(bitmap, lb.padX, lb.padY, lb.drawW, lb.drawH);

  const { data } = ctx.getImageData(0, 0, FACE_INPUT_W, FACE_INPUT_H);
  const n = FACE_INPUT_W * FACE_INPUT_H;
  const out = new Float32Array(3 * n);

  // RGBA interleaved -> planar RGB, normalised (p - 127) / 128.
  for (let i = 0; i < n; i++) {
    out[i]         = (data[i * 4]     - 127) / 128;
    out[n + i]     = (data[i * 4 + 1] - 127) / 128;
    out[2 * n + i] = (data[i * 4 + 2] - 127) / 128;
  }
  return out;
}

export interface DetectResult {
  detections: Detection[];
  width: number;
  height: number;
  inferenceMs: number;
  backend: string | null;
}

export async function detectFaces(
  bitmap: ImageBitmap,
  threshold = 0.7,
): Promise<DetectResult> {
  if (!session) throw new Error('face model not loaded');

  const input = preprocess(bitmap);
  const feeds = {
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, FACE_INPUT_H, FACE_INPUT_W]),
  };

  const t0 = performance.now();
  const out = await session.run(feeds);
  const inferenceMs = Math.round((performance.now() - t0) * 10) / 10;

  // Output order is not guaranteed by name across exports, so identify the tensors by
  // their trailing dimension: scores are [1,N,2], boxes are [1,N,4].
  let scores: Float32Array | null = null;
  let boxes: Float32Array | null = null;
  for (const name of session.outputNames) {
    const t = out[name];
    const last = t.dims[t.dims.length - 1];
    if (last === 2) scores = t.data as Float32Array;
    if (last === 4) boxes = t.data as Float32Array;
  }
  if (!scores || !boxes) {
    throw new Error(`unexpected face model outputs: ${JSON.stringify(
      session.outputNames.map((n) => out[n].dims))}`);
  }

  return {
    detections: decodeDetections(scores, boxes, bitmap.width, bitmap.height, threshold),
    width: bitmap.width,
    height: bitmap.height,
    inferenceMs,
    backend,
  };
}

/**
 * Downscale and re-encode for transmission.
 *
 * Measured end to end: the payload was 156KB per turn and almost all of it was a
 * full-resolution PNG screenshot. On a Retina display `captureVisibleTab` returns
 * device pixels, so a 1200px viewport produces a 2400px image — twice the detail the
 * model can use, on every single turn.
 *
 * Safe to do because actions reference element IDs and the boxes travel separately in
 * CSS pixels. Nothing downstream reads image coordinates, so resolution is free to
 * change. If that ever stops being true, this becomes a bug.
 *
 * Runs AFTER blurring, so the redaction is applied at full resolution and the
 * downscale cannot smear a face back into legibility.
 */
export async function prepareForTransmission(
  source: ImageBitmap | OffscreenCanvas,
  maxWidth = 1024,
  quality = 0.8,
): Promise<{ dataUrl: string; width: number; height: number; bytes: number; stages: Record<string, number> }> {
  const srcW = source.width;
  const srcH = source.height;
  const scale = Math.min(1, maxWidth / srcW);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  // Resize via createImageBitmap, NOT canvas drawImage.
  //
  // Measured: `drawImage` with imageSmoothingQuality='high' from 2400x1314 down to
  // 1024 took ~1010ms per turn — an order of magnitude more than the face detection it
  // was feeding (17ms) and the dominant cost of the entire vision stage.
  // createImageBitmap's resize path is implemented natively and is far cheaper.
  const s0 = performance.now();
  const resized = await createImageBitmap(source, {
    resizeWidth: w, resizeHeight: h, resizeQuality: 'medium',
  });
  const s1 = performance.now();

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(resized, 0, 0);
  resized.close();
  const s2 = performance.now();

  // JPEG, not PNG: a screenshot is photographic enough that lossless encoding buys
  // nothing the model can use and costs several times the bytes.
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  const s3 = performance.now();

  const dataUrl = await new Promise<string>((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.readAsDataURL(blob);
  });
  const s4 = performance.now();

  return {
    dataUrl, width: w, height: h, bytes: dataUrl.length,
    stages: {
      resizeMs: Math.round(s1 - s0),
      drawMs: Math.round(s2 - s1),
      encodeMs: Math.round(s3 - s2),
      dataUrlMs: Math.round(s4 - s3),
    },
  };
}

/**
 * Blur the detected regions, in place, and return the redacted image.
 *
 * Uses canvas `filter: blur()` at a radius proportional to the face, so a small face is
 * blurred as thoroughly as a large one. A fixed radius leaves big faces recognisable —
 * the single most common way "we blurred the faces" turns out not to be true.
 */
export async function blurRegions(
  bitmap: ImageBitmap,
  boxes: BoundingBox[],
): Promise<{ canvas: OffscreenCanvas; applied: BoundingBox[] }> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);

  const applied: BoundingBox[] = [];
  for (const raw of boxes) {
    const box = expandForRedaction(raw);
    const w = Math.min(box.w, bitmap.width - box.x);
    const h = Math.min(box.h, bitmap.height - box.y);
    if (w <= 0 || h <= 0) continue;

    const radius = Math.max(8, Math.round(Math.min(w, h) / 4));

    ctx.save();
    // Clip so the blur cannot bleed outside the region and damage the surrounding
    // layout the server still needs to read.
    ctx.beginPath();
    ctx.rect(box.x, box.y, w, h);
    ctx.clip();
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(bitmap, 0, 0);
    ctx.restore();

    applied.push({ x: box.x, y: box.y, w, h });
  }

  return { canvas, applied };
}
