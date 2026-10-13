import { useState } from "react";
import Icon from "./Icon.jsx";
import { formatTimeAgo } from "../lib/history.js";
import { formatAmount, getNumericPrice } from "../lib/products.js";

function summarize(results) {
  const products = [...results.bestMatches, ...results.cheapest];
  const prices = products.map(getNumericPrice).filter((price) => price !== null);
  const count = new Set(products.map((product) => product.product_url)).size;

  return prices.length
    ? `${count} listings · from ${formatAmount(Math.min(...prices))}`
    : `${count} listings`;
}

export default function RecentSearches({ entries, onOpen, onRemove, onClear }) {
  // Fixed when the list is shown, so render stays pure.
  const [now] = useState(() => Date.now());

  if (!entries.length) return null;

  return (
    <section className="recent container" aria-labelledby="recent-title">
      <div className="recent-header">
        <h2 id="recent-title">
          <Icon name="refresh" size={16} />
          Recent searches
        </h2>
        <button type="button" className="button button-ghost button-sm" onClick={onClear}>
          Clear
        </button>
      </div>

      <ul className="recent-list">
        {entries.map((entry) => (
          <li key={entry.id} className="recent-item">
            <button type="button" className="recent-open" onClick={() => onOpen(entry)}>
              <img src={entry.image} alt="" />
              <span className="recent-text">
                <strong>{entry.query || "Product search"}</strong>
                <span>{summarize(entry.results)}</span>
                <span className="recent-time">{formatTimeAgo(entry.savedAt, now)}</span>
              </span>
            </button>
            <button
              type="button"
              className="icon-button recent-remove"
              onClick={() => onRemove(entry.id)}
              aria-label={`Remove ${entry.query || "search"} from recent searches`}
            >
              <Icon name="x" size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
