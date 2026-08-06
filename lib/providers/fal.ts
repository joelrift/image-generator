import {
  ProviderNotImplementedError,
  type AddElementInput,
  type FinalizeInput,
  type GenerateInput,
  type ImageResult,
  type InpaintInput,
  type ProviderName,
  type RenderProvider,
  type UpscaleInput,
} from './types';

/**
 * fal.ai — the default backend once FAL_KEY is set (brief §3, §5).
 *
 * Phase 1 scaffolds the shape only; the methods throw until Phase 2 wires them.
 * The recommended model families are recorded below, but IDs move fast — verify
 * each against https://fal.ai/models before implementing (brief §5).
 *
 * Endpoint IDs are deliberately overridable by env so a model rename does not
 * require a code change.
 */
const MODELS = {
  /** Flux.1 [dev] + ControlNet union. Structure preservation lives here. */
  generate: process.env.FAL_MODEL_GENERATE ?? 'fal-ai/flux-general',
  /** Flux Fill — mask-based inpainting for "change this". */
  inpaint: process.env.FAL_MODEL_INPAINT ?? 'fal-ai/flux-lora-fill',
  /** Creative/clarity upscaler. */
  upscale: process.env.FAL_MODEL_UPSCALE ?? 'fal-ai/clarity-upscaler',
  /** Flux Redux — style reference, Phase 4. */
  styleRef: process.env.FAL_MODEL_STYLE_REF ?? 'fal-ai/flux/redux',
} as const;

export class FalProvider implements RenderProvider {
  readonly name: ProviderName = 'fal';

  private readonly apiKey: string;

  constructor(apiKey = process.env.FAL_KEY) {
    if (!apiKey) {
      throw new Error('FAL_KEY is not set. Unset RENDER_PROVIDER to fall back to Mock mode.');
    }
    this.apiKey = apiKey;
  }

  /**
   * Phase 2. Sketch → scribble/soft-edge ControlNet; screenshot → depth.
   * `controlStrength` maps to the ControlNet conditioning scale, which is what
   * produces Visoid's Sketch↔Volumetric behaviour.
   *
   * Shape of the call, for whoever picks this up:
   *   POST https://fal.run/${MODELS.generate}
   *   Authorization: Key ${this.apiKey}
   *   { prompt, image_url, controlnets: [{ path, conditioning_scale }],
   *     num_images, image_size }
   * Reference images must be uploaded to fal storage (or passed as data URIs)
   * before they can be referenced as image_url.
   */
  async generate(_input: GenerateInput): Promise<ImageResult> {
    void MODELS.generate;
    throw new ProviderNotImplementedError(this.name, 'generate', 'Phase 2');
  }

  /** Phase 3 — Flux Fill. */
  async inpaint(_input: InpaintInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'inpaint', 'Phase 3');
  }

  /**
   * Phase 3 — "add something". The brief routes this to Nano Banana Pro
   * (Gemini image) rather than fal; see lib/providers/gemini-notes in the README.
   * If fal exposes an equivalent by then, implement it here instead.
   */
  async addElement(_input: AddElementInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'addElement', 'Phase 3');
  }

  /** Phase 4 — pick-to-upscale, the only paid step in the happy path. */
  async upscale(_input: UpscaleInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'upscale', 'Phase 4');
  }

  async finalize(_input: FinalizeInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'finalize', 'a later phase');
  }
}
