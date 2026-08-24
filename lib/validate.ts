/**
 * Request parsing and validation shared by the route handlers.
 *
 * Not in the brief's file list, but every route needs the same upload limits and
 * enum checks, and duplicating them across five handlers is how one of them ends
 * up missing a check. Kept deliberately dependency-free.
 */

/** Per-file upload ceiling. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB

/** Most material swatches a single request may carry. */
export const MAX_MATERIALS = 12;

/**
 * Total request-body ceiling, enforced before the body is parsed
 * (`readLimitedFormData`). Sized to the most files any one route accepts at the
 * per-file limit — image + mask + style reference + MAX_MATERIALS swatches — so
 * it never rejects input the per-field validators would accept; it only bounds
 * an otherwise-unbounded body so a single request cannot exhaust memory.
 *
 * `next.config.ts`'s `serverActions.bodySizeLimit` does NOT apply to route
 * handlers, so without this guard the body limit was effectively unenforced.
 *
 * Overridable with `RENDER_MAX_BODY_BYTES` for an operator who needs a tighter
 * or looser ceiling than the default.
 */
export const MAX_TOTAL_BODY_BYTES = ((): number => {
  const override = Number(process.env.RENDER_MAX_BODY_BYTES);
  return Number.isFinite(override) && override > 0
    ? override
    : MAX_UPLOAD_BYTES * (MAX_MATERIALS + 3);
})();

/**
 * Raster formats only. SVG is excluded on purpose: it is an active document that
 * can carry script, and nothing downstream needs it.
 */
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Parse multipart/form data with a hard cap on the total body size, applied
 * *before* the body is buffered.
 *
 * `request.formData()` reads the entire body into memory first, so the per-field
 * size checks below can only fire after a multi-gigabyte body has already been
 * buffered — no protection at all against a memory-exhaustion request. This
 * reads the stream with a running byte counter and aborts the moment the cap is
 * crossed, rejecting a lying or absent `Content-Length` as well as an honest
 * oversized one.
 */
export async function readLimitedFormData(
  request: Request,
  maxBytes = MAX_TOTAL_BODY_BYTES,
): Promise<FormData> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, `Request body is larger than ${formatBytes(maxBytes)}.`);
  }

  const body = request.body;
  if (!body) return parseFormData(request);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, `Request body is larger than ${formatBytes(maxBytes)}.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const contentType = request.headers.get('content-type');
  return parseFormData(
    new Response(Buffer.concat(chunks), {
      headers: contentType ? { 'content-type': contentType } : undefined,
    }),
  );
}

/** Parse a form body, turning a malformed/empty body into a 400 rather than a 500. */
async function parseFormData(source: Request | Response): Promise<FormData> {
  try {
    return await source.formData();
  } catch {
    throw badRequest('Request body must be multipart form data.');
  }
}

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
 * Pull an image out of multipart form data as a Buffer or a data: image URI.
 *
 * `contentType` is client-supplied and therefore a hint, not proof — it is
 * checked to reject the obvious cases early. Real content sniffing belongs
 * wherever these bytes get persisted (Phase 5), not here.
 *
 * A client-supplied http(s) URL is deliberately NOT accepted: the providers
 * fetch their input images server-side (`toBase64`), so honouring an arbitrary
 * URL here would let a caller make the server issue requests to internal
 * addresses (cloud metadata, localhost services) — a server-side request
 * forgery. Every real flow sends either an uploaded file or a data: URI (the
 * region editor rasterises, and provider results are inlined as data URIs), so
 * nothing legitimate needs the URL path. If remote references are ever wanted,
 * add them back behind an explicit host allowlist, not as a blanket accept.
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
   * A data: image URI is forwarded as-is — ImageInput is `Buffer | string`, and
   * it must not be wrapped in a Buffer (that would hand the provider the ASCII
   * bytes of the URI rather than image data). http(s) URLs are refused (SSRF).
   */
  if (typeof value === 'string') {
    if (!/^data:image\//.test(value)) {
      throw badRequest(`"${field}" must be an uploaded file or a data: image URI.`);
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

/**
 * Read the material palette from the form: files under `material`, plus a
 * parallel JSON array of labels under `materialLabels`. Each file is validated
 * like any image upload. Returns [] when none were sent.
 */
export async function readMaterials(
  form: FormData,
): Promise<{ label: string; image: Buffer }[]> {
  const files = form.getAll('material').filter((v): v is File => v instanceof File);
  if (files.length === 0) return [];

  let labels: string[] = [];
  const rawLabels = form.get('materialLabels');
  if (typeof rawLabels === 'string' && rawLabels) {
    try {
      const parsed: unknown = JSON.parse(rawLabels);
      if (Array.isArray(parsed)) labels = parsed.map((x) => String(x));
    } catch {
      throw badRequest('"materialLabels" must be a JSON array.');
    }
  }

  if (files.length > MAX_MATERIALS) throw badRequest(`Too many materials (max ${MAX_MATERIALS}).`);

  const materials: { label: string; image: Buffer }[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size === 0) continue;
    if (file.size > MAX_UPLOAD_BYTES) {
      throw badRequest(`A material image is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
    }
    if (file.type && !ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      throw badRequest(`A material image is ${file.type}; allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}.`);
    }
    materials.push({
      label: (labels[i] ?? `Material ${i + 1}`).slice(0, 120),
      image: Buffer.from(await file.arrayBuffer()),
    });
  }
  return materials;
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
