import { API_URL } from "./products.js";

const GENERIC_ERROR = "The assistant couldn't answer. Please try again.";

// Only what the assistant needs to compare listings.
function brief(product) {
  return {
    name: product.name || "",
    price: product.price ?? null,
    marketplace: product.marketplace || "",
    rating: product.rating ?? null,
    reviews: product.reviews ?? null,
    condition: product.condition || "",
  };
}

/**
 * Ask the shopping assistant about the products on screen.
 * messages: [{ role: "user" | "assistant", content }], latest question last.
 * Returns { reply, picks: [indexes into products], search: string | null }.
 */
export async function askAssistant(messages, products, query) {
  const response = await fetch(`${API_URL}/api/v1/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, products: products.map(brief), query: query || "" }),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Handled below.
  }
  if (!response.ok || !body) {
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : GENERIC_ERROR);
  }
  return body;
}
