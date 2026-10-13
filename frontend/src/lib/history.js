// Recent searches, kept in this browser only (localStorage).
const HISTORY_KEY = "snapbuy-ai-recent-searches";
const MAX_ENTRIES = 6;
const THUMBNAIL_SIZE = 640;

export function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeHistory(entries) {
  // Photos take space; if storage is full, drop the oldest entries.
  for (let count = entries.length; count >= 0; count -= 1) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, count)));
      return;
    } catch {
      // Try again with fewer entries.
    }
  }
}

// The same photo searched again (e.g. "Search again" on a reopened result,
// which re-encodes the photo) replaces its earlier entry.
function isSameSearch(a, b) {
  return (
    a.id === b.id ||
    (Boolean(a.image) && a.image === b.image) ||
    (Boolean(a.query) &&
      (a.kind || "photo") === (b.kind || "photo") &&
      a.query.toLowerCase() === (b.query || "").toLowerCase() &&
      a.fileName === b.fileName)
  );
}

/** Add a search to the front of the list, replacing an earlier copy. */
export function addToHistory(entries, entry) {
  const rest = entries.filter((item) => !isSameSearch(item, entry));
  return [entry, ...rest].slice(0, MAX_ENTRIES);
}

/** Downscale a photo to a small JPEG data URL for storage. */
export async function makeThumbnail(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Turn a stored data URL back into a File that can be searched again. */
export function dataUrlToFile(dataUrl, name) {
  const [header, base64] = dataUrl.split(",");
  const type = header.match(/data:(.*?);/)?.[1] || "image/jpeg";
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new File([bytes], name || "photo.jpg", { type });
}

export function formatTimeAgo(timestamp, now) {
  const minutes = Math.round((now - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
