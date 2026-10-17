import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { formatPrice } from "../lib/products.js";
import {
  createTracker,
  detect,
  drawProduct,
  loadOverlay,
  placement,
  smooth,
} from "../lib/liveTryOn.js";

const MAX_PHOTO_SIZE = 1280;

/**
 * Draw the product for these landmarks (null hides it) over the frame
 * already on the canvas. Uses the 3D scene when given, else the flat photo.
 * Returns whether anything was drawn.
 */
function drawTryOn(context, { landmarks, width, height, mirror, adjust, still, scene, overlay, category, state }) {
  if (scene) {
    const layer = scene.render(landmarks, width, height, adjust, still);
    if (!layer) return false;
    // The 3D layer is rendered in camera coordinates; mirror it like the video.
    context.save();
    if (mirror) {
      context.translate(width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(layer, 0, 0, width, height);
    context.restore();
    return true;
  }

  if (!landmarks) {
    state.place = null;
    return false;
  }
  const next = placement(category, landmarks, width, height, mirror, adjust);
  state.place = still ? next : smooth(state.place, next);
  drawProduct(context, overlay, category, state.place);
  return true;
}
// Frames without a face or hand before the product is hidden.
const MISSED_FRAMES = 6;

const COPY = {
  glasses: {
    title: "Try on live",
    lookFor: "Looking for your face…",
    tip: "Face the camera in good light. Use the sliders if the frame sits too high or wide.",
    upload: "Upload a front-facing photo of your face",
  },
  watch: {
    title: "Try on live",
    lookFor: "Show the back of your wrist to the camera…",
    tip: "Hold your hand up with the back of your wrist facing the camera, fingers pointing up.",
    upload: "Upload a photo of your hand and wrist",
  },
};

export default function LiveTryOnDialog({ product, onClose }) {
  const category = product.ar_category;
  const copy = COPY[category];

  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const inputRef = useRef(null);
  const trackerRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const photoRef = useRef(null); // { image, landmarks }
  const adjustRef = useRef({ size: 1, lift: 0 });
  const sceneRef = useRef(null); // 3D try-on, when WebGL is available
  const viewRef = useRef("3d");

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [source, setSource] = useState(null); // camera | photo | null
  const [facing, setFacing] = useState("user");
  const [found, setFound] = useState(false);
  const [size, setSize] = useState(1);
  const [lift, setLift] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState("3d"); // 3d | flat
  const [has3d, setHas3d] = useState(false);
  // Angled glasses photos only work as a 3D frame, not as a flat picture.
  const [canFlat, setCanFlat] = useState(true);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(
    async (facingMode) => {
      stopCamera();
      setNotice("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setFacing(facingMode);
        setSource("camera");
      } catch {
        setSource(null);
        setNotice("Couldn't open the camera. Allow camera access, or upload a photo instead.");
      }
    },
    [stopCamera]
  );

  // Load the tracker and the product cut-out, then open the camera.
  useEffect(() => {
    let cancelled = false;

    Promise.all([createTracker(category), loadOverlay(product), import("../lib/tryOn3d.js")])
      .then(([tracker, overlay, { createTryOn3d }]) => {
        if (cancelled) {
          tracker?.close();
          return;
        }
        trackerRef.current = tracker;
        overlayRef.current = overlay;
        sceneRef.current = createTryOn3d(category, overlay);
        setHas3d(Boolean(sceneRef.current));
        setCanFlat(category !== "glasses" || Boolean(overlay.centres));
        setStatus("ready");
        if (navigator.mediaDevices?.getUserMedia) startCamera("user");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(
          loadError instanceof TypeError
            ? "Couldn't load the live try-on. Check your connection and try again."
            : loadError.message
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
      stopCamera();
      trackerRef.current?.close();
      trackerRef.current = null;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [category, product, startCamera, stopCamera]);

  // Close on Escape and lock page scrolling while open.
  useEffect(() => {
    function handleKey(event) {
      if (event.key === "Escape") onClose();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Camera: track and draw every new video frame.
  useEffect(() => {
    if (source !== "camera") return undefined;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const mirror = facing === "user";
    let frame = 0;
    let lastTime = -1;
    let missed = MISSED_FRAMES;
    let current = null;
    let shown = false;
    const state = { place: null };

    function render() {
      frame = requestAnimationFrame(render);
      if (video.readyState < 2 || video.currentTime === lastTime) return;
      lastTime = video.currentTime;

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      context.save();
      if (mirror) {
        context.translate(width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(video, 0, 0, width, height);
      context.restore();

      const tracker = trackerRef.current;
      const landmarks = tracker ? detect(tracker, video, performance.now()) : null;
      // Brief tracking gaps keep the last position instead of flickering.
      if (landmarks) {
        missed = 0;
        current = landmarks;
      } else if (++missed >= MISSED_FRAMES) {
        current = null;
      }

      const drawn = drawTryOn(context, {
        landmarks: current,
        width,
        height,
        mirror,
        adjust: adjustRef.current,
        still: false,
        scene: viewRef.current === "3d" ? sceneRef.current : null,
        overlay: overlayRef.current,
        category,
        state,
      });
      if (drawn !== shown) {
        shown = drawn;
        setFound(shown);
      }
    }

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [source, facing, category]);

  // Photo: draw again whenever the sliders or the view change.
  useEffect(() => {
    adjustRef.current = { size, lift };
    viewRef.current = view;
    const photo = photoRef.current;
    if (source !== "photo" || !photo) return;

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const { image, landmarks } = photo;
    canvas.width = image.width;
    canvas.height = image.height;
    context.drawImage(image, 0, 0, image.width, image.height);
    drawTryOn(context, {
      landmarks,
      width: image.width,
      height: image.height,
      mirror: false,
      adjust: { size, lift },
      still: true,
      scene: view === "3d" ? sceneRef.current : null,
      overlay: overlayRef.current,
      category,
      state: { place: null },
    });
  }, [source, size, lift, view, category]);

  async function choosePhoto(file) {
    if (!file || !trackerRef.current) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Please choose a photo (JPG, PNG or WebP).");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(bitmap.width, bitmap.height));
      const image = document.createElement("canvas");
      image.width = Math.round(bitmap.width * scale);
      image.height = Math.round(bitmap.height * scale);
      image.getContext("2d").drawImage(bitmap, 0, 0, image.width, image.height);
      bitmap.close?.();

      stopCamera();
      // In video mode the tracker first looks where the last face or hand
      // was, so a new photo can take a few passes to be found.
      let landmarks = null;
      for (let pass = 0; pass < 3 && !landmarks; pass += 1) {
        landmarks = detect(trackerRef.current, image, performance.now() + pass);
      }
      photoRef.current = { image, landmarks };
      setFound(Boolean(landmarks));
      setNotice(
        landmarks
          ? ""
          : category === "glasses"
            ? "Couldn't find a face in that photo. Try a clear, front-facing one."
            : "Couldn't find a hand in that photo. Try one showing your whole hand and wrist."
      );
      // A new photo needs a redraw even when the source was already "photo".
      setSource(null);
      requestAnimationFrame(() => setSource("photo"));
    } catch {
      setNotice("Couldn't read that photo. Please try another one.");
    }
  }

  function saveSnapshot() {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "snapbuy-live-try-on.png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }

  const price = formatPrice(product);
  const showStage = source !== null;

  return (
    <div className="modal-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal tryon-modal live-modal" role="dialog" aria-modal="true" aria-labelledby="live-title">
        <header className="modal-header">
          <div>
            <h2 id="live-title">
              <Icon name="camera" size={18} /> {copy.title}
            </h2>
            <p>
              {category === "glasses" ? "See the frames on your face" : "See the watch on your wrist"}, live
              through your camera.
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="tryon-body">
          <div className="live-product">
            <img src={product.tryon_image_url || product.image_url} alt="" />
            <div>
              <p className="tryon-garment-name" title={product.name}>
                {product.name}
              </p>
              <p className="tryon-garment-meta">
                {product.marketplace}
                {price ? ` · ${price}` : ""}
              </p>
            </div>
          </div>

          <div className={`live-stage ${showStage ? "" : "is-empty"}`}>
            <video ref={videoRef} playsInline muted hidden />
            <canvas ref={canvasRef} className="live-canvas" hidden={!showStage} />

            {!showStage && (
              <div className="live-placeholder">
                {status === "loading" ? (
                  <>
                    <span className="spinner" />
                    <strong>Getting the live try-on ready…</strong>
                    <span>Loading {category === "glasses" ? "face" : "hand"} tracking</span>
                  </>
                ) : status === "ready" ? (
                  <>
                    <Icon name="camera" size={26} />
                    <strong>Use your camera or a photo</strong>
                    <span>{copy.upload}</span>
                  </>
                ) : (
                  <>
                    <Icon name="alert" size={26} />
                    <strong>Live try-on isn't available for this item</strong>
                  </>
                )}
              </div>
            )}

            {showStage && !found && source === "camera" && (
              <span className="live-hint" aria-live="polite">
                {copy.lookFor}
              </span>
            )}
            {source === "camera" && (
              <span className="live-badge">
                <span className="live-dot" /> Live
              </span>
            )}
            {showStage && has3d && canFlat && (
              <div className="live-view-toggle" role="group" aria-label="View">
                {[
                  ["3d", "3D"],
                  ["flat", "Flat"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={view === value ? "is-active" : ""}
                    aria-pressed={view === value}
                    onClick={() => setView(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" size={17} />
              <span>{error}</span>
            </div>
          )}
          {notice && !error && (
            <div className="alert alert-info" role="status">
              <Icon name="alert" size={17} />
              <span>{notice}</span>
            </div>
          )}

          {status === "ready" && (
            <div className="live-controls">
              <label className="live-slider">
                <span>Size</span>
                <input
                  type="range"
                  min="0.7"
                  max="1.4"
                  step="0.01"
                  value={size}
                  onChange={(event) => setSize(Number(event.target.value))}
                />
              </label>
              <label className="live-slider">
                <span>{category === "glasses" ? "Height" : "Position"}</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={lift}
                  onChange={(event) => setLift(Number(event.target.value))}
                />
              </label>
            </div>
          )}

          {status === "ready" && (
            <p className="tryon-tip">
              <Icon name="sparkles" size={13} />
              {copy.tip}
            </p>
          )}
        </div>

        <footer className="modal-footer">
          <span className="tryon-privacy">
            <Icon name="shield" size={13} />
            Runs entirely on your device — your camera and photos are never uploaded.
          </span>
          <div className="modal-actions">
            {status === "ready" && (
              <>
                {source === "camera" ? (
                  <button
                    type="button"
                    className="button button-ghost only-touch"
                    onClick={() => startCamera(facing === "user" ? "environment" : "user")}
                  >
                    <Icon name="refresh" size={16} />
                    Flip
                  </button>
                ) : (
                  <button type="button" className="button button-ghost" onClick={() => startCamera("user")}>
                    <Icon name="camera" size={16} />
                    Camera
                  </button>
                )}
                <button type="button" className="button button-secondary" onClick={() => inputRef.current?.click()}>
                  <Icon name="upload" size={16} />
                  Photo
                </button>
                <button type="button" className="button button-primary" onClick={saveSnapshot} disabled={!showStage}>
                  <Icon name="download" size={16} />
                  Save picture
                </button>
              </>
            )}
            {status === "error" && (
              <button type="button" className="button button-primary" onClick={onClose}>
                Close
              </button>
            )}
          </div>
        </footer>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(event) => {
            choosePhoto(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
