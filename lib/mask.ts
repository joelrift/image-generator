/**
 * Brush strokes and mask export for the region editor.
 *
 * Client-only — everything here touches document/Image/canvas. Kept out of
 * MaskEditor.tsx so the geometry is separable from the React plumbing.
 *
 * Strokes are stored in normalised coordinates (0..1 of the image box) with the
 * radius as a fraction of image width. That means one stroke list renders
 * correctly to the on-screen overlay, to a full-resolution export mask, and
 * again after a window resize — without ever rescaling stored points.
 */

export interface MaskPoint {
  x: number; // 0..1
  y: number; // 0..1
}

export interface MaskStroke {
  mode: 'paint' | 'erase';
  /** Brush radius as a fraction of image width. */
  radius: number;
  points: MaskPoint[];
}

/** Below this normalised distance a pointer move is dropped as jitter. */
export const MIN_POINT_DISTANCE = 0.0015;

export const BRUSH_MIN = 0.01;
export const BRUSH_MAX = 0.2;
export const BRUSH_DEFAULT = 0.06;

export function hasMaskContent(strokes: MaskStroke[]): boolean {
  return strokes.some((stroke) => stroke.mode === 'paint' && stroke.points.length > 0);
}

export function distance(a: MaskPoint, b: MaskPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Paint one stroke into a context sized `width`×`height`.
 *
 * Radius keys off width alone (not the diagonal) so a brush that looks 40 px
 * wide on screen is 40 px wide in the exported mask at any aspect ratio.
 */
function strokePath(
  ctx: CanvasRenderingContext2D,
  stroke: MaskStroke,
  width: number,
  height: number,
): void {
  const radiusPx = Math.max(stroke.radius * width, 1);

  ctx.lineWidth = radiusPx * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const [first, ...rest] = stroke.points;
  if (!first) return;

  if (rest.length === 0) {
    // A tap, not a drag: a line of zero length draws nothing, so place a dot.
    ctx.beginPath();
    ctx.arc(first.x * width, first.y * height, radiusPx, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(first.x * width, first.y * height);
  for (const point of rest) {
    ctx.lineTo(point.x * width, point.y * height);
  }
  ctx.stroke();
}

/**
 * The translucent overlay the user paints against. Erase strokes cut back out
 * with destination-out so the brush behaves like a real eraser.
 */
export function renderOverlay(
  ctx: CanvasRenderingContext2D,
  strokes: MaskStroke[],
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  for (const stroke of strokes) {
    if (stroke.mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      // Bronze accent at partial alpha — the render underneath stays readable.
      ctx.strokeStyle = 'rgba(163,105,15,0.45)';
      ctx.fillStyle = 'rgba(163,105,15,0.45)';
    }
    strokePath(ctx, stroke, width, height);
  }

  ctx.globalCompositeOperation = 'source-over';
}

/**
 * The mask the provider receives: white = edit this, black = keep. Rendered at
 * the image's natural resolution so it lines up pixel-for-pixel.
 */
export function renderMask(
  ctx: CanvasRenderingContext2D,
  strokes: MaskStroke[],
  width: number,
  height: number,
): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  for (const stroke of strokes) {
    // Erasing paints black back over white — same result, no alpha involved,
    // which keeps the exported PNG strictly two-tone.
    const colour = stroke.mode === 'erase' ? '#000000' : '#ffffff';
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    strokePath(ctx, stroke, width, height);
  }
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode canvas to PNG.'));
    }, 'image/png');
  });
}

/** Export the strokes as a PNG mask at the given natural dimensions. */
export async function strokesToMaskBlob(
  strokes: MaskStroke[],
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  renderMask(ctx, strokes, width, height);
  return canvasToPngBlob(canvas);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the image to edit.'));
    image.src = src;
  });
}

/**
 * Turn a data: URI into a PNG blob.
 *
 * Needed because MockProvider returns SVG data URIs, and the upload allowlist
 * rejects SVG — it is an active document that can carry script. Rasterising here
 * means the editor sends the provider a plain raster either way, and the
 * allowlist does not need a hole in it.
 *
 * Only used for data: URIs. Remote provider URLs are forwarded as URLs (see
 * imageFieldValue), which sidesteps canvas tainting entirely.
 */
export async function rasterizeDataUriToPng(src: string): Promise<Blob> {
  const image = await loadImage(src);

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  ctx.drawImage(image, 0, 0);
  return canvasToPngBlob(canvas);
}

/**
 * What to put in the `image` form field for a given provider image.
 *
 * A remote URL is passed through as a string: the server hands it to the
 * provider, which fetches it directly — no re-upload, and no CORS problem from
 * reading it into a canvas. A data: URI is rasterised to PNG bytes.
 */
export async function imageFieldValue(src: string): Promise<Blob | string> {
  if (/^https?:\/\//.test(src)) return src;
  return rasterizeDataUriToPng(src);
}
