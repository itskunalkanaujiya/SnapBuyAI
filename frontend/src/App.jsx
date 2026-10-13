import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import CropDialog from "./components/CropDialog.jsx";
import Icon, { Logo } from "./components/Icon.jsx";
import Landing from "./components/Landing.jsx";
import ProductCard from "./components/ProductCard.jsx";
import ResultsView, { ResultsLoading } from "./components/ResultsView.jsx";
import UploadPanel from "./components/UploadPanel.jsx";
import {
  ALLOWED_IMAGE_TYPES,
  API_URL,
  DEFAULT_FILTERS,
  MAX_IMAGE_SIZE,
  getProductId,
} from "./lib/products.js";

const SAVED_KEY = "snapbuy-ai-wishlist";
const PROGRESS_FINISH_MS = 650;

function readSaved() {
  try {
    const saved = localStorage.getItem(SAVED_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const FEATURES = [
  { icon: "scan", text: "Identifies products automatically" },
  { icon: "tag", text: "Compares prices across stores" },
  { icon: "box", text: "Shows stock availability" },
];

// Stores that regularly appear in SnapBuy results, shown as plain text.
const STORES = ["Amazon.in", "Flipkart", "Myntra", "AJIO", "Meesho", "Tata CLiQ", "IndiaMART"];

export default function App() {
  const resultsRef = useRef(null);
  const panelRef = useRef(null);
  const [highlightPanel, setHighlightPanel] = useState(false);

  const [view, setView] = useState("discover");
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  // The uploaded photo before any crop, so a crop can be redone or undone.
  const [originalFile, setOriginalFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [isCropping, setIsCropping] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  const [results, setResults] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [saved, setSaved] = useState(readSaved);

  const savedIds = useMemo(() => new Set(saved.map(getProductId)), [saved]);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch {
      // Saved items remain available for this session.
    }
  }, [saved]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

  // Drive the progress steps while a search is running.
  useEffect(() => {
    if (!isSearching) return undefined;

    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250);
    return () => clearInterval(timer);
  }, [isSearching]);

  // Bring new results into view once they arrive.
  useEffect(() => {
    if (results && !isSearching) {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [results, isSearching]);

  function selectImage(nextFile) {
    if (!nextFile) return;

    if (!ALLOWED_IMAGE_TYPES.includes(nextFile.type)) {
      setError("Please choose a JPG, PNG or WebP image.");
      return;
    }

    if (nextFile.size > MAX_IMAGE_SIZE) {
      setError("This image is larger than 8 MB. Please choose a smaller one.");
      return;
    }

    setError("");
    setOriginalFile(nextFile);
    setOriginalUrl(URL.createObjectURL(nextFile));
    showImage(nextFile);
    setView("discover");
  }

  // Use a (possibly cropped) image for the next search.
  function showImage(nextFile) {
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setResults(null);
    setFilters(DEFAULT_FILTERS);
  }

  function applyCrop(croppedFile) {
    setIsCropping(false);
    showImage(croppedFile);
  }

  function undoCrop() {
    if (originalFile) showImage(originalFile);
  }

  const closeCrop = useCallback(() => setIsCropping(false), []);

  function removeImage() {
    setFile(null);
    setPreviewUrl("");
    setOriginalFile(null);
    setOriginalUrl("");
    setResults(null);
    setFilters(DEFAULT_FILTERS);
    setError("");
  }

  // Allow pasting an image from the clipboard.
  useEffect(() => {
    function handlePaste(event) {
      if (isSearching) return;
      const item = [...(event.clipboardData?.items || [])].find((entry) =>
        entry.type.startsWith("image/")
      );
      const pasted = item?.getAsFile();
      if (pasted) {
        event.preventDefault();
        selectImage(pasted);
      }
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  });

  function toggleSaved(product) {
    const id = getProductId(product);
    setSaved((current) =>
      current.some((item) => getProductId(item) === id)
        ? current.filter((item) => getProductId(item) !== id)
        : [...current, product]
    );
  }

  // Bring the search panel into view from the call-to-action at the bottom.
  function goToSearch() {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    panelRef.current
      ?.querySelector(".dropzone, .search-button")
      ?.focus({ preventScroll: true });
    setHighlightPanel(true);
    setTimeout(() => setHighlightPanel(false), 1600);
  }

  async function search() {
    if (!file) {
      setError("Please upload a product photo first.");
      return;
    }

    setError("");
    setResults(null);
    setFilters(DEFAULT_FILTERS);
    setElapsed(0);
    setIsSearching(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_URL}/api/v1/products/search-by-image`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let detail = "Something went wrong while searching. Please try again.";
        try {
          const body = await response.json();
          detail = body.detail || body.message || detail;
        } catch {
          // Keep the default message for non-JSON responses.
        }
        throw new Error(detail);
      }

      const data = await response.json();
      const bestMatches = Array.isArray(data.best_matches) ? data.best_matches : [];
      const cheapest = Array.isArray(data.cheapest_alternatives)
        ? data.cheapest_alternatives
        : [];

      if (bestMatches.length + cheapest.length === 0) {
        setError(
          "We couldn't find this product online. Try a clearer photo where the product fills most of the frame."
        );
        return;
      }

      // Let the progress bar finish before the results replace it.
      setIsComplete(true);
      await new Promise((resolve) => setTimeout(resolve, PROGRESS_FINISH_MS));

      setResults({
        query: data.online_search_query || "",
        bestMatches,
        cheapest,
      });
    } catch (searchError) {
      setError(
        searchError instanceof TypeError
          ? "Can't reach the SnapBuy server. Check that the backend is running."
          : searchError.message
      );
    } finally {
      setIsSearching(false);
      setIsComplete(false);
    }
  }

  return (
    <div className="app">
      <header className="site-header">
        <div className="container header-inner">
          <button type="button" className="brand" onClick={() => setView("discover")} aria-label="SnapBuy AI home">
            <Logo />
          </button>

          <nav className="nav" aria-label="Main">
            <button
              type="button"
              className={`nav-item ${view === "discover" ? "is-active" : ""}`}
              aria-current={view === "discover" ? "page" : undefined}
              onClick={() => setView("discover")}
            >
              <Icon name="search" size={16} />
              Discover
            </button>
            <button
              type="button"
              className={`nav-item ${view === "saved" ? "is-active" : ""}`}
              aria-current={view === "saved" ? "page" : undefined}
              onClick={() => setView("saved")}
            >
              <Icon name="heart" size={16} />
              Saved
              {saved.length > 0 && <span className="nav-count">{saved.length}</span>}
            </button>
          </nav>
        </div>
      </header>

      <main>
        {view === "discover" ? (
          <>
            <section className="hero">
              <div className="container hero-inner">
                <div className="hero-copy">
                  <span className="pill pill-outline">
                    <span className="pill-dot" />
                    Visual product search for India
                  </span>

                  <h1>
                    Find any product
                    <br />
                    <span className="accent">from a single photo.</span>
                  </h1>

                  <p className="hero-lead">
                    Upload a picture and SnapBuy identifies the product, finds
                    matching listings across online stores and shows you where
                    it's cheapest.
                  </p>

                  <ul className="feature-list">
                    {FEATURES.map((feature) => (
                      <li key={feature.text}>
                        <span className="feature-icon">
                          <Icon name={feature.icon} size={15} />
                        </span>
                        {feature.text}
                      </li>
                    ))}
                  </ul>
                </div>

                <div
                  ref={panelRef}
                  className={`hero-visual ${highlightPanel ? "is-highlighted" : ""}`}
                >
                <UploadPanel
                  file={file}
                  previewUrl={previewUrl}
                  isSearching={isSearching}
                  isComplete={isComplete}
                  elapsed={elapsed}
                  error={error}
                  onSelect={selectImage}
                  onRemove={removeImage}
                  isCropped={Boolean(file && originalFile && file !== originalFile)}
                  onCrop={() => setIsCropping(true)}
                  onUndoCrop={undoCrop}
                  onSearch={search}
                />
                </div>
              </div>

              <div className="container store-strip">
                <span>Finds listings from stores like</span>
                <ul>
                  {STORES.map((store) => (
                    <li key={store}>{store}</li>
                  ))}
                </ul>
              </div>
            </section>

            <div ref={resultsRef} className="results-anchor" />

            {isSearching && <ResultsLoading />}

            {results && !isSearching && (
              <ResultsView
                query={results.query}
                bestMatches={results.bestMatches}
                cheapest={results.cheapest}
                filters={filters}
                onFiltersChange={setFilters}
                savedIds={savedIds}
                onToggleSave={toggleSaved}
              />
            )}

            {!results && !isSearching && <Landing onStart={goToSearch} />}
          </>
        ) : (
          <section className="saved container">
            <div className="saved-header">
              <div>
                <span className="eyebrow">Your collection</span>
                <h2>Saved items</h2>
                <p>Saved in this browser so you can compare them later.</p>
              </div>

              {saved.length > 0 && (
                <button type="button" className="button button-ghost button-sm" onClick={() => setSaved([])}>
                  <Icon name="trash" size={15} />
                  Clear all
                </button>
              )}
            </div>

            {saved.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <Icon name="heart" size={22} />
                </span>
                <h3>Nothing saved yet</h3>
                <p>Tap the heart on any product to keep it here.</p>
                <button type="button" className="button button-primary" onClick={() => setView("discover")}>
                  Start a search
                  <Icon name="arrowRight" size={16} />
                </button>
              </div>
            ) : (
              <div className="product-grid">
                {saved.map((product, index) => (
                  <ProductCard
                    key={getProductId(product) || index}
                    product={product}
                    isSaved
                    onToggleSave={toggleSaved}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {isCropping && originalUrl && (
        <CropDialog
          src={originalUrl}
          fileName={originalFile?.name}
          onApply={applyCrop}
          onCancel={closeCrop}
        />
      )}

      <footer className="site-footer">
        <div className="container footer-inner">
          <Logo />
          <p>
            Prices and availability come from third-party stores and may
            change. Always confirm on the seller's site before buying.
          </p>
          <span>© {new Date().getFullYear()} SnapBuy AI</span>
        </div>
      </footer>
    </div>
  );
}
