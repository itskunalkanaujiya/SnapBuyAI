import { formatAmount, getNumericPrice, getProductId } from "./products.js";

// Deal score: how a listing's price compares with the typical (median)
// price of the listings found for the same search.
const MIN_PRICED = 5; // fewer prices than this aren't a fair comparison
const GREAT_DEAL = 0.75; // at most 75% of the typical price
const GOOD_PRICE = 0.9;
const ABOVE_TYPICAL = 1.35;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Map of product id -> { tone, label, detail } for listings that are
 * notably cheaper (or pricier) than typical. Empty when there are too few
 * prices to compare.
 */
export function computeDeals(products) {
  const deals = new Map();
  const priced = products
    .map((product) => ({ product, price: getNumericPrice(product) }))
    .filter((entry) => entry.price !== null && entry.price > 0 && !entry.product.condition);
  if (priced.length < MIN_PRICED) return deals;

  const typical = median(priced.map((entry) => entry.price));
  const typicalText = formatAmount(typical);

  for (const { product, price } of priced) {
    const ratio = price / typical;
    const percent = Math.round(Math.abs(1 - ratio) * 100);
    let deal = null;
    if (ratio <= GREAT_DEAL) {
      deal = { tone: "great", label: "Great deal", detail: `${percent}% below typical` };
    } else if (ratio <= GOOD_PRICE) {
      deal = { tone: "good", label: "Good price", detail: `${percent}% below typical` };
    } else if (ratio >= ABOVE_TYPICAL) {
      deal = { tone: "high", label: "Above typical", detail: `${percent}% above typical` };
    }
    if (deal) {
      deals.set(getProductId(product), {
        ...deal,
        title: `Typical price for these ${priced.length} listings: ${typicalText}`,
      });
    }
  }
  return deals;
}
