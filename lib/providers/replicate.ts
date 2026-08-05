import {
  ProviderNotImplementedError,
  type AddElementInput,
  type GenerateInput,
  type ImageResult,
  type InpaintInput,
  type ProviderName,
  type RenderProvider,
  type UpscaleInput,
} from './types';

/**
 * Replicate — the alternate hosted backend (brief §3).
 *
 * Worth keeping alive as a second option: it carries the cheap SDXL+ControlNet
 * path (~$0.002/image vs Flux at $0.01–0.02, brief §10) for high-volume runs,
 * and it is a useful escape hatch if a fal model is deprecated mid-project.
 *
 * Replicate's API is prediction-based: POST creates a prediction, then either
 * poll `GET /v1/predictions/{id}` or use `Prefer: wait` for short jobs.
 */
export class ReplicateProvider implements RenderProvider {
  readonly name: ProviderName = 'replicate';

  private readonly apiToken: string;

  constructor(apiToken = process.env.REPLICATE_API_TOKEN) {
    if (!apiToken) {
      throw new Error(
        'REPLICATE_API_TOKEN is not set. Unset RENDER_PROVIDER to fall back to Mock mode.',
      );
    }
    this.apiToken = apiToken;
  }

  async generate(_input: GenerateInput): Promise<ImageResult> {
    void this.apiToken;
    throw new ProviderNotImplementedError(this.name, 'generate', 'Phase 2');
  }

  async inpaint(_input: InpaintInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'inpaint', 'Phase 3');
  }

  async addElement(_input: AddElementInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'addElement', 'Phase 3');
  }

  async upscale(_input: UpscaleInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'upscale', 'Phase 4');
  }
}
