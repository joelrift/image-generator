/**
 * Client-side image resample — Option A upscaling.
 *
 * A plain high-quality resample to `scale`× the pixels. It makes the image
 * bigger, not more detailed: no new texture is invented, which is the honest
 * limit of resampling (an AI/creative upscaler — a provider path — is what adds
 * detail, and that is deliberately separate).
 *
 * Done in the browser on a canvas rather than server-side because the image is
 * already here as a data URI, it needs no API and no dependency, and it keeps a
 * 4K encode off a serverless function's short timeout and memory budget. Reuses
 * the same canvas approach as the mask editor.
 *
 * Works for any raster the app holds, and rasterises Mock's SVG placeholders on
 * the way through. BFL results are inlined data URIs (same-origin), so the canvas
 * is never tainted; a remote cross-origin URL could taint it, hence the readback
 * is guarded.
 */

export type UpscaleFactor = 2 | 4;

export interface UpscaleResult {
  url: string;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Best-effort: lets a CORS-enabled remote image stay readable.
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the image to upscale.'));
    image.src = src;
  });
}

export async function upscaleImage(src: string, scale: UpscaleFactor): Promise<UpscaleResult> {
  const image = await loadImage(src);

  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  if (!width || !height) {
    throw new Error('The image has no intrinsic size to scale.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  try {
    return { url: canvas.toDataURL('image/png'), width, height };
  } catch {
    // toDataURL throws on a tainted canvas (a cross-origin image without CORS).
    throw new Error('This image cannot be upscaled in the browser (its source blocks reading).');
  }
}
