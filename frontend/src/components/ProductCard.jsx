import { useState } from "react";
import Icon from "./Icon.jsx";
import {
  AVAILABILITY_LABELS,
  formatPrice,
  getAvailability,
  getMatchLevel,
} from "../lib/products.js";

function StoreIcon({ product }) {
  const [failed, setFailed] = useState(!product.source_icon);
  const store = product.marketplace || "Store";

  if (failed) {
    return (
      <span className="store-icon store-icon-fallback" aria-hidden="true">
        {store.trim().charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className="store-icon"
      src={product.source_icon}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function ProductCard({ product, isSaved, onToggleSave, highlight }) {
  const [imageFailed, setImageFailed] = useState(!product.image_url);

  const match = getMatchLevel(product);
  const availability = getAvailability(product);
  const price = formatPrice(product);
  const store = product.marketplace || "Online store";
  const name = product.name || "Unnamed product";
  // Google Shopping results link to Google's page listing the stores.
  const isShopping = product.result_type === "shopping";

  return (
    <article className="card">
      <div className="card-media">
        {imageFailed ? (
          <div className="card-media-fallback" role="img" aria-label="Image unavailable">
            <Icon name="image" size={28} />
          </div>
        ) : (
          <img
            src={product.image_url}
            alt={name}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        )}

        <div className="card-badges">
          {product.condition && (
            <span className="badge badge-condition">
              {product.condition === "used" ? "Used" : "Refurbished"}
            </span>
          )}
          {highlight && (
            <span className="badge badge-accent">
              <Icon name="tag" size={12} />
              {highlight}
            </span>
          )}
          {match && (
            <span
              className={`badge badge-glass match-${match.key}`}
              title="How closely this listing's photo resembles yours"
            >
              <span className="match-dot" />
              {match.label}
            </span>
          )}
        </div>

        <button
          type="button"
          className={`save-button ${isSaved ? "is-saved" : ""}`}
          onClick={() => onToggleSave(product)}
          aria-pressed={isSaved}
          aria-label={isSaved ? "Remove from saved" : "Save item"}
          title={isSaved ? "Remove from saved" : "Save item"}
        >
          <Icon name="heart" size={17} />
        </button>
      </div>

      <div className="card-body">
        <div className="card-store">
          <StoreIcon product={product} />
          <span>{store}</span>
          {product.multiple_sources && <span className="more-stores">+ more stores</span>}
        </div>

        <h3 className="card-title" title={name}>
          {name}
        </h3>

        {product.rating ? (
          <div className="card-rating" aria-label={`Rated ${product.rating} out of 5`}>
            <span className="star" aria-hidden="true">★</span>
            {Number(product.rating).toFixed(1)}
            {product.reviews ? (
              <span className="reviews">({Number(product.reviews).toLocaleString("en-IN")})</span>
            ) : null}
          </div>
        ) : null}

        <div className="card-meta">
          {price ? (
            <span className="card-price">
              {price}
              {product.original_price_text && (
                <s className="card-original-price" aria-label={`was ${product.original_price_text}`}>
                  {product.original_price_text}
                </s>
              )}
            </span>
          ) : product.pending ? (
            <span className="card-price is-missing is-pending">Checking price…</span>
          ) : (
            <span className="card-price is-missing">Price on store</span>
          )}

          {isShopping && availability === "unknown" ? null : product.pending &&
            availability === "unknown" ? (
            <span className="stock stock-pending">Checking stock</span>
          ) : (
            <span className={`stock stock-${availability}`}>
              {AVAILABILITY_LABELS[availability]}
            </span>
          )}
        </div>

        {product.product_url ? (
          <a
            className="button button-secondary card-cta"
            href={product.product_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {isShopping ? "Compare offers" : "View on store"}
            <Icon name="external" size={15} />
          </a>
        ) : (
          <span className="button button-secondary card-cta is-disabled" aria-disabled="true">
            Link unavailable
          </span>
        )}
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="card card-skeleton" aria-hidden="true">
      <div className="card-media shimmer" />
      <div className="card-body">
        <span className="skeleton-line shimmer" style={{ width: "40%" }} />
        <span className="skeleton-line shimmer" style={{ width: "92%" }} />
        <span className="skeleton-line shimmer" style={{ width: "70%" }} />
        <span className="skeleton-line skeleton-price shimmer" style={{ width: "35%" }} />
        <span className="skeleton-button shimmer" />
      </div>
    </div>
  );
}
