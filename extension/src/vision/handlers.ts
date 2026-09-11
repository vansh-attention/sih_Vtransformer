/**
 * Vision handlers — SIH26171. Host-agnostic.
 *
 * WHY THIS FILE IS SEPARATE FROM THE OFFSCREEN DOCUMENT
 *
 * Chrome MV3 puts background logic in a service worker, which has neither a DOM nor a
 * GPU, so the models must live in an offscreen document. **Firefox has no offscreen
 * documents at all** — but Firefox MV3 uses a background *event page*, which does have a
 * DOM. So the same code runs in a different host per browser, and none of it may assume
 * which one it is in.
 *
 * The PS names Chrome AND Firefox. This split is what makes that answerable rather than
 * aspirational.
 */

import type { BoundingBox } from '../contracts.ts';
import {
  loadFaceModel, detectFaces, blurRegions, prepareForTransmission, scaleToImage,
} from './detect.ts';
import { loadClassifier, classifyCrop } from './classify.ts';

/** Where models resolve their files from. Set once by whichever host boots first. */
let resolveUrl: (path: string) => string = (p) => p;
export function setUrlResolver(fn: (path: string) => string): void { resolveUrl = fn; }

/**
 * The most recent frame, kept decoded in this context.
 *
 * A full-resolution screenshot as a data URL is several megabytes of base64; passing it
 * back and forth so the classifier could re-decode it cost over a second per turn.
 */
let lastFrame: { bitmap: ImageBitmap; token: string } | null = null;

export interface VisionMessage {
  type: string;
  [k: string]: unknown;
}

export async function handleVisionMessage(msg: VisionMessage): Promise<unknown> {
  switch (msg.type) {
    case 'detect-faces': return detectFacesHandler(msg);
    case 'classify-crops': return classifyCropsHandler(msg);
    case 'sample-pixels': return samplePixelsHandler(msg);
    case 'region-stats': return regionStatsHandler(msg);
    case 'probe-encode': return probeEncodeHandler();
    default: return { error: `unknown vision message: ${msg.type}` };
  }
}

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.readAsDataURL(blob);
  });
}

async function detectFacesHandler(msg: VisionMessage): Promise<unknown> {
  const t0 = performance.now();
  const load = await loadFaceModel(resolveUrl('models/ultraface_rfb320.onnx'));
  const tLoad = performance.now();

  const blob = await (await fetch(msg.dataUrl as string)).blob();
  const bitmap = await createImageBitmap(blob);
  const tDecode = performance.now();

  const result = await detectFaces(bitmap, (msg.threshold as number) ?? 0.7);
  const tInfer = performance.now();

  let redactedDataUrl: string | undefined;
  let applied: unknown[] = [];
  let transmit: Awaited<ReturnType<typeof prepareForTransmission>> | undefined;

  const frameToken = `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  lastFrame = { bitmap, token: frameToken };

  /**
   * PII regions arrive in CSS viewport pixels and the frame is in device pixels — the
   * exact mismatch Spike C found, where a 2x Retina ratio silently drew every box in
   * the wrong place. Scale from the viewport the boxes were measured in, not from an
   * assumed devicePixelRatio.
   */
  const maskBoxes = scaleToImage(
    (msg.maskRegions as BoundingBox[] | undefined) ?? [],
    msg.maskViewport as { innerWidth: number; innerHeight: number } | undefined,
    bitmap,
  );

  let masked: unknown[] = [];
  // Note the `|| maskBoxes.length`: a page can carry PII and no face at all, and that
  // is the common case. Gating this on a face detection would leave every text value
  // legible on exactly the pages that matter most.
  if (msg.blur !== false && (result.detections.length || maskBoxes.length)) {
    const { canvas, applied: a, masked: m } = await blurRegions(
      bitmap, result.detections.map((d) => d.box), maskBoxes);
    applied = a;
    masked = m;
    // createImageBitmap COPIES; transferToImageBitmap would DETACH the canvas and leave
    // convertToBlob encoding an empty surface.
    lastFrame = { bitmap: await createImageBitmap(canvas), token: frameToken };

    if (msg.wantFullFrame) {
      redactedDataUrl = await toDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
    }
    if (msg.transmitReady !== false) transmit = await prepareForTransmission(lastFrame.bitmap);
  }

  return {
    ...result,
    loadMs: load.ms,
    stages: {
      modelLoadMs: Math.round(tLoad - t0),
      decodeMs: Math.round(tDecode - tLoad),
      detectMs: Math.round(tInfer - tDecode),
      blurAndEncodeMs: Math.round(performance.now() - tInfer),
      transmitStages: transmit?.stages,
      imagePx: bitmap.width * bitmap.height,
    },
    totalMs: Math.round(performance.now() - t0),
    appliedBoxes: applied,
    maskedBoxes: masked,
    redactedDataUrl,
    frameToken,
    transmit,
  };
}

async function classifyCropsHandler(msg: VisionMessage): Promise<unknown> {
  const t0 = performance.now();
  const load = await loadClassifier(
    resolveUrl('models/mobilevit_fp32.onnx'),
    resolveUrl('models/imagenet-labels.json'));

  let bitmap: ImageBitmap;
  if (msg.frameToken && lastFrame?.token === msg.frameToken) {
    bitmap = lastFrame.bitmap;
  } else {
    bitmap = await createImageBitmap(await (await fetch(msg.dataUrl as string)).blob());
  }

  const results = [];
  const crops = (msg.crops as Array<{ id: string; box: never }>) ?? [];
  for (const c of crops.slice(0, (msg.max as number) ?? 12)) {
    const r = await classifyCrop(bitmap, c.box, c.id);
    if (r) results.push(r);
  }
  return { results, loadMs: load.ms, backend: load.backend,
           totalMs: Math.round(performance.now() - t0) };
}

async function samplePixelsHandler(msg: VisionMessage): Promise<unknown> {
  const bitmap = await createImageBitmap(await (await fetch(msg.dataUrl as string)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);

  const points = msg.points as Array<{ name: string; x: number; y: number }>;
  const samples = points.map((p) => {
    const x = Math.round(p.x); const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
      return { name: p.name, x, y, outOfBounds: true, hex: null };
    }
    const d = ctx.getImageData(x, y, 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    return { name: p.name, x, y, outOfBounds: false, hex, rgb: [d[0], d[1], d[2]] };
  });
  return { width: bitmap.width, height: bitmap.height, samples };
}

async function regionStatsHandler(msg: VisionMessage): Promise<unknown> {
  const bitmap = await createImageBitmap(await (await fetch(msg.dataUrl as string)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);

  const r = msg.region as { x: number; y: number; w: number; h: number };
  const { data } = ctx.getImageData(r.x, r.y, r.w, r.h);

  // Luma variance is the right measure of "was detail destroyed". Absolute pixel change
  // is not: blurring a flat region barely moves its values.
  let sum = 0; let sumSq = 0;
  const n = r.w * r.h;
  for (let i = 0; i < n; i++) {
    const y = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    sum += y; sumSq += y * y;
  }
  const mean = sum / n;
  return { mean: Math.round(mean * 100) / 100,
           variance: Math.round((sumSq / n - mean * mean) * 100) / 100, pixels: n };
}

/** Diagnostic: is convertToBlob doing work, or is this host timer-throttled? */
async function probeEncodeHandler(): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  for (const side of [16, 256, 1024]) {
    const c = new OffscreenCanvas(side, side);
    const cx = c.getContext('2d')!;
    cx.fillStyle = '#345'; cx.fillRect(0, 0, side, side);
    const t = performance.now();
    await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    results[`${side}px`] = Math.round(performance.now() - t);
  }
  return results;
}
