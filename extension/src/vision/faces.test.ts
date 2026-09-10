import {
  computeLetterbox, modelBoxToImage, nms, decodeDetections, expandForRedaction,
  FACE_INPUT_W, FACE_INPUT_H,
} from './faces.ts';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)}${detail}`);
};
const near = (a: number, b: number, tol = 1.5) => Math.abs(a - b) <= tol;

// --- letterbox geometry ----------------------------------------------------

const wide = computeLetterbox(640, 480);   // 4:3, same aspect as the model input
check('4:3 image fills the input exactly',
  wide.drawW === FACE_INPUT_W && wide.drawH === FACE_INPUT_H && wide.padX === 0 && wide.padY === 0,
  `draw=${wide.drawW}x${wide.drawH} pad=${wide.padX},${wide.padY}`);

const tall = computeLetterbox(400, 800);   // portrait: must pad horizontally
check('portrait image pads on X, not Y',
  tall.padX > 0 && tall.padY === 0 && tall.drawH === FACE_INPUT_H,
  `draw=${tall.drawW}x${tall.drawH} pad=${tall.padX},${tall.padY}`);

const panor = computeLetterbox(1600, 400); // panorama: must pad vertically
check('panoramic image pads on Y, not X',
  panor.padY > 0 && panor.padX === 0 && panor.drawW === FACE_INPUT_W,
  `draw=${panor.drawW}x${panor.drawH} pad=${panor.padX},${panor.padY}`);

// --- the inverse mapping, which is where silent errors live ----------------

// A box covering the whole letterboxed content must map back to the whole image.
for (const [w, h, label] of [[640, 480, '4:3'], [400, 800, 'portrait'], [1600, 400, 'panorama']] as const) {
  const lb = computeLetterbox(w, h);
  const nx1 = lb.padX / FACE_INPUT_W;
  const ny1 = lb.padY / FACE_INPUT_H;
  const nx2 = (lb.padX + lb.drawW) / FACE_INPUT_W;
  const ny2 = (lb.padY + lb.drawH) / FACE_INPUT_H;
  const box = modelBoxToImage(nx1, ny1, nx2, ny2, lb, w, h);
  check(`round-trip full frame (${label})`,
    near(box.x, 0, 2) && near(box.y, 0, 2) && near(box.w, w, 3) && near(box.h, h, 3),
    `-> ${box.x},${box.y} ${box.w}x${box.h} (want 0,0 ${w}x${h})`);
}

// Off-image coordinates must clamp, not produce negative origins.
const lb = computeLetterbox(640, 480);
const clamped = modelBoxToImage(-0.5, -0.5, 1.5, 1.5, lb, 640, 480);
check('out-of-frame box clamps to the image',
  clamped.x >= 0 && clamped.y >= 0 && clamped.x + clamped.w <= 640 && clamped.y + clamped.h <= 480,
  `-> ${clamped.x},${clamped.y} ${clamped.w}x${clamped.h}`);

// --- NMS -------------------------------------------------------------------

const overlapping = [
  { box: { x: 100, y: 100, w: 50, h: 50 }, score: 0.9 },
  { box: { x: 105, y: 103, w: 50, h: 50 }, score: 0.8 },  // same face, duplicate
  { box: { x: 300, y: 100, w: 50, h: 50 }, score: 0.7 },  // a different face
];
const kept = nms(overlapping);
check('NMS collapses duplicates, keeps distinct faces', kept.length === 2, `kept ${kept.length}`);
check('NMS keeps the highest-scoring duplicate', kept[0].score === 0.9);

// --- decode ----------------------------------------------------------------

// Two candidates: one confident face, one background. Only the face survives.
const scores = new Float32Array([0.02, 0.98, 0.99, 0.01]);
const boxes = new Float32Array([0.25, 0.25, 0.5, 0.5, 0, 0, 1, 1]);
const dets = decodeDetections(scores, boxes, 640, 480, 0.7);
check('decode keeps only above-threshold faces', dets.length === 1, `got ${dets.length}`);
check('decoded box lands in the image', dets.length === 1
  && dets[0].box.x > 0 && dets[0].box.w > 0 && dets[0].box.x + dets[0].box.w <= 640,
  dets.length ? `${dets[0].box.x},${dets[0].box.y} ${dets[0].box.w}x${dets[0].box.h}` : '');

// A degenerate box must not become a zero-area "blur" that looks like it worked.
const degenerate = decodeDetections(
  new Float32Array([0.01, 0.99]), new Float32Array([0.5, 0.5, 0.5001, 0.5001]), 640, 480, 0.7);
check('degenerate box is dropped', degenerate.length === 0, `got ${degenerate.length}`);

// --- expansion -------------------------------------------------------------

const tight = { x: 100, y: 100, w: 80, h: 80 };
const grown = expandForRedaction(tight);
check('redaction box grows past the tight face box',
  grown.x < tight.x && grown.y < tight.y && grown.w > tight.w && grown.h > tight.h,
  `${tight.w}x${tight.h} -> ${grown.w}x${grown.h}`);
check('expansion never produces a negative origin',
  expandForRedaction({ x: 2, y: 2, w: 40, h: 40 }).x >= 0);

console.log(fail ? `\n${fail} FAILURES` : '\nall face-geometry cases pass');
process.exit(fail ? 1 : 0);
