/**
 * Face detection — SIH26171.
 *
 * The PS names "blurring faces" explicitly, and a face is PII that the DOM cannot see:
 * `<img src="avatar.jpg">` tells you nothing about whether a person is in it. This is
 * precisely the work the vision layer exists to do, and the reason it is load-bearing
 * rather than decorative.
 *
 * Model: UltraFace RFB-320 (ONNX Model Zoo, MIT). 1.2 MB.
 * Chosen for size — client resource utilisation is 20% of the grade, and a 1.2 MB
 * detector that runs in milliseconds beats a better one we cannot afford to ship.
 *
 * Everything here except the actual inference call is a pure function, so the fiddly
 * parts — letterbox mapping, NMS, coordinate conversion — are unit-testable with no
 * browser and no model. Those are exactly the parts that fail silently: a box that is
 * merely "about right" blurs the wrong region and nothing notices.
 */

import type { BoundingBox } from '../contracts.ts';

/** UltraFace RFB-320 expects 320x240 RGB, normalised to (p - 127) / 128. */
export const FACE_INPUT_W = 320;
export const FACE_INPUT_H = 240;

export interface Detection {
  /** In the coordinate space of the ORIGINAL image, not the model input. */
  box: BoundingBox;
  score: number;
}

/**
 * Letterbox geometry: how a WxH image maps into the model's fixed input, preserving
 * aspect ratio.
 *
 * Squashing to 320x240 instead would distort faces and cost recall, and — worse — the
 * boxes would come back in a stretched space that has to be un-stretched exactly right
 * on the way out. Letterboxing keeps the inverse mapping trivial and hard to get wrong.
 */
export interface Letterbox {
  scale: number;
  padX: number;
  padY: number;
  drawW: number;
  drawH: number;
}

export function computeLetterbox(srcW: number, srcH: number): Letterbox {
  const scale = Math.min(FACE_INPUT_W / srcW, FACE_INPUT_H / srcH);
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);
  return {
    scale,
    drawW,
    drawH,
    padX: Math.floor((FACE_INPUT_W - drawW) / 2),
    padY: Math.floor((FACE_INPUT_H - drawH) / 2),
  };
}

/**
 * Map a normalised model-space box ([0,1] over the 320x240 input) back to original
 * image pixels, undoing the letterbox padding.
 */
export function modelBoxToImage(
  x1: number, y1: number, x2: number, y2: number,
  lb: Letterbox, srcW: number, srcH: number,
): BoundingBox {
  const px1 = (x1 * FACE_INPUT_W - lb.padX) / lb.scale;
  const py1 = (y1 * FACE_INPUT_H - lb.padY) / lb.scale;
  const px2 = (x2 * FACE_INPUT_W - lb.padX) / lb.scale;
  const py2 = (y2 * FACE_INPUT_H - lb.padY) / lb.scale;

  // Clamp: a box that runs off the edge is still a real face, but a negative origin
  // breaks every downstream crop and blur.
  const cx1 = Math.max(0, Math.min(srcW, px1));
  const cy1 = Math.max(0, Math.min(srcH, py1));
  const cx2 = Math.max(0, Math.min(srcW, px2));
  const cy2 = Math.max(0, Math.min(srcH, py2));

  return {
    x: Math.round(cx1),
    y: Math.round(cy1),
    w: Math.round(cx2 - cx1),
    h: Math.round(cy2 - cy1),
  };
}

function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Standard greedy non-maximum suppression, highest score first. */
export function nms(dets: Detection[], iouThreshold = 0.3): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (!kept.some((k) => iou(k.box, d.box) > iouThreshold)) kept.push(d);
  }
  return kept;
}

/**
 * Decode raw UltraFace outputs.
 *
 * `scores` is [1, N, 2] — [background, face]. `boxes` is [1, N, 4] as normalised
 * x1,y1,x2,y2. The model emits 4420 candidates; almost all are background.
 */
export function decodeDetections(
  scores: Float32Array,
  boxes: Float32Array,
  srcW: number,
  srcH: number,
  threshold = 0.7,
): Detection[] {
  const n = scores.length / 2;
  const out: Detection[] = [];

  for (let i = 0; i < n; i++) {
    const faceScore = scores[i * 2 + 1];
    if (faceScore < threshold) continue;

    const lb = computeLetterbox(srcW, srcH);
    const box = modelBoxToImage(
      boxes[i * 4], boxes[i * 4 + 1], boxes[i * 4 + 2], boxes[i * 4 + 3],
      lb, srcW, srcH,
    );

    // Degenerate boxes survive thresholding surprisingly often and would produce
    // zero-area "blurs" that look like the system worked.
    if (box.w < 2 || box.h < 2) continue;

    out.push({ box, score: faceScore });
  }

  return nms(out);
}

/**
 * Grow a detected box before blurring.
 *
 * UltraFace boxes are tight around the facial features and leave hair, ears, jawline
 * and chin outside — all of which identify a person perfectly well. A tight blur looks
 * diligent and de-identifies nothing, which is the worst of both worlds: it costs
 * redaction precision AND leaks.
 */
export function expandForRedaction(box: BoundingBox, factor = 0.25): BoundingBox {
  const dx = Math.round(box.w * factor);
  const dy = Math.round(box.h * factor);
  return {
    x: Math.max(0, box.x - dx),
    y: Math.max(0, box.y - dy),
    w: box.w + dx * 2,
    h: box.h + dy * 2,
  };
}
