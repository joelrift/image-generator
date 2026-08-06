import { ProviderRequestError, type ImageInput } from './types';

/**
 * Shared helpers for turning an ImageInput into what an HTTP provider needs.
 * Used by providers that talk raw HTTP (bfl, gemini).
 */

/** Strip a data: URI prefix, fetch a URL, or encode raw bytes — always base64. */
export async function toBase64(input: ImageInput, timeoutMs = 30_000): Promise<string> {
  if (Buffer.isBuffer(input)) return input.toString('base64');

  const dataUri = /^data:[^;,]+;base64,(.*)$/s.exec(input);
  if (dataUri) return dataUri[1];

  if (/^https?:\/\//.test(input)) {
    const response = await fetch(input, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new ProviderRequestError(
        502,
        'Could not fetch the source image to send to the provider.',
        `GET ${input} → ${response.status}`,
      );
    }
    return Buffer.from(await response.arrayBuffer()).toString('base64');
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
