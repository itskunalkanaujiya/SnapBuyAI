import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { BeforeAfter } from "./TryOnDialog.jsx";
import { formatPrice } from "../lib/products.js";
import { photoToDataUrl } from "../lib/tryon.js";
import {
  createTracker,
  detect,
  drawProduct,
  forgetAccessoryPhoto,
  loadOverlay,
  placement,
  readAccessoryPhoto,
  saveAccessoryPhoto,
} from "../lib/accessoryTryOn.js";

const COPY = {
  glasses: {
    upload: "Upload a photo of your face",
    hint: "Front-facing, eyes open, good light",
    lookFor: "Finding your eyes…",
    missing:
      "Couldn't find a face in this photo. Use a clear, front-facing photo with both eyes visible.",
    tip: "Best results: a straight-on photo of your face, no other glasses on. Use the sliders if the frame sits a little off.",
  },
  watch: {
    upload: "Upload a photo of your wrist",
    hint: "Back of the hand towards the camera, fingers up",
    lookFor: "Finding your wrist…",
    missing:
      "Couldn't find a hand in this photo. Use a clear photo of the back of your hand and wrist, fingers pointing up.",
    tip: "Best results: the back of your hand and wrist, fingers pointing up, plain background. Use the sliders to move the watch along your arm.",
  },
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't read that photo. Please try another one."));
    image.src = src;
  });
}

/**
 * Try on glasses or a watch on a photo: the product's real photo, cut out
 * of its background, is placed on the eyes or wrist found in the photo.
 * Everything happens in the browser; the photo isn't uploaded.
 */
export default function AccessoryTryOnDialog({ product, onClose }) {
  const category = product.ar_category;
  const copy = COPY[category] || COPY.glasses;
  const inputRef = useRef(null);
  const cameraRef = useRef(null);
  const trackerRef = useRef(null);
  const sceneRef = useRef(null); // { image, landmarks, overlay } for the current photo
  const [person, setPerson] = useState(() => readAccessoryPhoto(category));
  const [status, setStatus] = useState("idle"); // idle | working | done | error
  const [resultUrl, setResultUrl] = useState("");
  const [size, setSize] = useState(1);
  const [lift, setLift] = useState(0);
  const [error, setError] = useState("");

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
      trackerRef.current?.close?.();
    };
  }, [onClose]);

  // Draw the photo with the product on it, at the current size and position.
  const compose = useCallback((adjust) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { image, landmarks, overlay } = scene;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const place = placement(category, landmarks, canvas.width, canvas.height, false, adjust);
    drawProduct(context, overlay, category, place);
    setResultUrl(canvas.toDataURL("image/jpeg", 0.92));
  }, [category]);

  async function tryOn(photo = person) {
    if (!photo) return;
    setError("");
    setStatus("working");
    try {
      const [overlay, image] = await Promise.all([loadOverlay(product), loadImage(photo)]);
      trackerRef.current ??= await createTracker(category);
      const landmarks = detect(trackerRef.current, image);
      if (!landmarks) throw new Error(copy.missing);
      sceneRef.current = { image, landmarks, overlay };
      compose({ size, lift });
      setStatus("done");
    } catch (tryOnError) {
      setError(
        tryOnError instanceof TypeError
          ? "Couldn't load the try-on. Check your connection and try again."
          : tryOnError.message
      );
      setStatus("error");
    }
  }

  async function choosePhoto(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose a photo (JPG, PNG or WebP).");
      return;
    }
    try {
      const dataUrl = await photoToDataUrl(file);
      setPerson(dataUrl);
      saveAccessoryPhoto(category, dataUrl);
      setResultUrl("");
      await tryOn(dataUrl);
    } catch {
      setError("Couldn't read that photo. Please try another one.");
    }
  }

  function adjust(next) {
    const values = { size, lift, ...next };
    setSize(values.size);
    setLift(values.lift);
    compose(values);
  }

  function removePhoto() {
    forgetAccessoryPhoto(category);
    sceneRef.current = null;
    setPerson("");
    setResultUrl("");
    setStatus("idle");
  }

  const price = formatPrice(product);
  const productImage = product.tryon_image_url || product.image_url;

  return (
    <div className="modal-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal tryon-modal" role="dialog" aria-modal="true" aria-labelledby="accessory-title">
        <header className="modal-header">
          <div>
            <h2 id="accessory-title">
              <Icon name="sparkles" size={18} /> Virtual try-on
            </h2>
            <p>See the real {category === "watch" ? "watch on your wrist" : "frames on your face"} before you buy.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="tryon-body">
          {status === "done" && resultUrl ? (
            <div className="tryon-result">
              <BeforeAfter before={person} after={resultUrl} />
              <div className="accessory-adjust">
                <label>
                  <span>Size</span>
                  <input
                    type="range"
                    min="0.7"
                    max="1.4"
                    step="0.01"
                    value={size}
                    onChange={(event) => adjust({ size: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>{category === "watch" ? "Along the arm" : "Up / down"}</span>
                  <input
                    type="range"
                    min="-0.6"
                    max="0.6"
                    step="0.01"
                    value={lift}
                    onChange={(event) => adjust({ lift: Number(event.target.value) })}
                  />
                </label>
                <button type="button" className="button button-ghost button-sm" onClick={() => adjust({ size: 1, lift: 0 })}>
                  <Icon name="undo" size={14} />
                  Reset
                </button>
              </div>
            </div>
          ) : (
            <div className="tryon-inputs">
              <div className="tryon-slot">
                <span className="tryon-label">1. Your photo</span>
                {person ? (
                  <div className={`tryon-photo ${status === "working" ? "is-scanning" : ""}`}>
                    <img src={person} alt="Your photo" />
                    {status === "working" && <span className="scan-line" aria-hidden="true" />}
                  </div>
                ) : (
                  <button type="button" className="tryon-upload" onClick={() => inputRef.current?.click()}>
                    <Icon name="upload" size={22} />
                    <strong>{copy.upload}</strong>
                    <span>{copy.hint}</span>
                  </button>
                )}
                {status !== "working" && (
                  <div className="tryon-photo-actions">
                    <button type="button" className="button button-secondary button-sm" onClick={() => inputRef.current?.click()}>
                      <Icon name="upload" size={14} />
                      {person ? "Change" : "Upload"}
                    </button>
                    <button type="button" className="button button-secondary button-sm only-touch" onClick={() => cameraRef.current?.click()}>
                      <Icon name="camera" size={14} />
                      Camera
                    </button>
                    {person && (
                      <button type="button" className="button button-ghost button-sm" onClick={removePhoto}>
                        <Icon name="trash" size={14} />
                        Forget
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="tryon-plus" aria-hidden="true">+</div>

              <div className="tryon-slot">
                <span className="tryon-label">2. The item</span>
                <div className="tryon-garment">
                  <img src={productImage} alt={product.name} />
                </div>
                <p className="tryon-garment-name" title={product.name}>
                  {product.name}
                </p>
                <p className="tryon-garment-meta">
                  {product.marketplace}
                  {price ? ` · ${price}` : ""}
                </p>
              </div>
            </div>
          )}

          {status === "working" && (
            <p className="tryon-tip" aria-live="polite">
              <span className="spinner" />
              {copy.lookFor}
            </p>
          )}

          {error && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" size={17} />
              <span>{error}</span>
            </div>
          )}

          {status !== "done" && status !== "working" && (
            <p className="tryon-tip">
              <Icon name="sparkles" size={13} />
              {copy.tip}
            </p>
          )}
        </div>

        <footer className="modal-footer">
          <span className="tryon-privacy">
            <Icon name="shield" size={13} />
            Your photo stays on this device: the try-on is made in your browser, and the
            photo is saved here for next time.
          </span>
          <div className="modal-actions">
            {status === "done" ? (
              <>
                <a className="button button-secondary" href={resultUrl} download="snapbuy-try-on.jpg">
                  <Icon name="download" size={16} />
                  Download
                </a>
                <button type="button" className="button button-ghost" onClick={() => setStatus("idle")}>
                  Change photo
                </button>
                <button type="button" className="button button-primary" onClick={onClose}>
                  Try another item
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button-primary"
                onClick={() => tryOn()}
                disabled={!person || status === "working"}
              >
                <Icon name="sparkles" size={16} />
                {status === "error" ? "Try again" : "Try it on"}
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
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture={category === "watch" ? "environment" : "user"}
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
