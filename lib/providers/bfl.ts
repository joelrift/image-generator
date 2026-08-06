import {
  ProviderNotImplementedError,
  ProviderRequestError,
  type AddElementInput,
  type ControlType,
  type GenerateInput,
  type ImageInput,
  type ImageResult,
  type InpaintInput,
  type ProviderName,
  type RenderProvider,
  type UpscaleInput,
} from './types';

/**
 * Black Forest Labs — first-party FLUX.
 *
 * ⚠️ WRITTEN WITHOUT ACCESS TO THE LIVE API OR ITS DOCS. The endpoint paths and
 * request field names below come from prior knowledge of the BFL API, not from
 * docs.bfl.ai, and BFL has shipped model families since. Expect the first run to
 * need corrections. Everything likely to be wrong is either in CONFIG (and so
 * overridable by environment variable, no code change) or in the three
 * `build*Body` functions, which are the only places request fields are named.
 *
 * Check against the current docs, in this order of likelihood:
 *   1. endpoint paths in CONFIG.endpoints
 *   2. the field names in buildControlBody / buildFillBody / buildKontextBody
 *   3. the polling contract in `poll()` — status strings and result location
 *
 * Failures surface as ProviderRequestError with the upstream status and body
 * excerpt logged server-side, so a wrong field name shows up as a readable 422
 * rather than a silent empty result.
 */

/* ============================================================== config */

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const CONFIG = {
  /** Regional hosts exist (api.us1/eu1.bfl.ai); override if latency matters. */
  baseUrl: (process.env.BFL_BASE_URL ?? 'https://api.bfl.ai').replace(/\/$/, ''),

  /*
   * How generate() conditions on the source image.
   *
   *   'kontext' (default) — instruction editing: hand Kontext the screenshot and
   *     an instruction, and it re-renders while holding the composition. This is
   *     the working path: BFL retired the standalone depth/canny control
   *     endpoints (confirmed 404 against a live account, Aug 2026), so ControlNet
   *     conditioning is no longer reachable through the public API.
   *   'control' — the old ControlNet path, kept for an account or a future API
   *     version that exposes depth/canny again. Set BFL_GENERATE_MODE=control and
   *     point BFL_ENDPOINT_DEPTH / _CANNY at the live endpoints.
   */
  generateMode: (process.env.BFL_GENERATE_MODE ?? 'kontext') as 'kontext' | 'control',

  endpoints: {
    /** Instruction editing — generate (kontext mode), and add-element with no mask. */
    kontext: process.env.BFL_ENDPOINT_KONTEXT ?? 'v1/flux-kontext-pro',
    /** Mask-based inpainting — the "change this" branch, and masked add-element. */
    fill: process.env.BFL_ENDPOINT_FILL ?? 'v1/flux-pro-1.0-fill',
    /** ControlNet depth — only used in 'control' mode; not live on the public API. */
    depth: process.env.BFL_ENDPOINT_DEPTH ?? 'v1/flux-pro-1.0-depth',
    /** ControlNet canny — only used in 'control' mode; not live on the public API. */
    canny: process.env.BFL_ENDPOINT_CANNY ?? 'v1/flux-pro-1.0-canny',
  },

  /**
   * The controlStrength slider (0..1) maps onto BFL's `guidance`.
   *
   * This is the least certain mapping in the file. BFL's control endpoints do
   * not expose a ControlNet conditioning scale directly the way fal's
   * flux-general does; guidance is the nearest lever, where higher values track
   * the prompt and control image more tightly. The usable range differs per
   * endpoint, so both ends are tunable — tune them against real output before
   * trusting the slider's labels.
   */
  guidanceMin: envNumber(process.env.BFL_GUIDANCE_MIN, 2.5),
  guidanceMax: envNumber(process.env.BFL_GUIDANCE_MAX, 30),

  /**
   * Whether to send width/height. On by default so the UI's format selector
   * means something; if the API rejects the fields, set BFL_SEND_DIMENSIONS=0
   * and the control image's own aspect governs instead.
   */
  sendDimensions: process.env.BFL_SEND_DIMENSIONS !== '0',

  /** 0–6 in BFL's scheme, lower being stricter. */
  safetyTolerance: envNumber(process.env.BFL_SAFETY_TOLERANCE, 2),

  outputFormat: process.env.BFL_OUTPUT_FORMAT ?? 'png',

  pollIntervalMs: envNumber(process.env.BFL_POLL_INTERVAL_MS, 1200),
  pollTimeoutMs: envNumber(process.env.BFL_POLL_TIMEOUT_MS, 180_000),
  requestTimeoutMs: envNumber(process.env.BFL_REQUEST_TIMEOUT_MS, 30_000),
} as const;

const CHECK_HINT =
  'Verify the endpoint paths and request fields in lib/providers/bfl.ts against docs.bfl.ai — ' +
  'they were written without access to the live API.';

/* ============================================================= helpers */

/** Strip a data: URI prefix, fetch a URL, or encode raw bytes — always base64. */
async function toBase64(input: ImageInput): Promise<string> {
  if (Buffer.isBuffer(input)) return input.toString('base64');

  const dataUri = /^data:[^;,]+;base64,(.*)$/s.exec(input);
  if (dataUri) return dataUri[1];

  if (/^https?:\/\//.test(input)) {
    const response = await fetch(input, { signal: AbortSignal.timeout(CONFIG.requestTimeoutMs) });
    if (!response.ok) {
      throw new ProviderRequestError(
        502,
        'Could not fetch the source image to send to the provider.',
        `GET ${input} → ${response.status}`,
      );
    }
    return Buffer.from(await response.arrayBuffer()).toString('base64');
  }

  // A non-base64 data URI (percent-encoded SVG, say) should never reach here:
  // uploads are validated and the region editor rasterises before sending.
  throw new ProviderRequestError(400, 'Unsupported image input for this provider.');
}

async function readBodyExcerpt(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 600);
  } catch {
    return '(no body)';
  }
}

/* =========================================================== provider */

interface SubmitResult {
  id: string;
  pollingUrl: string;
}

export class BflProvider implements RenderProvider {
  readonly name: ProviderName = 'bfl';

  private readonly apiKey: string;

  constructor(apiKey = process.env.BFL_API_KEY) {
    if (!apiKey) {
      throw new Error(
        'BFL_API_KEY is not set. Unset RENDER_PROVIDER to fall back to Mock mode.',
      );
    }
    this.apiKey = apiKey;
  }

  /* ----------------------------------------------------------- transport */

  private headers(): Record<string, string> {
    // BFL authenticates with `x-key`, not a bearer token.
    return {
      'x-key': this.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async submit(endpoint: string, body: unknown): Promise<SubmitResult> {
    const url = `${CONFIG.baseUrl}/${endpoint.replace(/^\//, '')}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
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
      const excerpt = await readBodyExcerpt(response);
      const status = response.status;

      // 401/403 is a key problem; 422 is almost certainly a field-name problem,
      // which is the failure this file is most likely to produce.
      const message =
        status === 401 || status === 403
          ? 'The provider rejected the API key.'
          : status === 402
            ? 'The provider reports no credit remaining.'
            : status === 429
              ? 'The provider is rate-limiting; try again shortly.'
              : status === 422
                ? `The provider rejected the request as malformed. ${CHECK_HINT}`
                : `The provider returned ${status}. ${CHECK_HINT}`;

      throw new ProviderRequestError(502, message, `POST ${url} → ${status}: ${excerpt}`);
    }

    const payload = (await response.json()) as { id?: string; polling_url?: string };
    if (!payload?.id) {
      throw new ProviderRequestError(
        502,
        `The provider's response had no job id. ${CHECK_HINT}`,
        JSON.stringify(payload).slice(0, 600),
      );
    }

    return {
      id: payload.id,
      // Older responses omit polling_url; fall back to the documented endpoint.
      pollingUrl: payload.polling_url ?? `${CONFIG.baseUrl}/v1/get_result?id=${payload.id}`,
    };
  }

  /**
   * BFL is asynchronous: poll until the job reports Ready, then read the result.
   * Results are short-lived signed URLs, which is why `download` follows.
   */
  private async poll(job: SubmitResult): Promise<string> {
    const deadline = Date.now() + CONFIG.pollTimeoutMs;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, CONFIG.pollIntervalMs));

      const response = await fetch(job.pollingUrl, {
        headers: this.headers(),
        signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
        cache: 'no-store',
      });

      if (!response.ok) {
        // A transient 5xx while polling is worth riding out; anything else isn't.
        if (response.status >= 500) continue;
        throw new ProviderRequestError(
          502,
          `Polling the provider failed with ${response.status}. ${CHECK_HINT}`,
          `GET ${job.pollingUrl} → ${response.status}: ${await readBodyExcerpt(response)}`,
        );
      }

      const payload = (await response.json()) as {
        status?: string;
        result?: { sample?: string } | null;
        details?: unknown;
      };

      const status = payload.status ?? '';

      if (status === 'Ready') {
        const sample = payload.result?.sample;
        if (!sample) {
          throw new ProviderRequestError(
            502,
            `The provider reported success but returned no image. ${CHECK_HINT}`,
            JSON.stringify(payload).slice(0, 600),
          );
        }
        return sample;
      }

      if (status === 'Pending' || status === 'Queued' || status === 'Processing') continue;

      // Moderation is a user-actionable outcome, not a bug — say so plainly.
      if (status === 'Request Moderated' || status === 'Content Moderated') {
        throw new ProviderRequestError(
          422,
          'The provider blocked this request by its content policy. Try rephrasing the prompt.',
          JSON.stringify(payload).slice(0, 300),
        );
      }

      throw new ProviderRequestError(
        502,
        `The provider reported "${status || 'an unknown state'}". ${CHECK_HINT}`,
        JSON.stringify(payload).slice(0, 600),
      );
    }

    throw new ProviderRequestError(
      504,
      `The provider did not finish within ${Math.round(CONFIG.pollTimeoutMs / 1000)}s.`,
      `job ${job.id} timed out`,
    );
  }

  /**
   * Fetch the result and return it as a data URI.
   *
   * BFL's result URLs are signed and expire in minutes. Handing one to the
   * browser would give the user a gallery whose thumbnails 404 partway through a
   * session, and would break editing a render later (the region editor forwards
   * remote URLs to the provider on the assumption they stay fetchable). Until
   * Phase 5 adds blob storage, inlining the bytes is what keeps the session
   * coherent. It is also why this provider should not be run with large variation
   * counts at 4K — the payloads are held in memory.
   */
  private async download(url: string): Promise<string> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new ProviderRequestError(
        502,
        'The provider produced an image but it could not be retrieved (the signed link may have expired).',
        `GET result → ${response.status}`,
      );
    }

    const contentType = response.headers.get('content-type') ?? `image/${CONFIG.outputFormat}`;
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  }

  private async run(endpoint: string, body: unknown): Promise<string> {
    const job = await this.submit(endpoint, body);
    const sample = await this.poll(job);
    return this.download(sample);
  }

  /* ------------------------------------------------------------ mapping */

  /**
   * BFL ships depth and edge conditioning only. Soft-edge and scribble — the
   * sketch presets — have no equivalent, so they fall back to canny, which is
   * stricter than a freehand sketch really wants. Noted in `meta` so it is
   * visible rather than a silent substitution.
   */
  private controlEndpoint(controlType: ControlType): { endpoint: string; substituted: boolean } {
    if (controlType === 'depth') return { endpoint: CONFIG.endpoints.depth, substituted: false };
    if (controlType === 'canny') return { endpoint: CONFIG.endpoints.canny, substituted: false };
    return { endpoint: CONFIG.endpoints.canny, substituted: true };
  }

  private guidanceFor(strength: number): number {
    const clamped = Math.min(Math.max(strength, 0), 1);
    const value = CONFIG.guidanceMin + clamped * (CONFIG.guidanceMax - CONFIG.guidanceMin);
    return Math.round(value * 10) / 10;
  }

  /* ------------------------------------------------------------ methods */

  async generate(input: GenerateInput): Promise<ImageResult> {
    if (input.styleRefImage) {
      // Flux Redux / IP-Adapter is not exposed by the BFL API; Kontext or
      // multi-reference conditioning would be the route, and neither is wired.
      throw new ProviderNotImplementedError(this.name, 'generate (style reference)', 'Phase 4');
    }

    return CONFIG.generateMode === 'control'
      ? this.generateWithControl(input)
      : this.generateWithKontext(input);
  }

  /**
   * The working path: Kontext re-renders the source image from an instruction
   * while holding its composition — which is exactly "keep the geometry, change
   * the materials and light". Since Kontext preserves structure inherently,
   * there is no ControlNet conditioning scale; the strength slider instead
   * chooses how firmly the instruction tells Kontext to hold the geometry
   * (`geometryClause`), which is expressed in language rather than an unverified
   * numeric field.
   */
  private async generateWithKontext(input: GenerateInput): Promise<ImageResult> {
    const count = Math.min(Math.max(Math.trunc(input.numImages ?? 4) || 1, 1), 8);
    const image = await toBase64(input.image);
    const instruction = buildKontextInstruction(input);

    // One image per request, so variations are N parallel jobs with distinct
    // seeds. Seeds come back in meta so a keeper can be re-run to refine it.
    const seeds = Array.from({ length: count }, () => Math.floor(Math.random() * 2_147_483_647));

    const results = await Promise.allSettled(
      seeds.map((seed) =>
        this.run(CONFIG.endpoints.kontext, buildKontextBody({ prompt: instruction, image, seed })),
      ),
    );

    const images = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map((r) => r.value);

    // If every variation failed, surface the first real reason rather than an
    // empty gallery. A partial success returns what came back — paid jobs are
    // not thrown away because one sibling failed.
    if (images.length === 0) {
      const firstError = results.find((r) => r.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
      throw firstError?.reason instanceof Error
        ? firstError.reason
        : new ProviderRequestError(502, `The provider returned no images. ${CHECK_HINT}`);
    }

    return {
      images,
      meta: {
        provider: this.name,
        mode: 'kontext',
        endpoint: CONFIG.endpoints.kontext,
        instruction,
        requested: count,
        returned: images.length,
        style: input.style ?? 'realistic',
        controlStrength: input.controlStrength,
        seeds,
      },
    };
  }

  /**
   * The old ControlNet path. Unreachable on the current public API (depth/canny
   * are 404), kept behind BFL_GENERATE_MODE=control for an account or API version
   * that exposes them again.
   */
  private async generateWithControl(input: GenerateInput): Promise<ImageResult> {
    const count = Math.min(Math.max(Math.trunc(input.numImages ?? 4) || 1, 1), 8);
    const controlBase64 = await toBase64(input.image);
    const { endpoint, substituted } = this.controlEndpoint(input.controlType);
    const prompt = stylePrompt(input);

    const seeds = Array.from({ length: count }, () => Math.floor(Math.random() * 2_147_483_647));

    const results = await Promise.allSettled(
      seeds.map((seed) =>
        this.run(
          endpoint,
          buildControlBody({
            prompt,
            controlBase64,
            guidance: this.guidanceFor(input.controlStrength),
            seed,
            width: input.width,
            height: input.height,
          }),
        ),
      ),
    );

    const images = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (images.length === 0) {
      const firstError = results.find((r) => r.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
      throw firstError?.reason instanceof Error
        ? firstError.reason
        : new ProviderRequestError(502, `The provider returned no images. ${CHECK_HINT}`);
    }

    return {
      images,
      meta: {
        provider: this.name,
        mode: 'control',
        endpoint,
        requestedControlType: input.controlType,
        controlTypeSubstituted: substituted,
        substitutionNote: substituted
          ? `BFL has no ${input.controlType} conditioning; canny was used instead.`
          : undefined,
        guidance: this.guidanceFor(input.controlStrength),
        controlStrength: input.controlStrength,
        style: input.style ?? 'realistic',
        requested: count,
        returned: images.length,
        seeds,
      },
    };
  }

  async inpaint(input: InpaintInput): Promise<ImageResult> {
    return this.editRegion(input.image, input.mask, input.prompt, 'inpaint');
  }

  async addElement(input: AddElementInput): Promise<ImageResult> {
    return this.editRegion(input.image, input.mask, input.prompt, 'addElement');
  }

  /**
   * Both edit branches share one routing rule: a mask means the change is
   * spatially bounded, so Fill regenerates exactly that region; no mask means
   * the change is described in words, so Kontext edits the whole image from the
   * instruction. Kontext follows an instruction like "reclad the facade in white
   * timber" across a whole surface better than a masked Fill patch does, which is
   * why maskless editing routes there rather than being blocked.
   *
   * `inpaint` ("change this") and `addElement` ("add something") differ only in
   * the verb the user writes; the mechanics are identical, so they share this.
   *
   * Prompt upsampling is on for edits: BFL expands a terse instruction ("white
   * facade") into a fuller one, which is where edit adherence was weakest.
   */
  private async editRegion(
    image: ImageInput,
    maskInput: ImageInput | undefined,
    prompt: string,
    op: 'inpaint' | 'addElement',
  ): Promise<ImageResult> {
    const imageB64 = await toBase64(image);
    const seed = Math.floor(Math.random() * 2_147_483_647);

    if (maskInput) {
      const mask = await toBase64(maskInput);
      const result = await this.run(
        CONFIG.endpoints.fill,
        buildFillBody({ prompt, image: imageB64, mask, seed, promptUpsampling: true }),
      );
      return {
        images: [result],
        meta: {
          provider: this.name,
          endpoint: CONFIG.endpoints.fill,
          op,
          routedTo: 'fill',
          reason: 'a selection was provided, so the masked area is regenerated',
          seed,
        },
      };
    }

    const result = await this.run(
      CONFIG.endpoints.kontext,
      buildKontextBody({ prompt, image: imageB64, seed, promptUpsampling: true }),
    );
    return {
      images: [result],
      meta: {
        provider: this.name,
        endpoint: CONFIG.endpoints.kontext,
        op,
        routedTo: 'kontext',
        reason: 'no selection, so the change comes from the instruction over the whole image',
        seed,
      },
    };
  }

  /**
   * BFL has no upscaler endpoint. Two real options, neither of which should be
   * faked here: route upscaling to a provider that has one (fal's clarity
   * upscaler), or re-run the keeper seed-locked at a higher resolution, which
   * BFL supports natively and often beats an upscaler — but it is a different
   * operation than this method's contract (same pixels, more of them).
   */
  async upscale(_input: UpscaleInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'upscale', 'Phase 4');
  }
}

/* ==================================================== request bodies ==
 *
 * Every field name BFL sees is named in this section and nowhere else. If the
 * API rejects a request as malformed, the fix is here.
 */

function stylePrompt(input: GenerateInput): string {
  const style = input.style ?? 'realistic';
  if (style === 'realistic') return input.prompt;

  const clause =
    style === 'watercolor'
      ? 'watercolour illustration, soft washes, visible paper texture'
      : 'clean vector diagram, flat planes, limited palette';
  return `${input.prompt.replace(/[.\s]+$/, '')}, ${clause}`;
}

/**
 * Compose the edit instruction Kontext receives in generate() (kontext mode).
 *
 * Kontext reads an instruction, not a scene description, so this is phrased as
 * "turn this into … while keeping …". The strength slider selects how firmly the
 * geometry is to be held — expressed in words because Kontext exposes no
 * conditioning scale, and language is a field we know is accepted, unlike an
 * unverified numeric one.
 */
function buildKontextInstruction(input: GenerateInput): string {
  const style = input.style ?? 'realistic';
  const styleClause: Record<NonNullable<GenerateInput['style']>, string> = {
    realistic: 'a photorealistic architectural visualisation',
    watercolor: 'a watercolour architectural illustration with soft washes',
    vector: 'a clean flat vector diagram with a limited palette',
  };

  const strength = Math.min(Math.max(input.controlStrength, 0), 1);
  const geometryClause =
    strength >= 0.85
      ? 'Preserve the exact geometry, proportions, and camera angle of the original; change only materials, lighting, and atmosphere.'
      : strength >= 0.6
        ? 'Keep the overall geometry, massing, and composition; refine materials and lighting.'
        : strength >= 0.35
          ? 'Use the original as strong guidance for the composition, but you may adjust details.'
          : 'Loosely reinterpret the original; prioritise the description over exact structure.';

  const description = input.prompt.replace(/[.\s]+$/, '');

  return `Turn this into ${styleClause[style]}: ${description}. ${geometryClause}`;
}

function buildControlBody(args: {
  prompt: string;
  controlBase64: string;
  guidance: number;
  seed: number;
  width?: number;
  height?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: args.prompt,
    control_image: args.controlBase64,
    guidance: args.guidance,
    seed: args.seed,
    prompt_upsampling: false,
    safety_tolerance: CONFIG.safetyTolerance,
    output_format: CONFIG.outputFormat,
  };

  if (CONFIG.sendDimensions && args.width && args.height) {
    body.width = args.width;
    body.height = args.height;
  }

  return body;
}

function buildFillBody(args: {
  prompt: string;
  image: string;
  mask: string;
  seed: number;
  promptUpsampling?: boolean;
}): Record<string, unknown> {
  return {
    prompt: args.prompt,
    image: args.image,
    mask: args.mask,
    seed: args.seed,
    prompt_upsampling: args.promptUpsampling ?? false,
    safety_tolerance: CONFIG.safetyTolerance,
    output_format: CONFIG.outputFormat,
  };
}

function buildKontextBody(args: {
  prompt: string;
  image: string;
  seed: number;
  promptUpsampling?: boolean;
}): Record<string, unknown> {
  return {
    prompt: args.prompt,
    input_image: args.image,
    seed: args.seed,
    prompt_upsampling: args.promptUpsampling ?? false,
    safety_tolerance: CONFIG.safetyTolerance,
    output_format: CONFIG.outputFormat,
  };
}
