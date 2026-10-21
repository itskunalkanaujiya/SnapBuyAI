import { API_URL } from "./products.js";

const GENERIC_ERROR = "Something went wrong while searching. Please try again.";

/**
 * Read a streamed search response.
 *
 * The backend sends newline-delimited JSON events ("stage", "identified",
 * "preview", "final", "error"); onEvent is called for each one as it
 * arrives. Throws an Error with a user-facing message if the request fails.
 */
async function readEventStream(response, onEvent) {
  if (!response.ok) {
    let detail = GENERIC_ERROR;
    try {
      const body = await response.json();
      detail = body.detail || body.message || detail;
    } catch {
      // Keep the default message for non-JSON responses.
    }
    throw new Error(typeof detail === "string" ? detail : GENERIC_ERROR);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line) => {
    if (!line.trim()) return;
    onEvent(JSON.parse(line));
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    lines.forEach(handleLine);
  }

  handleLine(buffer + decoder.decode());
}

/**
 * Run a streamed image search. An optional query (brand, model, colour…)
 * narrows the Google Lens search for the same photo.
 */
export async function streamSearch(file, onEvent, query) {
  const formData = new FormData();
  formData.append("file", file);
  if (query) formData.append("query", query);

  const response = await fetch(`${API_URL}/api/v1/products/search-by-image/stream`, {
    method: "POST",
    body: formData,
  });

  await readEventStream(response, onEvent);
}

/**
 * Find the outfit: identify every item the person wears, then stream
 * shopping options per item ("items", then one "item" event each).
 */
export async function streamOutfit(file, onEvent) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/api/v1/outfit/stream`, {
    method: "POST",
    body: formData,
  });

  await readEventStream(response, onEvent);
}

/**
 * Rate my outfit: streams "rating" (score, verdict, strengths), then
 * shoppable suggestions like Find the outfit ("items", one "item" each).
 */
export async function streamRating(file, onEvent, colours) {
  const formData = new FormData();
  formData.append("file", file);
  // The person's best colours ("Colours that suit you"), for the tips.
  if (colours?.length) formData.append("colours", colours.join(","));

  const response = await fetch(`${API_URL}/api/v1/style/rate/stream`, {
    method: "POST",
    body: formData,
  });

  await readEventStream(response, onEvent);
}

/** Run a streamed search for a typed product description. */
export async function streamTextSearch(query, onEvent) {
  const response = await fetch(`${API_URL}/api/v1/products/search-by-text/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  await readEventStream(response, onEvent);
}

/**
 * Complete the look: items that go with a product, streamed like Find the
 * outfit ("items", then one "item" event each).
 */
export async function streamLook(name, onEvent, price) {
  const response = await fetch(`${API_URL}/api/v1/look/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The price keeps suggestions at the same price level.
    body: JSON.stringify({ name, price: Number.isFinite(price) ? price : null }),
  });

  await readEventStream(response, onEvent);
}

/** Shop this room: the pieces in a room photo, streamed like an outfit. */
export async function streamRoom(file, onEvent) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/api/v1/room/stream`, {
    method: "POST",
    body: formData,
  });

  await readEventStream(response, onEvent);
}

/**
 * Budget look planner: streams "plan" (title, budget), then the pieces like
 * an outfit; "final" adds the picked listing per piece and the total.
 */
export async function streamPlan({ request, budget, gender }, onEvent) {
  const response = await fetch(`${API_URL}/api/v1/plan/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request, budget: budget || null, gender: gender || null }),
  });

  await readEventStream(response, onEvent);
}
