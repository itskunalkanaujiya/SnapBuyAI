import { createContext, useContext } from "react";
import { API_URL, getNumericPrice, getProductId } from "./products.js";

// Price watch: products the user is watching, kept in this browser. Prices
// are re-checked when the app opens (at most every CHECK_EVERY_MS), and a
// drop shows a banner and, with permission, a browser notification.
const STORAGE_KEY = "snapbuy-ai-price-watch";
export const MAX_WATCHES = 20;
export const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const MAX_HISTORY = 30;

export const PriceWatchContext = createContext(null);

/** { isWatching(product), toggle(product), isFull } or null outside the app. */
export function usePriceWatch() {
  return useContext(PriceWatchContext);
}

export function readWatches() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function writeWatches(watches) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watches));
  } catch {
    // The watch list still works for this visit.
  }
}

/** A new watch for a product, starting from the price shown now. */
export function newWatch(product) {
  const price = getNumericPrice(product);
  return {
    id: getProductId(product),
    product: { ...product, pending: false },
    startPrice: price,
    lastPrice: price,
    lowestPrice: price,
    lastChecked: Date.now(),
    status: "same",
    history: price ? [{ at: Date.now(), price }] : [],
  };
}

/** Watches due for a re-check. */
export function dueWatches(watches, now = Date.now()) {
  return watches.filter((watch) => now - (watch.lastChecked || 0) >= CHECK_EVERY_MS);
}

/** Ask the backend for the current prices of these watches. */
export async function checkWatches(watches) {
  const response = await fetch(`${API_URL}/api/v1/prices/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: watches.map((watch) => ({
        id: watch.id,
        name: watch.product.name,
        product_url: watch.product.product_url,
        marketplace: watch.product.marketplace,
        price: watch.lastPrice,
      })),
    }),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Handled below.
  }
  if (!response.ok || !body) {
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : "Couldn't check prices right now.");
  }
  return body.results || [];
}

/**
 * Apply check results to the watch list. Returns { watches, drops } where
 * drops are the watches whose price fell, with the amount saved.
 */
export function applyResults(watches, results, now = Date.now()) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const drops = [];
  const updated = watches.map((watch) => {
    const result = byId.get(watch.id);
    if (!result) return watch;
    if (result.status === "unknown" || !result.price) {
      return { ...watch, lastChecked: now, status: "unknown" };
    }
    const previous = watch.lastPrice;
    const next = {
      ...watch,
      lastPrice: result.price,
      lowestPrice: Math.min(watch.lowestPrice ?? result.price, result.price),
      lastChecked: now,
      status: result.status,
      history: [...watch.history, { at: now, price: result.price }].slice(-MAX_HISTORY),
    };
    if (result.status === "down" && previous) drops.push({ watch: next, saved: previous - result.price });
    return next;
  });
  return { watches: updated, drops };
}

/** Show a browser notification for price drops, when allowed. */
export function notifyDrops(drops) {
  if (!drops.length || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const first = drops[0];
  const title =
    drops.length === 1
      ? `Price drop: ${first.watch.product.name}`
      : `${drops.length} products you're watching got cheaper`;
  const body =
    drops.length === 1
      ? `Now ₹${first.watch.lastPrice.toLocaleString("en-IN")}, ₹${first.saved.toLocaleString("en-IN")} less.`
      : drops.map((drop) => `${drop.watch.product.name.slice(0, 40)}: −₹${drop.saved.toLocaleString("en-IN")}`).join("\n");
  try {
    new Notification(title, { body, icon: first.watch.product.image_url || undefined });
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

/** Ask once for permission to notify, the first time something is watched. */
export function askToNotify() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}
