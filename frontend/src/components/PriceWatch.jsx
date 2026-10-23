import Icon from "./Icon.jsx";
import { formatAmount } from "../lib/products.js";

function timeAgo(at) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** A tiny line of the prices seen so far (two or more checks). */
function Sparkline({ history }) {
  if (!history || history.length < 2) return null;
  const prices = history.map((point) => point.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const span = high - low || 1;
  const points = prices
    .map((price, index) => `${(index / (prices.length - 1)) * 70 + 1},${21 - ((price - low) / span) * 20}`)
    .join(" ");
  const falling = prices.at(-1) < prices[0];
  return (
    <svg className="watch-spark" viewBox="0 0 72 22" role="img" aria-label={`Price history: ${prices.map((p) => formatAmount(p)).join(", ")}`}>
      <polyline
        points={points}
        fill="none"
        stroke={falling ? "var(--success)" : "var(--text-3)"}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Change({ watch }) {
  if (watch.status === "unknown") {
    return <span className="watch-change is-same">Couldn't check last time</span>;
  }
  const start = watch.startPrice;
  const now = watch.lastPrice;
  if (!start || !now || start === now) return <span className="watch-change is-same">No change yet</span>;
  const difference = now - start;
  const percent = Math.round((Math.abs(difference) / start) * 100);
  return (
    <span className={`watch-change ${difference < 0 ? "is-down" : "is-up"}`}>
      {difference < 0 ? "↓" : "↑"} {formatAmount(Math.abs(difference))} ({percent}%) since you started
    </span>
  );
}

/**
 * Price watch on the Saved page: every watched product with the price when
 * watching started, the latest price, its history and a manual re-check.
 */
export default function PriceWatch({ watches, onCheck, isChecking, onRemove, error }) {
  if (!watches.length) {
    return (
      <section className="watch-section">
        <div className="watch-section-header">
          <div>
            <h3>
              <Icon name="bell" size={16} /> Price watch
            </h3>
            <p>Tap the bell on any product to watch its price. Drops show up here and as an alert.</p>
          </div>
        </div>
      </section>
    );
  }

  const lastChecked = Math.max(...watches.map((watch) => watch.lastChecked || 0));

  return (
    <section className="watch-section">
      <div className="watch-section-header">
        <div>
          <h3>
            <Icon name="bell" size={16} /> Price watch
          </h3>
          <p>
            {watches.length} product{watches.length === 1 ? "" : "s"} watched · checked {timeAgo(lastChecked)} ·
            re-checked automatically every 12 hours when you open Vistora
          </p>
        </div>
        <button type="button" className="button button-secondary button-sm" onClick={onCheck} disabled={isChecking}>
          {isChecking ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
          {isChecking ? "Checking prices…" : "Check now"}
        </button>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={17} />
          <span>{error}</span>
        </div>
      )}

      <ul className="watch-list">
        {watches.map((watch) => {
          const product = watch.product;
          const down = watch.lastPrice && watch.startPrice && watch.lastPrice < watch.startPrice;
          return (
            <li key={watch.id} className={`watch-row ${down ? "is-down" : ""}`}>
              {product.image_url ? (
                <img src={product.image_url} alt="" loading="lazy" />
              ) : (
                <span className="watch-noimage" aria-hidden="true">
                  <Icon name="image" size={18} />
                </span>
              )}
              <span className="watch-name">
                {product.product_url ? (
                  <a href={product.product_url} target="_blank" rel="noopener noreferrer" title={product.name}>
                    {product.name}
                  </a>
                ) : (
                  <strong title={product.name}>{product.name}</strong>
                )}
                <small>
                  {product.marketplace} · watching since {formatAmount(watch.startPrice)}
                  {watch.lowestPrice && watch.lowestPrice < watch.startPrice
                    ? ` · lowest ${formatAmount(watch.lowestPrice)}`
                    : ""}
                </small>
                <Change watch={watch} />
              </span>
              <span className="watch-price">
                <strong>{watch.lastPrice ? formatAmount(watch.lastPrice) : "—"}</strong>
                <Sparkline history={watch.history} />
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => onRemove(watch.id)}
                aria-label={`Stop watching ${product.name}`}
                title="Stop watching"
              >
                <Icon name="x" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
