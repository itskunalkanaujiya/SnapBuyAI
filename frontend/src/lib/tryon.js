import { API_URL } from "./products.js";

// The person photo is kept in this browser so it can be reused for every
// try-on, and can be forgotten at any time.
const PERSON_KEY = "snapbuy-ai-tryon-photo";
const PERSON_MAX_SIZE = 1024;

export function canTryOn(product) {
  return Boolean(product?.tryon_category && (product.tryon_image_url || product.image_url));
}

export function readSavedPerson() {
  try {
    return localStorage.getItem(PERSON_KEY) || "";
  } catch {
    return "";
  }
}

export function savePerson(dataUrl) {
  try {
    localStorage.setItem(PERSON_KEY, dataUrl);
  } catch {
    // Storage full or blocked: the photo still works for this visit.
  }
}

export function forgetPerson() {
  try {
    localStorage.removeItem(PERSON_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Downscale a photo to a JPEG data URL (portrait photos keep their shape). */
export async function photoToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PERSON_MAX_SIZE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", 0.9);
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const type = header.match(/data:(.*?);/)?.[1] || "image/jpeg";
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type });
}

/**
 * Ask the backend to render the person wearing the product.
 * Returns an object URL for the resulting JPEG.
 */
export async function requestTryOn(personDataUrl, product) {
  const formData = new FormData();
  formData.append("person", dataUrlToBlob(personDataUrl), "person.jpg");
  formData.append("garment_url", product.tryon_image_url || product.image_url);
  formData.append("category", product.tryon_category);
  formData.append("garment_name", product.name || "");

  const response = await fetch(`${API_URL}/api/v1/tryon`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let detail = "Couldn't create the try-on. Please try again.";
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Keep the default message.
    }
    throw new Error(detail);
  }

  return URL.createObjectURL(await response.blob());
}
