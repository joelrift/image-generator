/**
 * The provider contract. Every AI call in the app goes through this interface,
 * so route handlers never know which backend is in play. Adding a backend means
 * adding one file in this directory and one branch in ./index.ts — nothing else
 * in the app changes.
 *
 * Defined in VISOID_CLONE_BRIEF.md §4.
 */

/** Structure-preservation mode handed to ControlNet. */
export type ControlType = 'depth' | 'softedge' | 'scribble' | 'canny';

/** Style presets offered in the UI. */
export type StylePreset = 'realistic' | 'watercolor' | 'vector';

/** What the user uploaded. Determines the default ControlType. */
export type InputType = 'sketch' | 'screenshot';

/** An image on its way to a provider: raw bytes, a URL, or a data URI. */
export type ImageInput = Buffer | string;

/** A named material swatch used as a reference by providers that accept images. */
export interface MaterialRef {
  label: string;
  image: ImageInput;
}

export interface GenerateInput {
  image: ImageInput; // sketch or 3D screenshot
  prompt: string;
  controlType: ControlType;
  controlStrength: number; // 0..1 (the "how strictly to follow the input" slider)
  style?: StylePreset;
  styleRefImage?: ImageInput; // optional (Redux / IP-Adapter), Phase 4
  /** Material palette — names always reach the prompt; images used by multi-image providers. */
  materials?: MaterialRef[];
  numImages?: number;
  width?: number;
  height?: number;
}

/**
 * The "change this" branch of the region editor. The mask is optional: with one,
 * the change is bounded to that region (Fill); without one, it is applied from
 * the instruction over the whole image (Kontext), which follows a surface-wide
 * material change better than a masked patch.
 */
export interface InpaintInput {
  image: ImageInput;
  mask?: ImageInput;
  prompt: string;
}

/**
 * Prompt-based localized insertion — the "add something" branch. The mask is
 * optional because Nano Banana Pro can place an element from language alone.
 */
export interface AddElementInput {
  image: ImageInput;
  mask?: ImageInput;
  prompt: string;
}

export interface UpscaleInput {
  image: ImageInput;
  scale: 2 | 4;
}

/**
 * A whole-image finishing pass over a composed render — the last pipeline stage.
 * `prompt` is the complete instruction (composed by the route), so a provider
 * just re-renders image + instruction with no mask.
 */
export interface FinalizeInput {
  image: ImageInput;
  prompt: string;
  /** Material swatches applied at the finishing pass by multi-image providers. */
  materials?: MaterialRef[];
}

export interface ImageResult {
  /** URLs or data URIs, one per generated variation. */
  images: string[];
  meta?: Record<string, unknown>;
}

export interface RenderProvider {
  /** Human-readable backend name. Surfaced in the UI so Mock mode is obvious. */
  readonly name: ProviderName;

  /** ControlNet-conditioned generation. */
  generate(input: GenerateInput): Promise<ImageResult>;

  /** Mask-based edit ("change this"). */
  inpaint(input: InpaintInput): Promise<ImageResult>;

  /** Prompt-based localized add ("add something"). */
  addElement(input: AddElementInput): Promise<ImageResult>;

  upscale(input: UpscaleInput): Promise<ImageResult>;

  /** Whole-image photoreal finishing pass — the last stage of the pipeline. */
  finalize(input: FinalizeInput): Promise<ImageResult>;
}

export type ProviderName = 'mock' | 'fal' | 'bfl' | 'gemini' | 'replicate' | 'comfyui';

/**
 * Thrown by provider methods that are scaffolded but not yet wired to a real
 * backend. Route handlers translate this into a 501 with the message intact, so
 * the UI can say which phase implements the missing piece.
 */
export class ProviderNotImplementedError extends Error {
  constructor(provider: ProviderName, method: string, phase: string) {
    super(
      `${provider}.${method}() is not implemented yet — see ${phase} in VISOID_CLONE_BRIEF.md §8. ` +
        `Unset RENDER_PROVIDER and the provider keys to fall back to Mock mode.`,
    );
    this.name = 'ProviderNotImplementedError';
  }
}

/**
 * An upstream provider refused or failed the request.
 *
 * Distinct from an unexpected crash: the message is written to be shown to the
 * user, because for a single-operator internal tool "the provider rejected this
 * prompt" is far more useful than a generic failure. Route handlers translate it
 * to `status` verbatim.
 */
export class ProviderRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Detail for the server log only — may contain request internals. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}
