import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// Crop rectangle in fractions of the image (0–1), so it is independent of
// the on-screen size.
const INITIAL_RECT = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
const MIN_SIZE = 0.08;
const KEY_STEP = 0.02;
const HANDLES = ["nw", "ne", "sw", "se"];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function resizeRect(start, handle, dx, dy) {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_SIZE);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN_SIZE, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_SIZE);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_SIZE, 1);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

function moveRect(start, dx, dy) {
  return {
    ...start,
    x: clamp(start.x + dx, 0, 1 - start.w),
    y: clamp(start.y + dy, 0, 1 - start.h),
  };
}

export default function CropDialog({ src, fileName, onApply, onCancel }) {
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const applyRef = useRef(null);
  const [rect, setRect] = useState(INITIAL_RECT);
  const [natural, setNatural] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    applyRef.current?.focus();

    function handleKey(event) {
      if (event.key === "Escape") onCancel();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [onCancel]);

  function pointFromEvent(event) {
    const box = imageRef.current.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / box.width, 0, 1),
      y: clamp((event.clientY - box.top) / box.height, 0, 1),
    };
  }

  function startDrag(event, mode) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { mode, start: pointFromEvent(event), rect };
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag) return;

    const point = pointFromEvent(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;

    if (drag.mode === "move") {
      setRect(moveRect(drag.rect, dx, dy));
    } else if (drag.mode === "draw") {
      const w = Math.max(Math.abs(dx), MIN_SIZE);
      const h = Math.max(Math.abs(dy), MIN_SIZE);
      setRect({
        x: clamp(Math.min(drag.start.x, point.x), 0, 1 - w),
        y: clamp(Math.min(drag.start.y, point.y), 0, 1 - h),
        w,
        h,
      });
    } else {
      setRect(resizeRect(drag.rect, drag.mode, dx, dy));
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  // Arrow keys move the box; Shift + arrow keys resize it.
  function handleBoxKey(event) {
    const delta = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    }[event.key];

    if (!delta) return;
    event.preventDefault();

    setRect((current) =>
      event.shiftKey
        ? resizeRect(current, "se", delta[0], delta[1])
        : moveRect(current, delta[0], delta[1])
    );
  }

  async function applyCrop() {
    const image = imageRef.current;
    if (!image?.naturalWidth) return;

    setIsSaving(true);

    const sx = Math.round(rect.x * image.naturalWidth);
    const sy = Math.round(rect.y * image.naturalHeight);
    const sw = Math.max(1, Math.round(rect.w * image.naturalWidth));
    const sh = Math.max(1, Math.round(rect.h * image.naturalHeight));

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d").drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    );

    setIsSaving(false);
    if (!blob) return;

    const baseName = (fileName || "photo").replace(/\.[^.]+$/, "");
    onApply(new File([blob], `${baseName}-cropped.jpg`, { type: "image/jpeg" }));
  }

  const cropSize = natural
    ? `${Math.round(rect.w * natural.width)} × ${Math.round(rect.h * natural.height)} px`
    : "";

  return (
    <div className="modal-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <header className="modal-header">
          <div>
            <h2 id="crop-title">Crop your photo</h2>
            <p>Draw or drag the box around the product you want to find.</p>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="crop-stage">
          <div
            className="crop-canvas"
            onPointerDown={(event) => startDrag(event, "draw")}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <img
              ref={imageRef}
              src={src}
              alt="Photo to crop"
              draggable={false}
              onLoad={(event) =>
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />

            <div
              className="crop-box"
              role="slider"
              tabIndex={0}
              aria-label="Crop area. Use arrow keys to move, Shift and arrow keys to resize."
              aria-valuetext={cropSize}
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
              }}
              onPointerDown={(event) => startDrag(event, "move")}
              onKeyDown={handleBoxKey}
            >
              {HANDLES.map((handle) => (
                <span
                  key={handle}
                  className={`crop-handle crop-handle-${handle}`}
                  onPointerDown={(event) => startDrag(event, handle)}
                />
              ))}
            </div>
          </div>
        </div>

        <footer className="modal-footer">
          <span className="crop-size">{cropSize}</span>
          <div className="modal-actions">
            <button type="button" className="button button-ghost button-sm" onClick={() => setRect(INITIAL_RECT)}>
              <Icon name="refresh" size={15} />
              Reset
            </button>
            <button type="button" className="button button-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button
              ref={applyRef}
              type="button"
              className="button button-primary"
              onClick={applyCrop}
              disabled={isSaving || !natural}
            >
              <Icon name="check" size={16} />
              Apply crop
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
