import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { formatPrice } from "../lib/products.js";
import {
  forgetPerson,
  photoToDataUrl,
  readSavedPerson,
  requestTryOn,
  savePerson,
} from "../lib/tryon.js";

// Free GPU try-ons usually take 20–40 s; the bar eases towards 95% and the
// last stretch completes when the image arrives.
const TYPICAL_SECONDS = 14;

function statusMessage(seconds) {
  if (seconds < 3) return "Sending your photo…";
  if (seconds < 45) return "AI is dressing you — usually 20–40 seconds";
  return "The free GPUs are busy, still working…";
}

export function BeforeAfter({ before, after }) {
  const [position, setPosition] = useState(50);

  return (
    <div className="before-after">
      <img src={before} alt="Your photo" />
      <img
        src={after}
        alt="You wearing the selected item"
        className="before-after-top"
        style={{ clipPath: `inset(0 0 0 ${position}%)` }}
      />
      <span className="before-after-handle" style={{ left: `${position}%` }} aria-hidden="true" />
      <span className="before-after-tag tag-before">Before</span>
      <span className="before-after-tag tag-after">After</span>
      <input
        type="range"
        min="0"
        max="100"
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        aria-label="Compare before and after"
      />
    </div>
  );
}

export default function TryOnDialog({ product, onClose }) {
  const inputRef = useRef(null);
  const cameraRef = useRef(null);
  const [person, setPerson] = useState(readSavedPerson);
  const [status, setStatus] = useState("idle"); // idle | working | done | error
  const [elapsed, setElapsed] = useState(0);
  const [resultUrl, setResultUrl] = useState("");
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
    };
  }, [onClose]);

  useEffect(() => {
    if (status !== "working") return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  async function choosePhoto(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose a photo (JPG, PNG or WebP).");
      return;
    }
    try {
      const dataUrl = await photoToDataUrl(file);
      setPerson(dataUrl);
      savePerson(dataUrl);
      setResultUrl("");
      setStatus("idle");
      setError("");
    } catch {
      setError("Couldn't read that photo. Please try another one.");
    }
  }

  async function generate() {
    setError("");
    setElapsed(0);
    setStatus("working");
    try {
      const url = await requestTryOn(person, product);
      setResultUrl(url);
      setStatus("done");
    } catch (tryOnError) {
      setError(
        tryOnError instanceof TypeError
          ? "Can't reach the Vistora server. Check your connection and try again."
          : tryOnError.message
      );
      setStatus("error");
    }
  }

  function removePhoto() {
    forgetPerson();
    setPerson("");
    setResultUrl("");
    setStatus("idle");
  }

  const progress = status === "done" ? 100 : 95 * (1 - Math.exp(-elapsed / TYPICAL_SECONDS));
  const price = formatPrice(product);
  const garmentImage = product.tryon_image_url || product.image_url;
  const isLong = product.tryon_category !== "upper_body";

  return (
    <div className="modal-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal tryon-modal" role="dialog" aria-modal="true" aria-labelledby="tryon-title">
        <header className="modal-header">
          <div>
            <h2 id="tryon-title">
              <Icon name="sparkles" size={18} /> Virtual try-on
            </h2>
            <p>See how it looks on you before you buy.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="tryon-body">
          {status === "done" && resultUrl ? (
            <div className="tryon-result">
              <BeforeAfter before={person} after={resultUrl} />
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
                    <strong>Upload a photo of yourself</strong>
                    <span>Front-facing, standing straight, plain background</span>
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
                  <img src={garmentImage} alt={product.name} />
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
            <div className="search-progress tryon-progress" aria-live="polite">
              <div className="progress-head">
                <span>{statusMessage(elapsed)}</span>
                <span className="progress-percent">{Math.floor(elapsed)}s</span>
              </div>
              <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}>
                <span className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {error && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" size={17} />
              <span>{error}</span>
            </div>
          )}

          {status !== "done" && (
            <p className="tryon-tip">
              <Icon name="sparkles" size={13} />
              {isLong
                ? "Use a full-length photo so the whole outfit fits in the frame."
                : "Best results: a clear, front-facing photo showing your upper body. For kurtis and long tops, a full-length photo shows the full length."}
            </p>
          )}
        </div>

        <footer className="modal-footer">
          <span className="tryon-privacy">
            <Icon name="shield" size={13} />
            Your photo is sent to free AI models on Hugging Face only to create this
            try-on, and saved in this browser for next time.
          </span>
          <div className="modal-actions">
            {status === "done" ? (
              <>
                <a className="button button-secondary" href={resultUrl} download="vistora-try-on.jpg">
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
                className={`button button-primary ${status === "working" ? "is-loading" : ""}`}
                onClick={generate}
                disabled={!person || status === "working"}
              >
                {status === "working" ? (
                  <>
                    <span className="spinner spinner-light" />
                    Creating your look…
                  </>
                ) : (
                  <>
                    <Icon name="sparkles" size={16} />
                    {status === "error" ? "Try again" : "Try it on"}
                  </>
                )}
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
          capture="user"
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
