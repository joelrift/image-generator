import { mimeOf, readBodyExcerpt, toBase64 } from './image-input';
import {
  ProviderNotImplementedError,
  ProviderRequestError,
  type AddElementInput,
  type FinalizeInput,
  type GenerateInput,
  type ImageInput,
  type ImageResult,
  type InpaintInput,
  type MaterialRef,
  type ProviderName,
  type RenderProvider,
  type UpscaleInput,
} from './types';

/**
 * Google Gemini image ("Nano Banana") — an instruction/image editor, intended
 * here as the stage-2 editor behind a geometry-locked base render from another
 * provider (brief §2 item 7, "add something" → Nano Banana Pro).
 *
 * ⚠️ WRITTEN WITHOUT ACCESS TO THE LIVE API OR ITS DOCS. The endpoint shape,
 * model id, request fields, and response path come from prior knowledge of the
 * Generative Language API, not from ai.google.dev. Treat the first real run as a
 * correction pass. Everything likely to need changing is in CONFIG (env-
 * overridable) or in buildEditBody() — the only place request fields are named.
 *
 * Gemini has no ControlNet and no mask channel: it edits from an instruction over
 * the whole image. A painted selection is therefore passed as a *reference*
 * image with an instruction to confine the change to it — best-effort, not a hard
 * mask. For hard, region-bounded edits, Fill (BFL/fal) remains the better route;
 * this provider is for instruction-driven changes where Gemini's editing quality
 * is the draw.
 */

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const CONFIG = {
  baseUrl: (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com').replace(
    /\/$/,
    '',
  ),
  /*
   * The image-capable Gemini model. "Nano Banana" is gemini-2.5-flash-image;
   * "Nano Banana Pro" is a newer/higher-quality id. Set GEMINI_IMAGE_MODEL to
   * whatever the account has (e.g. gemini-2.5-flash-image, or a 3-pro image id).
   */
  model: process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image',
  apiVersion: process.env.GEMINI_API_VERSION ?? 'v1beta',
  /*
   * Some image models reject IMAGE-only and require TEXT+IMAGE. If a request is
   * rejected over modalities, flip GEMINI_RESPONSE_MODALITIES to "IMAGE".
   */
  responseModalities: (process.env.GEMINI_RESPONSE_MODALITIES ?? 'TEXT,IMAGE')
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean),
  requestTimeoutMs: envNumber(process.env.GEMINI_REQUEST_TIMEOUT_MS, 60_000),
} as const;

const CHECK_HINT =
  'Verify the model id and request fields in lib/providers/gemini.ts against ai.google.dev — ' +
  'they were written without access to the live API.';

export class GeminiProvider implements RenderProvider {
  readonly name: ProviderName = 'gemini';

  private readonly apiKey: string;

  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Unset the edit provider to fall back to Mock.');
    }
    this.apiKey = apiKey;
  }

  /**
   * generate is supported (Gemini can render from the source + an instruction)
   * but this provider is meant for edits; a geometry-locked base is better made
   * by a ControlNet or Kontext generate. Left implemented so gemini can stand
   * alone if chosen for both.
   */
  async generate(input: GenerateInput): Promise<ImageResult> {
    if (input.styleRefImage) {
      throw new ProviderNotImplementedError(this.name, 'generate (style reference)', 'Phase 4');
    }
    const materials = input.materials ?? [];
    const image = await this.callEdit(buildGenerateInstruction(input), input.image, undefined, materials);
    return {
      images: [image],
      meta: {
        provider: this.name,
        op: 'generate',
        model: CONFIG.model,
        materials: materials.length,
      },
    };
  }

  async inpaint(input: InpaintInput): Promise<ImageResult> {
    return this.editResult(input.image, input.mask, input.prompt, 'inpaint');
  }

  async addElement(input: AddElementInput): Promise<ImageResult> {
    return this.editResult(input.image, input.mask, input.prompt, 'addElement');
  }

  /** Gemini has no upscaler; resampling is handled client-side (Option A). */
  async upscale(_input: UpscaleInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'upscale', 'client-side resample');
  }

  /**
   * The finishing pass — this is Gemini's intended role: re-render the composed
   * image photorealistically from the whole-image instruction the route built.
   */
  async finalize(input: FinalizeInput): Promise<ImageResult> {
    const materials = input.materials ?? [];
    const image = await this.callEdit(input.prompt, input.image, undefined, materials);
    return {
      images: [image],
      meta: { provider: this.name, op: 'finalize', model: CONFIG.model, materials: materials.length },
    };
  }

  private async editResult(
    image: ImageInput,
    mask: ImageInput | undefined,
    prompt: string,
    op: 'inpaint' | 'addElement',
  ): Promise<ImageResult> {
    const instruction = mask
      ? `${prompt}. Apply this change only within the white area of the provided mask image; leave everything else exactly unchanged.`
      : prompt;

    const result = await this.callEdit(instruction, image, mask);
    return {
      images: [result],
      meta: {
        provider: this.name,
        op,
        model: CONFIG.model,
        maskHandling: mask ? 'reference-image (best-effort, not a hard mask)' : 'none',
      },
    };
  }

  /* ------------------------------------------------------------ transport */

  private async callEdit(
    instruction: string,
    image: ImageInput,
    mask?: ImageInput,
    materials: MaterialRef[] = [],
  ): Promise<string> {
    const url = `${CONFIG.baseUrl}/${CONFIG.apiVersion}/models/${CONFIG.model}:generateContent`;
    const body = await buildEditBody(instruction, image, mask, materials);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
      });
    } catch (cause) {
      throw new ProviderRequestError(
        504,
        'Could not reach the image provider.',
        `POST ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (!response.ok) {
      const status = response.status;
      const excerpt = await readBodyExcerpt(response);
      const message =
        status === 401 || status === 403
          ? 'The provider rejected the API key.'
          : status === 429
            ? 'The provider is rate-limiting; try again shortly.'
            : status === 400
              ? `The provider rejected the request as malformed. ${CHECK_HINT}`
              : `The provider returned ${status}. ${CHECK_HINT}`;
      throw new ProviderRequestError(502, message, `POST ${url} → ${status}: ${excerpt}`);
    }

    const payload = (await response.json()) as GeminiResponse;

    // Content-policy blocks are a user-actionable outcome, not a bug.
    const block = payload.promptFeedback?.blockReason ?? payload.candidates?.[0]?.finishReason;
    if (block && block !== 'STOP' && block !== 'MAX_TOKENS') {
      throw new ProviderRequestError(
        422,
        'The provider blocked this request by its content policy. Try rephrasing the prompt.',
        `finishReason/blockReason: ${block}`,
      );
    }

    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    // REST responses use camelCase (inlineData); accept snake_case defensively.
    const imagePart = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const inline = imagePart?.inlineData ?? imagePart?.inline_data;
    if (!inline?.data) {
      throw new ProviderRequestError(
        502,
        `The provider returned no image. ${CHECK_HINT}`,
        JSON.stringify(payload).slice(0, 600),
      );
    }

    const mime = inline.mimeType ?? inline.mime_type ?? 'image/png';
    return `data:${mime};base64,${inline.data}`;
  }
}

/* ============================================================ shapes */

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
  mime_type?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/* ================================================= request body ==
 *
 * The only place request fields are named. If a request is rejected as
 * malformed, the fix is here or in CONFIG.
 */

function buildGenerateInstruction(input: GenerateInput): string {
  const style = input.style ?? 'realistic';
  const styleClause =
    style === 'watercolor'
      ? 'a watercolour architectural illustration'
      : style === 'vector'
        ? 'a clean flat vector diagram'
        : 'a photorealistic architectural visualisation';
  const strength = Math.min(Math.max(input.controlStrength, 0), 1);
  const geometry =
    strength >= 0.6
      ? 'Preserve the exact geometry, proportions, camera angle, and the existing materials, cladding and colours; improve only lighting, shadows, realism and atmosphere. Keep each surface’s material as in the original unless the description explicitly names a different one.'
      : 'Use the image as guidance for composition, but you may reinterpret details.';
  return `Turn this into ${styleClause}: ${input.prompt.replace(/[.\s]+$/, '')}. ${geometry}`;
}

async function buildEditBody(
  instruction: string,
  image: ImageInput,
  mask?: ImageInput,
  materials: MaterialRef[] = [],
): Promise<Record<string, unknown>> {
  const parts: Record<string, unknown>[] = [
    { text: instruction },
    { inline_data: { mime_type: mimeOf(image), data: await toBase64(image) } },
  ];
  if (mask) {
    parts.push({ inline_data: { mime_type: mimeOf(mask), data: await toBase64(mask) } });
  }

  /*
   * Material swatches ride along as extra reference images. Each is introduced by
   * a text part naming it, then its bytes, so the model can tie the name in the
   * instruction to the pixels it should sample the material from.
   */
  for (const material of materials) {
    const label = material.label.trim();
    if (!label) continue;
    parts.push({ text: `Material reference — "${label}":` });
    parts.push({
      inline_data: { mime_type: mimeOf(material.image), data: await toBase64(material.image) },
    });
  }

  return {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: CONFIG.responseModalities },
  };
}
