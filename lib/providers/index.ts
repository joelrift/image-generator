import { BflProvider } from './bfl';
import { ComfyUIProvider } from './comfyui';
import { FalProvider } from './fal';
import { MockProvider } from './mock';
import { ReplicateProvider } from './replicate';
import type { ProviderName, RenderProvider } from './types';

export type { RenderProvider } from './types';

/**
 * Provider selection (brief §4).
 *
 * Deviation from the brief's snippet, on purpose: the brief selects into a
 * module-level `const`, which would construct a provider the moment this module
 * is imported. Next evaluates modules during `next build`, so a missing key
 * would fail the build — and at runtime it would take down the whole app,
 * including pages that never render anything. Constructing lazily on first use
 * keeps a misconfigured env contained to the request that needs it.
 */
let cached: RenderProvider | null = null;

export function getProvider(): RenderProvider {
  if (cached) return cached;
  cached = createProvider();
  return cached;
}

function createProvider(): RenderProvider {
  const explicit = process.env.RENDER_PROVIDER?.trim().toLowerCase();

  switch (explicit) {
    case 'fal':
      return new FalProvider();
    case 'bfl':
      return new BflProvider();
    case 'replicate':
      return new ReplicateProvider();
    case 'comfyui':
      return new ComfyUIProvider();
    case 'mock':
      return new MockProvider();
    case undefined:
    case '':
      break;
    default:
      throw new Error(
        `RENDER_PROVIDER="${explicit}" is not a known provider. ` +
          `Use one of: fal, bfl, replicate, comfyui, mock (or leave it unset).`,
      );
  }

  // Nothing pinned: infer from whichever key is present, else Mock so the app
  // is fully clickable with an empty .env.local (brief §6).
  if (process.env.BFL_API_KEY) return new BflProvider();
  if (process.env.FAL_KEY) return new FalProvider();
  return new MockProvider();
}

/**
 * Which backend a request would hit, without constructing it. Safe to call from
 * a server component to render the "Mock mode" banner — it never throws, so a
 * misconfigured env still renders the UI (with the banner telling the truth).
 */
export function resolveProviderName(): ProviderName {
  const explicit = process.env.RENDER_PROVIDER?.trim().toLowerCase();
  if (
    explicit === 'fal' ||
    explicit === 'bfl' ||
    explicit === 'replicate' ||
    explicit === 'comfyui' ||
    explicit === 'mock'
  ) {
    return explicit;
  }
  if (process.env.BFL_API_KEY) return 'bfl';
  return process.env.FAL_KEY ? 'fal' : 'mock';
}

/** Test seam: drop the cached instance so a changed env is picked up. */
export function resetProviderCache(): void {
  cached = null;
}
