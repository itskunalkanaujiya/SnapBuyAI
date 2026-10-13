import { API_URL } from "./products.js";

/**
 * Run a streamed image search.
 *
 * The backend sends newline-delimited JSON events ("stage", "identified",
 * "preview", "final", "error"); onEvent is called for each one as it
 * arrives. Throws an Error with a user-facing message if the request fails.
 */
export async function streamSearch(file, onEvent) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/api/v1/products/search-by-image/stream`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let detail = "Something went wrong while searching. Please try again.";
    try {
      const body = await response.json();
      detail = body.detail || body.message || detail;
    } catch {
      // Keep the default message for non-JSON responses.
    }
    throw new Error(detail);
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
