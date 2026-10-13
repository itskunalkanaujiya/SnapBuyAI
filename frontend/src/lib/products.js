export const API_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const AVAILABILITY_LABELS = {
  in_stock: "In stock",
  out_of_stock: "Out of stock",
  unknown: "Stock unknown",
};

export const DEFAULT_FILTERS = {
  text: "",
  maxPrice: "",
  minMatch: "0",
  store: "all",
  sort: "relevance",
};

export function getProductId(product) {
  return (
    product.id ||
    product.product_id ||
    product.product_url ||
    `${product.name}-${product.marketplace}`
  );
}

export function getNumericPrice(product) {
  if (typeof product.price === "number") return product.price;

  if (typeof product.price === "string") {
    const parsed = Number(product.price.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function formatAmount(amount, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString("en-IN")}`;
  }
}

/** Display price, or null when the store did not expose one. */
export function formatPrice(product) {
  if (product.price_text) {
    // Google marks some prices with a trailing "*"; drop it for display.
    return String(product.price_text).replace(/\*+$/, "").trim();
  }

  const price = getNumericPrice(product);
  return price === null ? null : formatAmount(price, product.currency || "INR");
}

/** Visual match percentage from CLIP, or null when it was not scored. */
export function getMatchPercent(product) {
  const score = Number(product.visual_similarity_score);
  if (product.visual_similarity_score == null || !Number.isFinite(score)) {
    return null;
  }

  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

export function getAvailability(product) {
  return AVAILABILITY_LABELS[product.availability]
    ? product.availability
    : "unknown";
}

export function hasActiveFilters(filters) {
  return Object.keys(DEFAULT_FILTERS).some(
    (key) => filters[key] !== DEFAULT_FILTERS[key]
  );
}

export function applyFilters(products, filters) {
  const query = filters.text.trim().toLowerCase();
  const budget = filters.maxPrice === "" ? null : Number(filters.maxPrice);
  const minimum = Number(filters.minMatch) || 0;

  const filtered = products.filter((product) => {
    if (
      query &&
      ![product.name, product.marketplace]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    ) {
      return false;
    }

    if (budget !== null && Number.isFinite(budget)) {
      const price = getNumericPrice(product);
      if (price === null || price > budget) return false;
    }

    if (minimum > 0) {
      const match = getMatchPercent(product);
      if (match === null || match < minimum) return false;
    }

    if (filters.store !== "all" && product.marketplace !== filters.store) {
      return false;
    }

    return true;
  });

  const byPrice = (a, b, direction) => {
    const priceA = getNumericPrice(a);
    const priceB = getNumericPrice(b);
    if (priceA === null && priceB === null) return 0;
    if (priceA === null) return 1;
    if (priceB === null) return -1;
    return direction * (priceA - priceB);
  };

  switch (filters.sort) {
    case "price-low":
      return filtered.sort((a, b) => byPrice(a, b, 1));
    case "price-high":
      return filtered.sort((a, b) => byPrice(a, b, -1));
    case "match":
      return filtered.sort(
        (a, b) => (getMatchPercent(b) ?? -1) - (getMatchPercent(a) ?? -1)
      );
    default:
      return filtered;
  }
}
