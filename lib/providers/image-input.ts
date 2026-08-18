import { ProviderRequestError, type ImageInput } from './types';

/**
 * Shared helpers for turning an ImageInput into what an HTTP provider needs.
 * Used by providers that talk raw HTTP (bfl, gemini).
 */

/**
 * Encode an ImageInput as base64: raw bytes directly, or a base64 data: URI's
 * payload.
 *
 * A bare http(s) URL is deliberately NOT fetched here. Input images are
 * validated by `readImageField`, which only ever yields a Buffer or a data:
 * URI, so a URL should never reach this point — and fetching a caller-supplied
 * URL server-side would be a server-side request forgery sink. It is refused
 * rather than fetched. (A provider fetching its *own* result URL — e.g. BFL's
 * signed download link — does so directly, not through this helper.)
 */
export async function toBase64(input: ImageInput): Promise<string> {
  if (Buffer.isBuffer(input)) return input.toString('base64');

  const dataUri = /^data:[^;,]+;base64,(.*)$/s.exec(input);
  if (dataUri) return dataUri[1];

  if (/^https?:\/\//.test(input)) {
    throw new ProviderRequestError(
      400,
      'Remote image URLs are not accepted. Upload the image or send it as a data: URI.',
      `refused to fetch caller-supplied URL: ${input.slice(0, 120)}`,
    );
  }

  // A non-base64 data URI should never reach here: uploads are validated and the
  // region editor rasterises before sending.
  throw new ProviderRequestError(400, 'Unsupported image input for this provider.');
}

/** The mime type of a data: URI, defaulting to PNG. */
export function mimeOf(input: ImageInput, fallback = 'image/png'): string {
  if (typeof input === 'string') {
    const match = /^data:([^;,]+)[;,]/.exec(input);
    if (match) return match[1];
  }
  return fallback;
}

export async function readBodyExcerpt(response: Response, max = 600): Promise<string> {
  try {
    return (await response.text()).slice(0, max);
  } catch {
    return '(no body)';
  }
}
