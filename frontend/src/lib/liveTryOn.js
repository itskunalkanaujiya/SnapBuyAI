import { API_URL } from "./products.js";

// Live try-on for sunglasses and watches: MediaPipe tracks the face or hand
// in the browser and the product's cut-out photo is drawn on top. Nothing is
// uploaded; the camera stream stays on the device.

// Keep in sync with the @mediapipe/tasks-vision version in package.json.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URLS = {
  glasses:
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  watch:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
};

// Face mesh points: face edges beside the eyes, and the eye corners.
const FACE = { left: 127, right: 356, eyes: [33, 133, 263, 362] };
// Hand points: wrist, index / middle / pinky knuckles.
const HAND = { wrist: 0, index: 5, middle: 9, pinky: 17 };

const SMOOTHING = 0.45; // share of the new position used each frame
const MAX_STRAP_RATIO = 2.4; // longest strap shown, relative to watch width

export function canTryOnLive(product) {
  return Boolean(product?.ar_category && (product.tryon_image_url || product.image_url));
}

/** The product photo with its background removed, as an ImageBitmap. */
export async function loadOverlay(product) {
  const params = new URLSearchParams({
    url: product.tryon_image_url || product.image_url,
    category: product.ar_category,
  });
  const response = await fetch(`${API_URL}/api/v1/tryon/overlay?${params}`);

  if (!response.ok) {
    let detail = "Couldn't prepare this product's photo. Try another listing.";
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Keep the default message.
    }
    throw new Error(detail);
  }
  return createImageBitmap(await response.blob());
}

/** Load the face (glasses) or hand (watch) tracker. */
export async function createTracker(category) {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
  const Task = category === "glasses" ? vision.FaceLandmarker : vision.HandLandmarker;
  const extra = category === "glasses" ? { numFaces: 1 } : { numHands: 1 };

  // The GPU is faster but not available everywhere; fall back to the CPU.
  for (const delegate of ["GPU", "CPU"]) {
    try {
      return await Task.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URLS[category], delegate },
        runningMode: "VIDEO",
        ...extra,
      });
    } catch (error) {
      if (delegate === "CPU") throw error;
    }
  }
  return null;
}

/** Landmarks of the first face or hand in a video frame or image. */
export function detect(tracker, source, timestamp) {
  const result = tracker.detectForVideo(source, timestamp);
  return (result.faceLandmarks || result.landmarks || [])[0] || null;
}

function point(landmarks, index, width, height, mirror) {
  const { x, y } = landmarks[index];
  return { x: (mirror ? 1 - x : x) * width, y: y * height };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(points) {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

/**
 * Where to draw the product: centre, width (px) and rotation (radians).
 * `size` scales the product and `lift` moves it along the face or arm.
 */
export function placement(category, landmarks, width, height, mirror, { size, lift }) {
  const at = (index) => point(landmarks, index, width, height, mirror);

  if (category === "glasses") {
    let left = at(FACE.left);
    let right = at(FACE.right);
    if (right.x < left.x) [left, right] = [right, left];

    const faceWidth = distance(left, right);
    const angle = Math.atan2(right.y - left.y, right.x - left.x);
    const eyes = average(FACE.eyes.map(at));
    // `lift` moves the frame up or down the nose (perpendicular to the eyes).
    const shift = -lift * faceWidth * 0.25;
    return {
      x: eyes.x - Math.sin(angle) * shift,
      y: eyes.y + Math.cos(angle) * shift,
      width: faceWidth * 1.02 * size,
      angle,
    };
  }

  const wrist = at(HAND.wrist);
  const middle = at(HAND.middle);
  const handLength = distance(wrist, middle);
  const palmWidth = distance(at(HAND.index), at(HAND.pinky));
  const towardFingers = {
    x: (middle.x - wrist.x) / (handLength || 1),
    y: (middle.y - wrist.y) / (handLength || 1),
  };
  // Watches sit a little way down the forearm from the wrist joint.
  const offset = handLength * (0.22 - lift * 0.2);
  return {
    x: wrist.x - towardFingers.x * offset,
    y: wrist.y - towardFingers.y * offset,
    // The palm looks narrow when the hand turns sideways; keep a minimum.
    width: Math.max(palmWidth, handLength * 0.55) * 0.9 * size,
    // Turn the photo so the strap runs along the arm.
    angle: Math.atan2(towardFingers.y, towardFingers.x) + Math.PI / 2,
  };
}

function blendAngle(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return from + delta * SMOOTHING;
}

/** Ease towards the new placement to hide tracking jitter. */
export function smooth(previous, next) {
  if (!previous) return next;
  return {
    x: previous.x + (next.x - previous.x) * SMOOTHING,
    y: previous.y + (next.y - previous.y) * SMOOTHING,
    width: previous.width + (next.width - previous.width) * SMOOTHING,
    angle: blendAngle(previous.angle, next.angle),
  };
}

/** Draw the product photo at a placement. */
export function drawProduct(context, overlay, category, place) {
  let source = { x: 0, y: 0, width: overlay.width, height: overlay.height };
  let turn = 0;

  if (category === "watch") {
    // Photos with the strap running sideways are turned upright.
    if (overlay.width > overlay.height * 1.25) turn = Math.PI / 2;
    // Very long straps are cropped to the part around the dial.
    const across = turn ? source.height : source.width;
    const along = turn ? source.width : source.height;
    const maxAlong = across * MAX_STRAP_RATIO;
    if (along > maxAlong) {
      const cut = (along - maxAlong) / 2;
      source = turn
        ? { x: cut, y: 0, width: maxAlong, height: source.height }
        : { x: 0, y: cut, width: source.width, height: maxAlong };
    }
  }

  const across = turn ? source.height : source.width;
  const scale = place.width / across;
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;

  context.save();
  context.translate(place.x, place.y);
  context.rotate(place.angle + turn);
  context.drawImage(
    overlay,
    source.x,
    source.y,
    source.width,
    source.height,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight
  );
  context.restore();
}
