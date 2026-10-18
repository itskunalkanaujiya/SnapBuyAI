import { useRef } from "react";
import Icon from "./Icon.jsx";

const EXAMPLES = [
  "HP laptop with 8GB RAM and 512GB SSD under 50k",
  "Samsung 5G phone with 6000mAh battery under 20000",
  "Casio G-Shock green watch",
  "Nike running shoes for men",
  "Cotton kurti for women",
];

/** Photo / Text switch shown at the top of both search panels. */
export function SearchModeTabs({ mode, onChange, disabled }) {
  const tabs = [
    { key: "photo", label: "Photo", icon: "camera" },
    { key: "text", label: "Text", icon: "search" },
  ];

  return (
    <div className="mode-tabs" role="tablist" aria-label="Search by">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={mode === tab.key}
          className={`mode-tab ${mode === tab.key ? "is-active" : ""}`}
          onClick={() => onChange(tab.key)}
          disabled={disabled}
        >
          <Icon name={tab.icon} size={16} />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function TextSearchPanel({
  modeTabs,
  query,
  onQueryChange,
  onSearch,
  isSearching,
  error,
}) {
  const inputRef = useRef(null);
  const trimmed = query.trim();

  return (
    <div className="panel search-panel">
      {modeTabs}

      <div className="panel-header">
        <div>
          <h2>Search by text</h2>
          <p>Describe the product and we'll compare stores for you.</p>
        </div>
      </div>

      <form
        className="text-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed.length >= 2 && !isSearching) onSearch(trimmed);
        }}
      >
        <label className="field text-search-field">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={query}
            maxLength={150}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="e.g. HP laptop with 8GB RAM under 50k"
            aria-label="What are you looking for?"
            disabled={isSearching}
          />
          {query && !isSearching && (
            <button
              type="button"
              className="icon-button text-search-clear"
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <Icon name="x" size={15} />
            </button>
          )}
        </label>

        <div className="text-examples">
          <span>Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="example-chip"
              onClick={() => {
                onQueryChange(example);
                inputRef.current?.focus();
              }}
              disabled={isSearching}
            >
              {example}
            </button>
          ))}
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            <Icon name="alert" size={17} />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          className={`button button-primary button-lg search-button ${isSearching ? "is-loading" : ""}`}
          disabled={trimmed.length < 2 || isSearching}
        >
          {isSearching ? (
            <>
              <span className="spinner spinner-light" />
              Searching stores…
            </>
          ) : (
            <>
              <Icon name="search" size={18} />
              Search products
            </>
          )}
        </button>
      </form>

      <p className="panel-footnote">
        <Icon name="store" size={13} />
        Searches Google Shopping across stores in India.
      </p>
    </div>
  );
}
