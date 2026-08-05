/**
 * Mask regions and export for the region editor.
 *
 * Client-only — everything here touches document/Image/canvas. Kept out of
 * MaskEditor.tsx so the geometry is separable from the React plumbing.
 *
 * A mask is a list of regions, drawn in order. Architectural subjects are
 * polygonal — a facade plane, a window opening, a roof pitch — so the precise
 * tools (polygon, rectangle) are the primary ones and the brush is the fallback
 * for organic edges like planting or sky.
 *
 * Every coordinate is normalised (0..1 of the image box), and brush radius is a
 * fraction of image width. One region list therefore renders correctly to the
 * on-screen overlay, to a full-resolution export mask, and again after a window
 * resize — without ever rescaling stored geometry.
 */

export interface Point {
  x: number; // 0..1
  y: number; // 0..1
}

/** Paint adds to the mask; erase carves back out of it. */
export type RegionMode = 'paint' | 'erase';

export interface PolygonRegion {
  kind: 'polygon';
  mode: RegionMode;
  points: Point[];
}

export interface RectRegion {
  kind: 'rect';
  mode: RegionMode;
  from: Point;
  to: Point;
}

export interface BrushRegion {
  kind: 'brush';
  mode: RegionMode;
  /** Radius as a fraction of image width. */
  radius: number;
  points: Point[];
}

export type Region = PolygonRegion | RectRegion | BrushRegion;

export type ToolKind = 'polygon' | 'rect' | 'brush';

export const TOOLS: readonly ToolKind[] = ['polygon', 'rect', 'brush'];

export const TOOL_LABELS: Record<ToolKind, string> = {
  polygon: 'Polygon',
  rect: 'Rectangle',
  brush: 'Brush',
};

export const TOOL_HINTS: Record<ToolKind, string> = {
  polygon:
    'Click to place each corner. Drag a corner to adjust it. Click the first corner, double-click, or press Enter to close the shape.',
  rect: 'Drag a box. Best for windows, doors, signs, a parked car.',
  brush: 'Freehand, for organic edges — planting, sky, water.',
};

/** Below this normalised distance a brush pointer-move is dropped as jitter. */
export const MIN_POINT_DISTANCE = 0.0015;

export const BRUSH_MIN = 0.01;
export const BRUSH_MAX = 0.2;
export const BRUSH_DEFAULT = 0.06;

/** Screen-space grab radius for polygon corner handles, in CSS pixels. */
export const HANDLE_HIT_PX = 10;

/* ------------------------------------------------------------------ geometry */

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rectIsDegenerate(region: RectRegion): boolean {
  return Math.abs(region.to.x - region.from.x) < 0.002 || Math.abs(region.to.y - region.from.y) < 0.002;
}

/** Whether a region would actually mark anything. */
export function regionIsDrawable(region: Region): boolean {
  switch (region.kind) {
    case 'polygon':
      return region.points.length >= 3;
    case 'rect':
      return !rectIsDegenerate(region);
    case 'brush':
      return region.points.length >= 1;
  }
}

/** Whether the mask has any additive content — the gate on sending an inpaint. */
export function hasMaskContent(regions: Region[]): boolean {
  return regions.some((region) => region.mode === 'paint' && regionIsDrawable(region));
}

/**
 * Index of the polygon corner within grab distance of a point, or -1.
 * `threshold` is normalised — the caller converts from HANDLE_HIT_PX.
 */
export function findHandle(points: Point[], at: Point, threshold: number): number {
  for (let i = 0; i < points.length; i++) {
    if (distance(points[i], at) <= threshold) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------- drawing */

function tracePolygon(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  width: number,
  height: number,
): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function fillRegion(
  ctx: CanvasRenderingContext2D,
  region: Region,
  width: number,
  height: number,
): void {
  if (!regionIsDrawable(region)) return;

  switch (region.kind) {
    case 'polygon': {
      tracePolygon(ctx, region.points, width, height);
      ctx.fill();
      return;
    }
    case 'rect': {
      const x = Math.min(region.from.x, region.to.x) * width;
      const y = Math.min(region.from.y, region.to.y) * height;
      const w = Math.abs(region.to.x - region.from.x) * width;
      const h = Math.abs(region.to.y - region.from.y) * height;
      ctx.fillRect(x, y, w, h);
      return;
    }
    case 'brush': {
      const radiusPx = Math.max(region.radius * width, 1);
      ctx.lineWidth = radiusPx * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const [first, ...rest] = region.points;
      if (!first) return;

      if (rest.length === 0) {
        // A tap, not a drag: a zero-length line draws nothing, so place a dot.
        ctx.beginPath();
        ctx.arc(first.x * width, first.y * height, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      ctx.beginPath();
      ctx.moveTo(first.x * width, first.y * height);
      for (const point of rest) ctx.lineTo(point.x * width, point.y * height);
      ctx.stroke();
    }
  }
}

const ACCENT = '163,105,15';

export interface OverlayState {
  regions: Region[];
  /** Polygon currently being placed, if any. */
  draft: Point[] | null;
  /** Cursor position, for the rubber-band edge while placing a polygon. */
  draftHover: Point | null;
  /** Rectangle currently being dragged, if any. */
  rectDraft: RectRegion | null;
  /** Mode the next region will use — colours the draft. */
  mode: RegionMode;
}

/**
 * The translucent overlay the user works against: filled regions, plus crisp
 * outlines and corner handles for the polygon in progress so the geometry reads
 * as exact rather than approximate.
 */
export function renderOverlay(
  ctx: CanvasRenderingContext2D,
  state: OverlayState,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  for (const region of state.regions) {
    if (region.mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = `rgba(${ACCENT},0.45)`;
      ctx.fillStyle = `rgba(${ACCENT},0.45)`;
    }
    fillRegion(ctx, region, width, height);
  }

  ctx.globalCompositeOperation = 'source-over';

  // Committed edges, drawn on top so a polygon boundary stays legible where it
  // meets the render underneath.
  for (const region of state.regions) {
    if (region.kind !== 'polygon' || !regionIsDrawable(region)) continue;
    ctx.strokeStyle = region.mode === 'erase' ? 'rgba(180,40,40,0.9)' : `rgba(${ACCENT},0.9)`;
    ctx.lineWidth = 1.5;
    tracePolygon(ctx, region.points, width, height);
    ctx.stroke();
  }

  const erasing = state.mode === 'erase';
  const draftStroke = erasing ? 'rgba(180,40,40,0.95)' : `rgba(${ACCENT},0.95)`;

  if (state.rectDraft) {
    const { from, to } = state.rectDraft;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = draftStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      Math.min(from.x, to.x) * width,
      Math.min(from.y, to.y) * height,
      Math.abs(to.x - from.x) * width,
      Math.abs(to.y - from.y) * height,
    );
    ctx.setLineDash([]);
  }

  if (state.draft && state.draft.length > 0) {
    const points = state.draft;

    // Fill the area enclosed so far, faintly, so the shape is readable early.
    if (points.length >= 3) {
      ctx.fillStyle = erasing ? 'rgba(180,40,40,0.18)' : `rgba(${ACCENT},0.2)`;
      tracePolygon(ctx, points, width, height);
      ctx.fill();
    }

    ctx.strokeStyle = draftStroke;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (state.draftHover) {
      ctx.lineTo(state.draftHover.x * width, state.draftHover.y * height);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Corner handles. The first is emphasised because clicking it closes.
    points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      const radius = index === 0 ? 5.5 : 4;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = draftStroke;
      ctx.stroke();
    });
  }
}

/**
 * The mask the provider receives: white = edit this, black = keep. Rendered at
 * the image's natural resolution so it lines up pixel-for-pixel. Handles and
 * dashed guides are deliberately absent — this is the geometry only.
 */
export function renderMask(
  ctx: CanvasRenderingContext2D,
  regions: Region[],
  width: number,
  height: number,
): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  for (const region of regions) {
    // Erasing paints black back over white — same result, no alpha involved,
    // which keeps the exported PNG strictly two-tone.
    const colour = region.mode === 'erase' ? '#000000' : '#ffffff';
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    fillRegion(ctx, region, width, height);
  }
}

/* --------------------------------------------------------------- encoding */

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode canvas to PNG.'));
    }, 'image/png');
  });
}

/** Export the regions as a PNG mask at the given natural dimensions. */
export async function regionsToMaskBlob(
  regions: Region[],
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  renderMask(ctx, regions, width, height);
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
