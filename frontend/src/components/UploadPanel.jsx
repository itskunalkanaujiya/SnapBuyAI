import { useRef, useState } from "react";
import Icon from "./Icon.jsx";

// Each step starts once overall progress reaches this percentage.
const SEARCH_STEPS = [
  { label: "Uploading your photo", startsAt: 0 },
  { label: "Identifying the product", startsAt: 12 },
  { label: "Finding matching listings", startsAt: 40 },
  { label: "Comparing prices and stock", startsAt: 70 },
];

// The server does not report progress, so estimate it from elapsed time.
// The curve eases towards 95% (about 60% at 9s, 85% at 18s) and never
// stalls; the final stretch to 100% happens when the results arrive.
const PROGRESS_TIME_CONSTANT = 9;

function estimateProgress(elapsedSeconds) {
  return 95 * (1 - Math.exp(-elapsedSeconds / PROGRESS_TIME_CONSTANT));
}

function SearchProgress({ elapsed, isComplete }) {
  const progress = isComplete ? 100 : estimateProgress(elapsed);

  let current = 0;
  SEARCH_STEPS.forEach((step, index) => {
    if (progress >= step.startsAt) current = index;
  });

  return (
    <div className="search-progress">
      <div className="progress-head">
        <span>{isComplete ? "Results ready" : SEARCH_STEPS[current].label}</span>
        <span className="progress-percent">{Math.floor(progress)}%</span>
      </div>

      <div
        className="progress-track"
        role="progressbar"
        aria-label="Search progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(progress)}
      >
        <span className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <ol className="progress-steps">
        {SEARCH_STEPS.map((step, index) => {
          const state =
            isComplete || index < current
              ? "done"
              : index === current
                ? "active"
                : "pending";

          return (
            <li key={step.label} className={`progress-step is-${state}`}>
              <span className="progress-dot">
                {state === "done" ? (
                  <Icon name="check" size={12} />
                ) : state === "active" ? (
                  <span className="spinner" />
                ) : null}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function formatFileSize(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function UploadPanel({
  file,
  previewUrl,
  isSearching,
  isComplete,
  elapsed,
  error,
  onSelect,
  onRemove,
  isCropped,
  onCrop,
  onUndoCrop,
  onSearch,
}) {
  const inputRef = useRef(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const openPicker = () => inputRef.current?.click();

  const dragHandlers = {
    onDragEnter: (event) => {
      event.preventDefault();
      dragDepth.current += 1;
      setIsDragging(true);
    },
    onDragOver: (event) => event.preventDefault(),
    onDragLeave: (event) => {
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDragging(false);
    },
    onDrop: (event) => {
      event.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      if (!isSearching) onSelect(event.dataTransfer.files?.[0]);
    },
  };

  return (
    <div className="panel search-panel">
      <div className="panel-header">
        <div>
          <h2>Search by photo</h2>
          <p>We'll identify the product and compare stores for you.</p>
        </div>
        <span className="pill pill-soft">
          <Icon name="sparkles" size={13} />
          AI
        </span>
      </div>

      {previewUrl ? (
        <div className={`preview ${isSearching ? "is-scanning" : ""}`} {...dragHandlers}>
          <div className="preview-frame">
            <img src={previewUrl} alt="Selected product" />
            {isSearching && <span className="scan-line" aria-hidden="true" />}
          </div>

          <div className="preview-side">
            {isSearching ? (
              <SearchProgress elapsed={elapsed} isComplete={isComplete} />
            ) : (
              <>
                <div className="file-chip">
                  <Icon name="image" size={16} />
                  <span className="file-name" title={file?.name}>
                    {file?.name || "Selected image"}
                  </span>
                  {isCropped && <span className="pill pill-soft pill-xs">Cropped</span>}
                  {file && <span className="file-size">{formatFileSize(file.size)}</span>}
                </div>

                <p className="preview-hint">
                  {isCropped
                    ? "Only the cropped area will be searched."
                    : "Photo has other things in it? Crop to just the product for better matches."}
                </p>

                <div className="preview-actions">
                  <button type="button" className="button button-secondary button-sm" onClick={onCrop}>
                    <Icon name="crop" size={15} />
                    {isCropped ? "Adjust crop" : "Crop"}
                  </button>
                  {isCropped && (
                    <button type="button" className="button button-ghost button-sm" onClick={onUndoCrop}>
                      <Icon name="undo" size={15} />
                      Undo crop
                    </button>
                  )}
                  <button type="button" className="button button-secondary button-sm" onClick={openPicker}>
                    <Icon name="refresh" size={15} />
                    Replace
                  </button>
                  <button type="button" className="button button-ghost button-sm" onClick={onRemove}>
                    <Icon name="x" size={15} />
                    Remove
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div
          className={`dropzone ${isDragging ? "is-dragging" : ""}`}
          role="button"
          tabIndex={0}
          onClick={openPicker}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openPicker();
            }
          }}
          {...dragHandlers}
        >
          <span className="dropzone-icon">
            <Icon name="upload" size={22} />
          </span>
          <p className="dropzone-title">
            <strong>Click to upload</strong> or drag and drop
          </p>
          <p className="dropzone-subtitle">JPG, PNG or WebP · up to 8 MB</p>
          <p className="dropzone-paste">
            <Icon name="clipboard" size={13} />
            You can also paste an image with <kbd>Ctrl</kbd> + <kbd>V</kbd>
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          onSelect(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {error && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={17} />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        className={`button button-primary button-lg search-button ${isSearching ? "is-loading" : ""}`}
        onClick={onSearch}
        disabled={!file || isSearching}
      >
        {isSearching ? (
          <>
            {isComplete ? <Icon name="check" size={18} /> : <span className="spinner spinner-light" />}
            {isComplete ? "Done" : `Searching… ${Math.floor(elapsed)}s`}
          </>
        ) : (
          <>
            <Icon name="search" size={18} />
            Find matching products
          </>
        )}
      </button>

      <p className="panel-footnote">
        <Icon name="shield" size={13} />
        Your photo is sent to Google Lens only to run this search.
      </p>
    </div>
  );
}
