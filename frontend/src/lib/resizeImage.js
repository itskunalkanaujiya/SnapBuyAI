// The backend scales photos down to 1000 px anyway, and hosting limits
// request bodies to 4.5 MB, so large photos are shrunk before uploading.
const MAX_DIMENSION = 1600;
const MAX_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.9;

export async function prepareForUpload(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // Let the server validate formats the browser can't decode.
  }

  const largest = Math.max(bitmap.width, bitmap.height);
  if (largest <= MAX_DIMENSION && file.size <= MAX_BYTES) {
    bitmap.close?.();
    return file;
  }

  const scale = Math.min(1, MAX_DIMENSION / largest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) return file;

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

const CROP_PADDING = 0.08; // share of the box added on each side

/**
 * Cut one item out of a photo (url: an object or data URL) as a JPEG file.
 * box: [x1, y1, x2, y2] as fractions of the photo.
 */
export async function cropToFile(url, box, name = "item.jpg") {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const [x1, y1, x2, y2] = box;
  const padX = (x2 - x1) * CROP_PADDING;
  const padY = (y2 - y1) * CROP_PADDING;
  const left = Math.max(0, x1 - padX) * bitmap.width;
  const top = Math.max(0, y1 - padY) * bitmap.height;
  const width = Math.min(1, x2 + padX) * bitmap.width - left;
  const height = Math.min(1, y2 + padY) * bitmap.height - top;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  canvas.getContext("2d").drawImage(bitmap, left, top, width, height, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("Couldn't cut this item out of the photo.");
  return new File([blob], name, { type: "image/jpeg" });
}
