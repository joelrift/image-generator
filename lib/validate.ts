/**
 * Request parsing and validation shared by the route handlers.
 *
 * Not in the brief's file list, but every route needs the same upload limits and
 * enum checks, and duplicating them across five handlers is how one of them ends
 * up missing a check. Kept deliberately dependency-free.
 */

/** Keep in sync with next.config.ts bodySizeLimit. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB

/**
 * Raster formats only. SVG is excluded on purpose: it is an active document that
 * can carry script, and nothing downstream needs it.
 */
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

/**
 * Pull an image out of multipart form data as a Buffer.
 *
 * `contentType` is client-supplied and therefore a hint, not proof — it is
 * checked to reject the obvious cases early. Real content sniffing belongs
 * wherever these bytes get persisted (Phase 5), not here.
 */
export async function readImageField(
  form: FormData,
  field: string,
  opts: { required?: boolean } = {},
): Promise<Buffer | string | undefined> {
  const value = form.get(field);

  if (value === null || value === '') {
    if (opts.required) throw badRequest(`Missing "${field}".`);
    return undefined;
  }

  /*
   * A data URI or URL is also acceptable — ImageInput is `Buffer | string`, so
   * the reference is forwarded as-is for the provider to fetch. It must not be
   * wrapped in a Buffer: that would hand the provider the ASCII bytes of the URL
   * as if they were image data.
   */
  if (typeof value === 'string') {
    if (!/^(data:image\/|https?:\/\/)/.test(value)) {
      throw badRequest(`"${field}" must be an uploaded file, a data: image URI, or an http(s) URL.`);
    }
    // SVG is rejected here for the same reason as in the upload allowlist: it is
    // an active document. The region editor rasterises before sending.
    if (/^data:image\/svg\+xml/i.test(value)) {
      throw badRequest(`"${field}" must not be an SVG.`);
    }
    return value;
  }

  const file = value as File;

  if (file.size === 0) {
    throw badRequest(`"${field}" is empty.`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw badRequest(
      `"${field}" is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
    );
  }
  if (file.type && !ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    throw badRequest(`"${field}" is ${file.type}; allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}.`);
  }

  return Buffer.from(await file.arrayBuffer());
}

export function readString(
  form: FormData,
  field: string,
  opts: { required?: boolean; maxLength?: number } = {},
): string {
  const raw = form.get(field);
  const value = typeof raw === 'string' ? raw.trim() : '';

  if (!value) {
    if (opts.required) throw badRequest(`Missing "${field}".`);
    return '';
  }

  const maxLength = opts.maxLength ?? 2000;
  if (value.length > maxLength) {
    throw badRequest(`"${field}" is longer than ${maxLength} characters.`);
  }
  return value;
}

export function readEnum<T extends string>(
  form: FormData,
  field: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = form.get(field);
  if (typeof raw !== 'string' || raw === '') return fallback;
  if (!allowed.includes(raw as T)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}.`);
  }
  return raw as T;
}

export function readNumber(
  form: FormData,
  field: string,
  opts: { min: number; max: number; fallback: number; integer?: boolean },
): number {
  const raw = form.get(field);
  if (typeof raw !== 'string' || raw === '') return opts.fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`"${field}" must be a number.`);
  }
  const value = opts.integer ? Math.trunc(parsed) : parsed;
  if (value < opts.min || value > opts.max) {
    throw badRequest(`"${field}" must be between ${opts.min} and ${opts.max}.`);
  }
  return value;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
