import {
  ProviderNotImplementedError,
  type AddElementInput,
  type GenerateInput,
  type ImageResult,
  type InpaintInput,
  type ProviderName,
  type RenderProvider,
  type FinalizeInput,
  type UpscaleInput,
} from './types';

/**
 * Self-hosted ComfyUI (brief §3, §9) — only worth the fixed GPU cost at high
 * volume; hosted APIs win for burst office use (brief §10).
 *
 * Implementation note for whoever gets here: ComfyUI takes a whole workflow
 * graph, not a flat parameter set. The practical pattern is to export a
 * workflow JSON from the ComfyUI editor, keep it in the repo (e.g.
 * lib/providers/comfyui-workflows/), then patch the specific node inputs —
 * prompt text, ControlNet strength, image reference — before POSTing to
 * /prompt. Results arrive via /history/{prompt_id} or the websocket.
 *
 * That means COMFYUI_URL alone is not enough: the workflow files are part of
 * the contract, and a workflow edited in the UI must be re-exported here.
 */
export class ComfyUIProvider implements RenderProvider {
  readonly name: ProviderName = 'comfyui';

  private readonly baseUrl: string;

  constructor(baseUrl = process.env.COMFYUI_URL) {
    if (!baseUrl) {
      throw new Error('COMFYUI_URL is not set. Unset RENDER_PROVIDER to fall back to Mock mode.');
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async generate(_input: GenerateInput): Promise<ImageResult> {
    void this.baseUrl;
    throw new ProviderNotImplementedError(this.name, 'generate', 'a later phase');
  }

  async inpaint(_input: InpaintInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'inpaint', 'a later phase');
  }

  async addElement(_input: AddElementInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'addElement', 'a later phase');
  }

  async upscale(_input: UpscaleInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'upscale', 'a later phase');
  }

  async finalize(_input: FinalizeInput): Promise<ImageResult> {
    throw new ProviderNotImplementedError(this.name, 'finalize', 'a later phase');
  }
}
