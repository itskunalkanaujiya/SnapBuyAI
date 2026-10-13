import { useMemo } from "react";
import Icon from "./Icon.jsx";
import ProductCard, { ProductCardSkeleton } from "./ProductCard.jsx";
import {
  DEFAULT_FILTERS,
  applyFilters,
  formatAmount,
  getAvailability,
  getNumericPrice,
  getProductId,
  hasActiveFilters,
} from "../lib/products.js";

function Stat({ icon, label, value }) {
  return (
    <div className="stat">
      <span className="stat-icon">
        <Icon name={icon} size={16} />
      </span>
      <div>
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
      </div>
    </div>
  );
}

function Toolbar({ filters, onChange, stores, shownCount, totalCount }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value });
  const active = hasActiveFilters(filters);

  return (
    <div className="toolbar" role="search">
      <label className="field field-search">
        <Icon name="search" size={16} />
        <input
          type="search"
          value={filters.text}
          onChange={set("text")}
          placeholder="Filter by name or store"
          aria-label="Filter by name or store"
        />
      </label>

      <label className="field field-price">
        <span aria-hidden="true">₹</span>
        <input
          type="number"
          min="0"
          inputMode="numeric"
          value={filters.maxPrice}
          onChange={set("maxPrice")}
          placeholder="Max price"
          aria-label="Maximum price in rupees"
        />
      </label>

      <select className="field" value={filters.store} onChange={set("store")} aria-label="Store">
        <option value="all">All stores</option>
        {stores.map((store) => (
          <option key={store} value={store}>
            {store}
          </option>
        ))}
      </select>

      <select className="field" value={filters.minMatch} onChange={set("minMatch")} aria-label="Minimum visual match">
        <option value="0">Any match</option>
        <option value="70">70%+ match</option>
        <option value="80">80%+ match</option>
        <option value="90">90%+ match</option>
      </select>

      <select className="field" value={filters.sort} onChange={set("sort")} aria-label="Sort by">
        <option value="relevance">Sort: Recommended</option>
        <option value="match">Sort: Best match</option>
        <option value="price-low">Sort: Price, low to high</option>
        <option value="price-high">Sort: Price, high to low</option>
      </select>

      <div className="toolbar-end">
        <span className="toolbar-count">
          {active ? `${shownCount} of ${totalCount}` : `${totalCount} listings`}
        </span>
        {active && (
          <button type="button" className="button button-ghost button-sm" onClick={() => onChange(DEFAULT_FILTERS)}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ icon, title, subtitle, products, savedIds, onToggleSave, highlightFirst }) {
  if (!products.length) return null;

  return (
    <section className="result-section">
      <header className="section-header">
        <span className="section-icon">
          <Icon name={icon} size={18} />
        </span>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className="count-pill">{products.length}</span>
      </header>

      <div className="product-grid">
        {products.map((product, index) => (
          <ProductCard
            key={getProductId(product) || index}
            product={product}
            isSaved={savedIds.has(getProductId(product))}
            onToggleSave={onToggleSave}
            highlight={highlightFirst && index === 0 ? highlightFirst : null}
          />
        ))}
      </div>
    </section>
  );
}

export function ResultsLoading() {
  return (
    <section className="results container" aria-busy="true" aria-label="Loading results">
      <div className="results-header">
        <div>
          <span className="eyebrow">Results</span>
          <span className="skeleton-line skeleton-heading shimmer" />
        </div>
      </div>
      <div className="product-grid">
        {Array.from({ length: 8 }, (_, index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}

export default function ResultsView({
  query,
  bestMatches,
  cheapest,
  filters,
  onFiltersChange,
  savedIds,
  onToggleSave,
}) {
  const allProducts = useMemo(() => {
    const unique = new Map();
    [...bestMatches, ...cheapest].forEach((product) =>
      unique.set(getProductId(product), product)
    );
    return [...unique.values()];
  }, [bestMatches, cheapest]);

  const stores = useMemo(
    () =>
      [...new Set(allProducts.map((product) => product.marketplace).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [allProducts]
  );

  const stats = useMemo(() => {
    const priced = allProducts
      .map((product) => ({ product, price: getNumericPrice(product) }))
      .filter((entry) => entry.price !== null);
    const lowest = priced.sort((a, b) => a.price - b.price)[0];

    return {
      lowest: lowest
        ? formatAmount(lowest.price, lowest.product.currency || "INR")
        : "—",
      inStock: allProducts.filter((product) => getAvailability(product) === "in_stock").length,
    };
  }, [allProducts]);

  const filteredBest = useMemo(() => applyFilters(bestMatches, filters), [bestMatches, filters]);
  const filteredCheapest = useMemo(() => applyFilters(cheapest, filters), [cheapest, filters]);
  const shownCount = new Set(
    [...filteredBest, ...filteredCheapest].map(getProductId)
  ).size;

  const cheapestFirst = filteredCheapest[0];
  const showBestPrice =
    filters.sort === "relevance" &&
    cheapestFirst &&
    getAvailability(cheapestFirst) !== "out_of_stock";

  return (
    <section className="results container">
      <div className="results-header">
        <div className="results-title">
          <span className="eyebrow">Results</span>
          <h2>
            {query ? (
              <>
                Matches for <span className="query-chip">{query}</span>
              </>
            ) : (
              "Matching products"
            )}
          </h2>
        </div>

        <div className="stats">
          <Stat icon="layers" label="Listings" value={allProducts.length} />
          <Stat icon="trendDown" label="Lowest price" value={stats.lowest} />
          <Stat icon="box" label="In stock" value={stats.inStock} />
        </div>
      </div>

      <Toolbar
        filters={filters}
        onChange={onFiltersChange}
        stores={stores}
        shownCount={shownCount}
        totalCount={allProducts.length}
      />

      {shownCount === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Icon name="search" size={22} />
          </span>
          <h3>No listings match these filters</h3>
          <p>Try a higher price limit or a different store.</p>
          <button type="button" className="button button-secondary" onClick={() => onFiltersChange(DEFAULT_FILTERS)}>
            Reset filters
          </button>
        </div>
      ) : (
        <>
          <Section
            icon="scan"
            title="Best matches"
            subtitle="Listings that look most like your photo."
            products={filteredBest}
            savedIds={savedIds}
            onToggleSave={onToggleSave}
          />
          <Section
            icon="tag"
            title="Lowest prices"
            subtitle="The cheapest listings we found, in-stock items first."
            products={filteredCheapest}
            savedIds={savedIds}
            onToggleSave={onToggleSave}
            highlightFirst={showBestPrice ? "Best price" : null}
          />
        </>
      )}
    </section>
  );
}
