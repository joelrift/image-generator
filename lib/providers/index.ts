import { BflProvider } from './bfl';
import { ComfyUIProvider } from './comfyui';
import { FalProvider } from './fal';
import { GeminiProvider } from './gemini';
import { MockProvider } from './mock';
import { ReplicateProvider } from './replicate';
import type { ProviderName, RenderProvider } from './types';

export type { RenderProvider } from './types';

/**
 * Which stage of the pipeline a request belongs to. Generate and edit can use
 * different backends — e.g. a geometry-locked base from BFL/fal, then edits
 * through Gemini (brief §2 item 7). Resolution order for each op:
 *
 *   RENDER_PROVIDER_<OP>   (per-op override, e.g. RENDER_PROVIDER_EDIT=gemini)
 *   RENDER_PROVIDER        (single provider for everything)
 *   inferred from whichever key is present, else Mock
 */
export type ProviderOp = 'generate' | 'edit' | 'finalize';

const cache = new Map<ProviderName, RenderProvider>();

function construct(name: ProviderName): RenderProvider {
  const existing = cache.get(name);
  if (existing) return existing;

  const created =
    name === 'fal'
      ? new FalProvider()
      : name === 'bfl'
        ? new BflProvider()
        : name === 'gemini'
          ? new GeminiProvider()
          : name === 'replicate'
            ? new ReplicateProvider()
            : name === 'comfyui'
              ? new ComfyUIProvider()
              : new MockProvider();

  cache.set(name, created);
  return created;
}

/** The provider for a given op (defaults to generate). Constructed lazily. */
export function getProvider(op: ProviderOp = 'generate'): RenderProvider {
  return construct(resolveProviderName(op));
}

/**
 * Provider for the generate step, with one dynamic override: when the request
 * carries material-swatch *images*, prefer Gemini if a key is present. Gemini is
 * the only generate backend that accepts multiple images, so the swatches can
 * condition the base render directly rather than only their names reaching the
 * prompt (BFL Kontext takes a single image). Without swatch images — or without
 * a Gemini key — the normal per-op routing applies.
 */
export function getGenerateProvider(hasMaterialImages = false): RenderProvider {
  if (hasMaterialImages && process.env.GEMINI_API_KEY && resolveProviderName('generate') !== 'gemini') {
    return construct('gemini');
  }
  return getProvider('generate');
}

const KNOWN: readonly ProviderName[] = ['fal', 'bfl', 'gemini', 'replicate', 'comfyui', 'mock'];

function parseName(value: string | undefined): ProviderName | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && (KNOWN as readonly string[]).includes(trimmed)
    ? (trimmed as ProviderName)
    : trimmed
      ? // A set-but-unknown value is a config error worth surfacing loudly.
        (() => {
          throw new Error(
            `Provider "${trimmed}" is not known. Use one of: ${KNOWN.join(', ')} (or leave it unset).`,
          );
        })()
      : null;
}

/**
 * Which backend a given op resolves to, without constructing it. Never throws on
 * a *missing* value (so the UI still renders) — only on an explicitly wrong one.
 */
export function resolveProviderName(op: ProviderOp = 'generate'): ProviderName {
  const perOpEnv =
    op === 'edit'
      ? process.env.RENDER_PROVIDER_EDIT
      : op === 'finalize'
        ? process.env.RENDER_PROVIDER_FINALIZE
        : process.env.RENDER_PROVIDER_GENERATE;
  const perOp = parseName(perOpEnv);
  if (perOp) return perOp;

  // Finalize is a photoreal finishing pass — prefer Gemini when a key exists,
  // since that is the stage it is for, before falling back to the shared choice.
  if (op === 'finalize' && process.env.GEMINI_API_KEY) return 'gemini';

  const shared = parseName(process.env.RENDER_PROVIDER);
  if (shared) return shared;

  // Inference, in priority order, else Mock so an empty .env.local still works.
  if (process.env.BFL_API_KEY) return 'bfl';
  if (process.env.FAL_KEY) return 'fal';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'mock';
}

/** Test seam: drop cached instances so a changed env is picked up. */
export function resetProviderCache(): void {
  cache.clear();
}
