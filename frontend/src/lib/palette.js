import { createContext, useContext } from "react";
import { API_URL } from "./products.js";

// "Colours that suit you": the palette from a selfie, kept only in this
// browser. Listings whose names mention one of the colours get "Suits you".
const STORAGE_KEY = "snapbuy-ai-palette";

// Shopping names for the same colour, so "maroon" also matches "burgundy".
const SAME_COLOUR = [
  ["maroon", "burgundy", "wine", "oxblood"],
  ["navy", "navy blue"],
  ["cream", "ivory", "off white", "off-white", "beige"],
  ["mustard", "ochre"],
  ["rust", "terracotta", "brick"],
  ["olive", "olive green", "khaki"],
  ["emerald", "emerald green", "bottle green"],
  ["teal", "peacock"],
  ["gold", "golden"],
  ["grey", "gray", "charcoal"],
  ["pink", "rose"],
  ["lavender", "lilac"],
  ["coral", "peach"],
];
// Words that describe a shade rather than name a colour.
const SHADE_WORDS = new Set(["light", "dark", "deep", "soft", "bright", "pale", "warm", "cool", "dusty", "muted"]);

export const PaletteContext = createContext(null);

export function usePalette() {
  return useContext(PaletteContext);
}

export function readPalette() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return saved && Array.isArray(saved.best) ? saved : null;
  } catch {
    return null;
  }
}

export function writePalette(palette) {
  try {
    if (palette) localStorage.setItem(STORAGE_KEY, JSON.stringify(palette));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The palette still works for this visit.
  }
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every name a palette colour may appear under in a listing title. */
function colourNames(name) {
  const words = name.toLowerCase().split(/\s+/).filter((word) => !SHADE_WORDS.has(word));
  const core = words.join(" ") || name.toLowerCase();
  const names = new Set([core]);
  for (const group of SAME_COLOUR) {
    if (group.includes(core) || group.includes(words.at(-1))) group.forEach((alias) => names.add(alias));
  }
  return [...names];
}

/** A matcher: (product) => the palette colour its name mentions, or null. */
export function paletteMatcher(palette) {
  if (!palette?.best?.length) return () => null;
  const patterns = palette.best.map((colour) => ({
    colour,
    pattern: new RegExp(`\\b(${colourNames(colour.name).map(escape).join("|")})\\b`, "i"),
  }));
  return (product) => {
    const name = product?.name || "";
    return patterns.find(({ pattern }) => pattern.test(name))?.colour || null;
  };
}

/** Find the colours that suit the person in a selfie (see the backend). */
export async function analyseColours(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_URL}/api/v1/style/colours`, { method: "POST", body: formData });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Handled below.
  }
  if (!response.ok || !body) {
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : "Couldn't check your colours. Please try again.");
  }
  return { ...body, savedAt: Date.now() };
}
