import * as THREE from "three";

// 3D live try-on. The head (or wrist) pose comes from the tracked landmarks
// and a small 3D model is built for each product:
//   glasses: the product photo as a curved front frame, 3D temple arms in the
//            frame's colour running back to the ears, and an invisible head
//            shape that hides whatever goes behind the head;
//   watches: the product photo wrapped around the wrist, following its tilt.
// Everything is in video pixels, with an orthographic camera, and rendered
// on a transparent canvas that is drawn over the video frame.

const SMOOTHING = 0.5;
const LENS_SPREAD = 1.18; // lens-centre distance / pupil distance
const LENS_DROP = 0.06; // lens centre below the pupils, share of pupil distance
const FRONT_BEND = 0.12; // how far the frame ends curve back, share of width
const WRIST_BEND = 0.35; // how far the strap edges wrap back, share of width
const MAX_STRAP_RATIO = 2.4;

// Face mesh points.
const IRIS = [468, 473];
const EYE_CORNERS = [33, 263];
const FOREHEAD = 10;
const CHIN = 152;
const NOSE_BRIDGE = 168;
const FACE_SIDES = [127, 356];
// Hand points.
const HAND = { wrist: 0, index: 5, middle: 9, pinky: 17 };

function toCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas;
}

function texture(canvas) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

/**
 * The frame's colour and hinge height (fraction of the photo height), read
 * from the outer ends of the glasses photo where the arms attach.
 */
function readHinges(canvas) {
  const { width, height } = canvas;
  const pixels = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const edge = Math.max(2, Math.round(width * 0.06));
  let red = 0, green = 0, blue = 0, rows = 0, count = 0;

  for (let y = 0; y < height; y += 1) {
    for (const x0 of [0, width - edge]) {
      for (let x = x0; x < x0 + edge; x += 1) {
        const i = (y * width + x) * 4;
        if (pixels[i + 3] < 200) continue;
        red += pixels[i];
        green += pixels[i + 1];
        blue += pixels[i + 2];
        rows += y;
        count += 1;
      }
    }
  }
  if (!count) return { color: new THREE.Color(0x2a2a2e), hingeY: 0.3 };
  const color = new THREE.Color().setRGB(red / count / 255, green / count / 255, blue / count / 255, THREE.SRGBColorSpace);
  return { color, hingeY: rows / count / height };
}

/** A plane whose sides curve back (negative z) like a frame or a strap. */
function curvedPlane(width, height, depth, offsetX = 0) {
  const geometry = new THREE.PlaneGeometry(width, height, 32, 1);
  const position = geometry.attributes.position;
  const half = width / 2;
  for (let i = 0; i < position.count; i += 1) {
    const x = (position.getX(i) + offsetX) / half;
    position.setZ(i, -depth * x * x);
  }
  position.needsUpdate = true;
  return geometry;
}

function smoothPose(previous, next) {
  if (!previous) return next;
  return {
    position: previous.position.clone().lerp(next.position, SMOOTHING),
    quaternion: previous.quaternion.clone().slerp(next.quaternion, SMOOTHING),
    scale: previous.scale + (next.scale - previous.scale) * SMOOTHING,
    extra: next.extra,
  };
}

function basis(xAxis, yHint) {
  const x = xAxis.clone().normalize();
  const y = yHint.clone().sub(x.clone().multiplyScalar(x.dot(yHint))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return { x, y, z, quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)) };
}

// --------------------------------------------------
// Glasses
// --------------------------------------------------

function buildGlasses(overlay) {
  const canvas = toCanvas(overlay.image);
  const { color, hingeY } = readHinges(canvas);
  const [leftX, leftY, rightX, rightY] = overlay.centres || [0.25, 0.5, 0.75, 0.5];

  // Model units: 1 = the distance between the lens centres.
  const width = 1 / (rightX - leftX);
  const height = width * (canvas.height / canvas.width);
  const offsetX = (0.5 - (leftX + rightX) / 2) * width;
  const offsetY = ((leftY + rightY) / 2 - 0.5) * height;
  const bend = FRONT_BEND * width;

  const glasses = new THREE.Group();
  const front = new THREE.Mesh(
    curvedPlane(width, height, bend, offsetX),
    new THREE.MeshBasicMaterial({ map: texture(canvas), transparent: true, side: THREE.DoubleSide, depthTest: false })
  );
  front.position.set(offsetX, offsetY, 0);
  front.renderOrder = 2;
  glasses.add(front);

  const templeMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25 });
  const temples = [-1, 1].map((side) => {
    const temple = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.085, 1), templeMaterial);
    temple.renderOrder = 1;
    glasses.add(temple);
    return { side, mesh: temple };
  });

  const hinge = {
    x: (width / 2) * 0.96,
    y: offsetY + (0.5 - hingeY) * height,
    z: -bend * 0.96 * 0.96,
  };
  return { glasses, front, temples, hinge };
}

function placeTemples(model, faceHalfWidth, templeLength) {
  for (const { side, mesh } of model.temples) {
    const start = new THREE.Vector3(side * model.hinge.x, model.hinge.y, model.hinge.z);
    const end = new THREE.Vector3(
      side * Math.max(model.hinge.x, faceHalfWidth * 0.98),
      model.hinge.y - templeLength * 0.08,
      model.hinge.z - templeLength
    );
    const direction = end.clone().sub(start);
    mesh.scale.set(1, 1, direction.length());
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
  }
}

function glassesPose(landmarks, width, height, { size, lift }) {
  const at = (index) => {
    const { x, y, z } = landmarks[index];
    return new THREE.Vector3(x * width, (1 - y) * height, -z * width);
  };
  const [left, right] =
    landmarks.length > IRIS[1] ? IRIS.map(at) : EYE_CORNERS.map(at);
  const pupils = left.distanceTo(right);
  const axes = basis(at(EYE_CORNERS[1]).sub(at(EYE_CORNERS[0])), at(FOREHEAD).sub(at(CHIN)));

  const middle = left.clone().add(right).multiplyScalar(0.5);
  // The frame rests on the nose bridge, a little in front of the eyes.
  const frontDepth = at(NOSE_BRIDGE).sub(middle).dot(axes.z) + pupils * 0.03;
  const drop = (LENS_DROP - lift * 0.3) * pupils;
  const position = middle
    .add(axes.y.clone().multiplyScalar(-drop))
    .add(axes.z.clone().multiplyScalar(frontDepth));

  const faceWidth = at(FACE_SIDES[0]).distanceTo(at(FACE_SIDES[1]));
  const scale = pupils * LENS_SPREAD * size;
  return {
    position,
    quaternion: axes.quaternion,
    scale,
    // Head size in model units (the glasses group is scaled by `scale`).
    extra: { faceHalf: faceWidth / 2 / scale, depth: frontDepth / scale, pupils },
  };
}

// --------------------------------------------------
// Watches
// --------------------------------------------------

function buildWatch(overlay) {
  const source = overlay.image;
  // Upright: strap running top to bottom, long straps cropped near the dial.
  const turn = source.width > source.height * 1.25;
  const across = turn ? source.height : source.width;
  const along = Math.min(turn ? source.width : source.height, across * MAX_STRAP_RATIO);

  const canvas = document.createElement("canvas");
  canvas.width = across;
  canvas.height = along;
  const context = canvas.getContext("2d");
  context.translate(across / 2, along / 2);
  if (turn) context.rotate(Math.PI / 2);
  context.drawImage(source, -source.width / 2, -source.height / 2);

  const width = 1;
  const height = along / across;
  const mesh = new THREE.Mesh(
    curvedPlane(width, height, WRIST_BEND),
    new THREE.MeshBasicMaterial({ map: texture(canvas), transparent: true, side: THREE.DoubleSide })
  );
  const watch = new THREE.Group();
  watch.add(mesh);
  return { watch };
}

function watchPose(landmarks, width, height, { size, lift }) {
  const at = (index) => {
    const { x, y, z } = landmarks[index];
    return new THREE.Vector3(x * width, (1 - y) * height, -z * width);
  };
  const wrist = at(HAND.wrist);
  const towardFingers = at(HAND.middle).sub(wrist);
  const handLength = towardFingers.length();
  const acrossHand = at(HAND.pinky).sub(at(HAND.index));
  const palmWidth = acrossHand.length();

  // y along the arm (towards the fingers), x across the wrist, z out of the
  // back of the wrist, always facing the camera.
  let axes = basis(acrossHand, towardFingers);
  if (axes.z.z < 0) axes = basis(acrossHand.clone().negate(), towardFingers);

  const offset = handLength * (0.22 - lift * 0.2);
  const position = wrist.add(axes.y.clone().multiplyScalar(-offset));
  // The palm looks narrow when the hand turns sideways; keep a minimum.
  const scale = Math.max(palmWidth, handLength * 0.55) * 0.9 * size;
  return { position, quaternion: axes.quaternion, scale, extra: null };
}

// --------------------------------------------------
// Scene
// --------------------------------------------------

/**
 * Create the 3D try-on for a product. Returns
 * { render(landmarks, width, height, adjust, still) → canvas | null, dispose() }
 * or null when WebGL isn't available.
 */
export function createTryOn3d(category, overlay) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const light = new THREE.DirectionalLight(0xffffff, 1.4);
  light.position.set(0.3, 0.6, 1);
  scene.add(light);
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -100000, 100000);

  const pivot = new THREE.Group();
  scene.add(pivot);

  let model;
  let head = null;
  if (category === "glasses") {
    model = buildGlasses(overlay);
    pivot.add(model.glasses);
    // Invisible head: writes depth only, so arms behind the head are hidden.
    head = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      new THREE.MeshBasicMaterial({ colorWrite: false })
    );
    head.renderOrder = 0;
    pivot.add(head);
  } else {
    model = buildWatch(overlay);
    pivot.add(model.watch);
  }

  let pose = null;

  function render(landmarks, width, height, adjust, still = false) {
    if (!landmarks) {
      pose = null;
      return null;
    }
    if (renderer.domElement.width !== width || renderer.domElement.height !== height) {
      renderer.setSize(width, height, false);
      camera.right = width;
      camera.top = height;
      camera.updateProjectionMatrix();
    }

    const next = category === "glasses"
      ? glassesPose(landmarks, width, height, adjust)
      : watchPose(landmarks, width, height, adjust);
    pose = still ? next : smoothPose(pose, next);

    pivot.position.copy(pose.position);
    pivot.quaternion.copy(pose.quaternion);
    pivot.scale.setScalar(pose.scale);

    if (head && pose.extra) {
      const { faceHalf, depth } = pose.extra;
      placeTemples(model, faceHalf, faceHalf * 1.9);
      // Ellipsoid roughly the size of the head, its front at the eyes.
      const radiusZ = faceHalf * 1.25;
      head.scale.set(faceHalf * 0.9, faceHalf * 1.35, radiusZ);
      head.position.set(0, faceHalf * 0.2, -depth - radiusZ * 0.92);
    }

    renderer.render(scene, camera);
    return renderer.domElement;
  }

  function dispose() {
    scene.traverse((object) => {
      object.geometry?.dispose();
      object.material?.map?.dispose();
      object.material?.dispose();
    });
    renderer.dispose();
  }

  return { render, dispose };
}
