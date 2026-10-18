import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import ProductCard, { ProductCardSkeleton } from "./ProductCard.jsx";
import { getProductId } from "../lib/products.js";

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
        const width = (Math.min(1, x2 + padX) * image.naturalWidth) - left;
        const height = (Math.min(1, y2 + padY) * image.naturalHeight) - top;
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

function ItemThumb({ src }) {
  return src ? (
    <img className="outfit-thumb" src={src} alt="" />
  ) : (
    <span className="outfit-thumb outfit-thumb-empty" aria-hidden="true">
      <Icon name="shirt" size={18} />
    </span>
  );
}

function ItemSection({ item, thumbnail, savedIds, onToggleSave, onTryOn, onMore }) {
  const products = item.best_matches || [];

  return (
    <section className="result-section outfit-section" id={`outfit-${item.id}`}>
      <header className="section-header outfit-section-header">
        <ItemThumb src={thumbnail} />
        <div>
          <h3>{capitalise(item.type)}</h3>
          <p>{capitalise(item.description)}</p>
        </div>
        {!item.pending && products.length > 0 && (
          <button type="button" className="button button-ghost button-sm" onClick={() => onMore(item.query)}>
            More like this
            <Icon name="arrowRight" size={14} />
          </button>
        )}
      </header>

      {item.pending ? (
        <div className="product-grid" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <ProductCardSkeleton key={index} />
          ))}
        </div>
      ) : products.length ? (
        <div className="product-grid">
          {products.map((product, index) => (
            <ProductCard
              key={getProductId(product) || index}
              product={product}
              isSaved={savedIds.has(getProductId(product))}
              onToggleSave={onToggleSave}
              onTryOn={onTryOn}
            />
          ))}
        </div>
      ) : (
        <p className="outfit-empty">
          <Icon name="alert" size={15} />
          {item.failed ? "Couldn't search for this item right now." : "No matching listings found for this item."}
        </p>
      )}
    </section>
  );
}

/**
 * Results of "Find the outfit": the identified items as chips, then one
 * section of shopping options per item.
 */
export default function OutfitView({ outfit, photoUrl, savedIds, onToggleSave, onTryOn, onMore }) {
  const items = outfit.items || [];
  const thumbnails = useItemThumbnails(photoUrl, items);
  const remaining = items.filter((item) => item.pending).length;

  return (
    <section className="results container outfit">
      <div className="results-header">
        <div className="results-title">
          <span className="eyebrow">Find the outfit</span>
          <h2>
            {items.length ? `${items.length} item${items.length === 1 ? "" : "s"} in this outfit` : "Identifying the outfit…"}
          </h2>
          {outfit.gender && outfit.gender !== "unisex" && (
            <p className="outfit-subtitle">Shopping options for {outfit.gender}, item by item.</p>
          )}
        </div>
        {photoUrl && <img className="outfit-photo" src={photoUrl} alt="Your outfit photo" />}
      </div>

      {items.length > 0 && (
        <nav className="outfit-chips" aria-label="Items in this outfit">
          {items.map((item) => (
            <a key={item.id} className="outfit-chip" href={`#outfit-${item.id}`}>
              <ItemThumb src={thumbnails[item.id]} />
              <span>
                <strong>{capitalise(item.type)}</strong>
                <small>{item.pending ? "Searching…" : `${(item.best_matches || []).length} options`}</small>
              </span>
            </a>
          ))}
        </nav>
      )}

      {remaining > 0 && (
        <div className="updating-banner" role="status">
          <span className="spinner" />
          Finding shopping options for {remaining} item{remaining === 1 ? "" : "s"}…
        </div>
      )}

      {items.length === 0 && (
        <div className="product-grid" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <ProductCardSkeleton key={index} />
          ))}
        </div>
      )}

      {items.map((item) => (
        <ItemSection
          key={item.id}
          item={item}
          thumbnail={thumbnails[item.id]}
          savedIds={savedIds}
          onToggleSave={onToggleSave}
          onTryOn={onTryOn}
          onMore={onMore}
        />
      ))}
    </section>
  );
}
