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
