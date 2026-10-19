import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import ProductCard, { ProductCardSkeleton } from "./ProductCard.jsx";
import { formatAmount, getNumericPrice, getProductId } from "../lib/products.js";
import { computeDeals } from "../lib/deals.js";

const THUMBNAIL_SIZE = 160;
const BOX_PADDING = 0.15; // share of the box added on each side

/** Crop each item's box from the photo into a small square thumbnail. */
function useItemThumbnails(photoUrl, items) {
  const [thumbnails, setThumbnails] = useState({});
  const boxes = items.map((item) => `${item.id}:${item.box || ""}`).join("|");

  useEffect(() => {
    if (!photoUrl || !boxes) return undefined;
    let active = true;
    const image = new Image();
    image.onload = () => {
      const crops = {};
      for (const item of items) {
        if (!item.box) continue;
        const [x1, y1, x2, y2] = item.box;
        const padX = (x2 - x1) * BOX_PADDING;
        const padY = (y2 - y1) * BOX_PADDING;
        const left = Math.max(0, x1 - padX) * image.naturalWidth;
        const top = Math.max(0, y1 - padY) * image.naturalHeight;
        const width = Math.min(1, x2 + padX) * image.naturalWidth - left;
        const height = Math.min(1, y2 + padY) * image.naturalHeight - top;
        // Square crop around the box centre, so thumbnails line up.
        const side = Math.max(width, height);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = THUMBNAIL_SIZE;
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
        context.drawImage(
          image,
          left + width / 2 - side / 2,
          top + height / 2 - side / 2,
          side,
          side,
          0,
          0,
          THUMBNAIL_SIZE,
          THUMBNAIL_SIZE
        );
        crops[item.id] = canvas.toDataURL("image/jpeg", 0.85);
      }
      if (active) setThumbnails(crops);
    };
    image.src = photoUrl;
    return () => {
      active = false;
    };
    // `boxes` captures the items' identities and boxes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoUrl, boxes]);

  return thumbnails;
}

function capitalise(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

/** Every option for an item, without repeats. */
function itemProducts(item) {
  const unique = new Map();
  [...(item.best_matches || []), ...(item.cheapest_alternatives || [])].forEach((product) =>
    unique.set(getProductId(product), product)
  );
  return [...unique.values()];
}

/** Lowest known price among an item's options, or null. */
function lowestPrice(item) {
  const prices = itemProducts(item)
    .map(getNumericPrice)
    .filter((price) => price !== null);
  return prices.length ? Math.min(...prices) : null;
}

function scrollToItem(id) {
  document.getElementById(`outfit-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function ItemThumb({ src, className = "" }) {
  return src ? (
    <img className={`outfit-thumb ${className}`} src={src} alt="" />
  ) : (
    <span className={`outfit-thumb outfit-thumb-empty ${className}`} aria-hidden="true">
      <Icon name="shirt" size={18} />
    </span>
  );
}

/** The photo with a numbered marker on each item and the active item outlined. */
function OutfitPhoto({ photoUrl, alt, items, activeId, onActivate, scanning }) {
  const active = items.find((item) => item.id === activeId && item.box);

  return (
    <div className={`outfit-photo-frame ${scanning ? "is-scanning" : ""}`}>
      <img src={photoUrl} alt={alt} />
      {scanning && <span className="scan-line" aria-hidden="true" />}
      {active && (
        <span
          className="outfit-box"
          aria-hidden="true"
          style={{
            left: `${active.box[0] * 100}%`,
            top: `${active.box[1] * 100}%`,
            width: `${(active.box[2] - active.box[0]) * 100}%`,
            height: `${(active.box[3] - active.box[1]) * 100}%`,
          }}
        />
      )}
      {items.map((item, index) =>
        item.box ? (
          <button
            key={item.id}
            type="button"
            className={`outfit-marker ${item.id === activeId ? "is-active" : ""}`}
            style={{
              left: `${((item.box[0] + item.box[2]) / 2) * 100}%`,
              top: `${((item.box[1] + item.box[3]) / 2) * 100}%`,
            }}
            onMouseEnter={() => onActivate(item.id)}
            onFocus={() => onActivate(item.id)}
            onClick={() => scrollToItem(item.id)}
            aria-label={`${capitalise(item.type)}: see options`}
          >
            {index + 1}
          </button>
        ) : null
      )}
    </div>
  );
}

function ItemSection({ item, index, thumbnail, savedIds, onToggleSave, onTryOn, onMore, onExactMatch }) {
  const products = itemProducts(item);
  const lowest = lowestPrice(item);
  const deals = computeDeals(products);

  return (
    <section className="outfit-section" id={`outfit-${item.id}`}>
      <header className="outfit-section-header">
        <span className="outfit-number" aria-hidden="true">
          {index + 1}
        </span>
        <ItemThumb src={thumbnail} />
        <div className="outfit-section-title">
          <h3>{capitalise(item.type)}</h3>
          <p>{capitalise(item.description)}</p>
          {item.reason && <p className="outfit-reason">{capitalise(item.reason)}</p>}
        </div>
        {!item.pending && lowest !== null && (
          <span className="outfit-from">
            <small>from</small>
            {formatAmount(lowest)}
          </span>
        )}
        {!item.pending && onExactMatch && item.box && (
          <button
            type="button"
            className="button button-ghost button-sm outfit-exact"
            onClick={() => onExactMatch(item)}
            title="Search this item's part of your photo with Google Lens (uses one photo search)"
          >
            <Icon name="scan" size={14} />
            Exact match
          </button>
        )}
        {!item.pending && products.length > 0 && (
          <button type="button" className="button button-ghost button-sm outfit-more" onClick={() => onMore(item.query)}>
            More like this
            <Icon name="arrowRight" size={14} />
          </button>
        )}
      </header>

      {item.pending ? (
        <div className="outfit-scroller" aria-busy="true" aria-label="Finding options">
          {Array.from({ length: 4 }, (_, skeleton) => (
            <ProductCardSkeleton key={skeleton} />
          ))}
        </div>
      ) : products.length ? (
        <div className="outfit-scroller">
          {products.map((product, position) => (
            <ProductCard
              key={getProductId(product) || position}
              product={product}
              isSaved={savedIds.has(getProductId(product))}
              onToggleSave={onToggleSave}
              onTryOn={onTryOn}
              highlight={getNumericPrice(product) === lowest && lowest !== null ? "Lowest" : null}
              deal={deals.get(getProductId(product))}
            />
          ))}
        </div>
      ) : (
        <p className="outfit-empty">
          <Icon name="alert" size={15} />
          {item.failed
            ? "Couldn't search for this item right now. Try again in a moment."
            : "No matching listings found for this item."}
          <button type="button" className="button button-ghost button-sm" onClick={() => onMore(item.query)}>
            Search “{item.query}”
          </button>
        </p>
      )}
    </section>
  );
}

/**
 * Results of "Find the outfit": the photo with a marker on every item, a
 * summary with the price of the whole look, then a swipeable row of
 * shopping options per item.
 *
 * Also shows "Complete the look" (outfit.kind "look"): the product being
 * styled in place of the photo, and the items suggested to go with it.
 */
export default function OutfitView({ outfit, photoUrl, savedIds, onToggleSave, onTryOn, onMore, onBack, onExactMatch }) {
  const items = useMemo(() => outfit.items || [], [outfit.items]);
  const isLook = outfit.kind === "look";
  const baseProduct = isLook ? outfit.product : null;
  const cropped = useItemThumbnails(isLook ? "" : photoUrl, items);
  // A look has no photo to crop from; use each item's first listing.
  const thumbnails = isLook
    ? Object.fromEntries(items.map((item) => [item.id, itemProducts(item)[0]?.image_url]))
    : cropped;
  const [activeId, setActiveId] = useState(null);
  const basePrice = baseProduct ? getNumericPrice(baseProduct) : null;

  const scanning = items.length === 0;
  const remaining = items.filter((item) => item.pending).length;
  const lookPrices = items.map(lowestPrice).filter((price) => price !== null);
  const lookTotal = lookPrices.reduce((sum, price) => sum + price, basePrice ?? 0);
  const pricedCount = lookPrices.length + (basePrice !== null ? 1 : 0);
  const audience = outfit.gender && outfit.gender !== "unisex" ? outfit.gender : "";

  return (
    <section className="results container outfit" onMouseLeave={() => setActiveId(null)}>
      {onBack && (
        <button type="button" className="button button-ghost button-sm outfit-back" onClick={onBack}>
          <Icon name="undo" size={15} />
          Back to results
        </button>
      )}
      <div className="outfit-summary">
        {photoUrl && (
          <OutfitPhoto
            photoUrl={photoUrl}
            alt={isLook ? baseProduct?.name || "The product" : "Your outfit photo"}
            items={items}
            activeId={activeId}
            onActivate={setActiveId}
            scanning={scanning}
          />
        )}

        <div className="outfit-overview">
          <span className="eyebrow">{isLook ? "Complete the look" : "Find the outfit"}</span>
          {baseProduct && (
            <p className="look-base">
              Styling <strong>{baseProduct.name}</strong>
              {basePrice !== null && ` · ${formatAmount(basePrice)}`}
            </p>
          )}
          {scanning ? (
            <>
              <h2>{isLook ? "Styling the look…" : "Looking at the outfit…"}</h2>
              <p className="outfit-lead">
                {isLook
                  ? "AI is picking what goes with it. This usually takes a few seconds."
                  : "AI is spotting each item they're wearing. This usually takes a couple of seconds."}
              </p>
              <div className="outfit-list" aria-hidden="true">
                {Array.from({ length: 3 }, (_, index) => (
                  <span key={index} className="outfit-row outfit-row-skeleton">
                    <span className="outfit-thumb shimmer" />
                    <span className="skeleton-line shimmer" style={{ width: `${60 - index * 10}%` }} />
                  </span>
                ))}
              </div>
            </>
          ) : (
            <>
              <h2>
                {items.length} item{items.length === 1 ? "" : "s"} {isLook ? "that go with it" : "spotted"}
              </h2>
              <p className="outfit-lead">
                {remaining > 0
                  ? `Finding shopping options for ${remaining} item${remaining === 1 ? "" : "s"}…`
                  : `Tap an item to see its options${audience ? ` for ${audience}` : ""}.`}
              </p>

              {remaining === 0 && pricedCount > 1 && (
                <div className="outfit-total">
                  <Icon name="tag" size={18} />
                  <span>
                    Get the whole look from <strong>{formatAmount(lookTotal)}</strong>
                    <small>
                      {basePrice !== null ? "This item plus the cheapest option for " : "Cheapest option for "}
                      {lookPrices.length === items.length ? "every" : `${lookPrices.length} of ${items.length}`} item
                      {lookPrices.length === items.length ? "" : "s"}
                    </small>
                  </span>
                </div>
              )}

              <ol className="outfit-list">
                {items.map((item, index) => {
                  const lowest = lowestPrice(item);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`outfit-row ${item.id === activeId ? "is-active" : ""}`}
                        onMouseEnter={() => setActiveId(item.id)}
                        onFocus={() => setActiveId(item.id)}
                        onClick={() => scrollToItem(item.id)}
                      >
                        <span className="outfit-number">{index + 1}</span>
                        <ItemThumb src={thumbnails[item.id]} />
                        <span className="outfit-row-text">
                          <strong>{capitalise(item.type)}</strong>
                          <small>{capitalise(item.description)}</small>
                        </span>
                        <span className="outfit-row-price">
                          {item.pending ? (
                            <span className="spinner" aria-label="Searching" />
                          ) : lowest !== null ? (
                            <>
                              <small>from</small>
                              {formatAmount(lowest)}
                            </>
                          ) : (
                            <small>No results</small>
                          )}
                        </span>
                        <Icon name="arrowRight" size={15} className="outfit-row-arrow" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      </div>

      {items.map((item, index) => (
        <ItemSection
          key={item.id}
          item={item}
          index={index}
          thumbnail={thumbnails[item.id]}
          savedIds={savedIds}
          onToggleSave={onToggleSave}
          onTryOn={onTryOn}
          onMore={onMore}
          onExactMatch={onExactMatch}
        />
      ))}
    </section>
  );
}
