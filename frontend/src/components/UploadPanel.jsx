import { useRef, useState } from "react";
import Icon from "./Icon.jsx";

// One step per search stage reported by the backend. Within a stage the
// bar eases from `from` towards `to` (it never stalls, never overshoots);
// `seconds` is the stage's typical length, which sets the easing speed.
const SEARCH_STEPS = [
  { label: "Uploading your photo", from: 0, to: 9, seconds: 1 },
  { label: "Identifying the product", from: 10, to: 44, seconds: 5 },
  { label: "Finding matching listings", from: 45, to: 74, seconds: 2 },
  { label: "Comparing prices and stock", from: 75, to: 97, seconds: 2.5 },
];

function stageProgress(stage, stageElapsed) {
  const step = SEARCH_STEPS[stage];
  return step.from + (step.to - step.from) * (1 - Math.exp(-stageElapsed / step.seconds));
}

function SearchProgress({ stage, stageElapsed, isComplete, identifiedQuery }) {
  const progress = isComplete ? 100 : stageProgress(stage, stageElapsed);
  const current = stage;

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

      {identifiedQuery && (
        <p className="progress-identified">
          <Icon name="scan" size={14} />
          Identified as <strong>{identifiedQuery}</strong>
        </p>
      )}

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
  modeTabs,
  file,
  previewUrl,
  isSearching,
  isComplete,
  elapsed,
  stage,
  stageElapsed,
  identifiedQuery,
  error,
  onSelect,
  onRemove,
  isCropped,
  onCrop,
  onUndoCrop,
  onSearch,
  onFindOutfit,
  onRateOutfit,
  onShopRoom,
  onShopList,
  isFindingOutfit = false,
  busyKind = null,
}) {
  const inputRef = useRef(null);
  const cameraRef = useRef(null);
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
      {modeTabs}

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
              <SearchProgress
                stage={stage}
                stageElapsed={stageElapsed}
                isComplete={isComplete}
                identifiedQuery={identifiedQuery}
              />
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
            <span className="only-pointer">
              <strong>Click to upload</strong> or drag and drop
            </span>
            <span className="only-touch">
              <strong>Tap to choose a photo</strong>
            </span>
          </p>
          <p className="dropzone-subtitle">JPG, PNG or WebP · up to 8 MB</p>
          <p className="dropzone-paste only-pointer">
            <Icon name="clipboard" size={13} />
            You can also paste an image with <kbd>Ctrl</kbd> + <kbd>V</kbd>
          </p>
        </div>
      )}

      {!previewUrl && (
        <button
          type="button"
          className="button button-secondary camera-button only-touch"
          onClick={() => cameraRef.current?.click()}
        >
          <Icon name="camera" size={18} />
          Take a photo
        </button>
      )}

      {/* Opens the rear camera directly on phones and tablets. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          onSelect(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

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

      <div className="outfit-actions">
        <button
          type="button"
          className="button button-secondary search-button outfit-button"
          onClick={onFindOutfit}
          disabled={!file || isSearching || isFindingOutfit}
        >
          {isFindingOutfit && busyKind === "outfit" ? (
            <>
              <span className="spinner" />
              Finding the outfit…
            </>
          ) : (
            <>
              <Icon name="shirt" size={17} />
              Find the outfit
            </>
          )}
        </button>

        <button
          type="button"
          className="button button-secondary search-button rate-button"
          onClick={onRateOutfit}
          disabled={!file || isSearching || isFindingOutfit}
          title="AI stylist: a score for the look, and what to add or swap"
        >
          {isFindingOutfit && busyKind === "rating" ? (
            <>
              <span className="spinner" />
              Rating…
            </>
          ) : (
            <>
              <Icon name="star" size={17} />
              Rate my outfit
            </>
          )}
        </button>

        <button
          type="button"
          className="button button-secondary search-button room-button"
          onClick={onShopRoom}
          disabled={!file || isSearching || isFindingOutfit}
          title="Find the furniture and decor in a room photo"
        >
          {isFindingOutfit && busyKind === "room" ? (
            <>
              <span className="spinner" />
              Shopping the room…
            </>
          ) : (
            <>
              <Icon name="box" size={17} />
              Shop this room
            </>
          )}
        </button>

        <button
          type="button"
          className="button button-secondary search-button list-button"
          onClick={onShopList}
          disabled={!file || isSearching || isFindingOutfit}
          title="Read a handwritten list or a chat screenshot and find every item"
        >
          {isFindingOutfit && busyKind === "list" ? (
            <>
              <span className="spinner" />
              Reading the list…
            </>
          ) : (
            <>
              <Icon name="bag" size={17} />
              Shop my list
              <span className="new-pill">New</span>
            </>
          )}
        </button>
      </div>

      <p className="panel-footnote">
        <Icon name="shield" size={13} />
        Your photo is sent to Google Lens (or, for the outfit features, an AI model) only to run this search, and isn't kept.
      </p>
    </div>
  );
}
