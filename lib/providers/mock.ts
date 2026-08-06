import type {
  AddElementInput,
  FinalizeInput,
  GenerateInput,
  ImageResult,
  InpaintInput,
  ProviderName,
  RenderProvider,
  UpscaleInput,
} from './types';

/**
 * MockProvider — returns generated SVG placeholders so the entire UI is
 * clickable before any API key exists (brief §4, §6).
 *
 * The placeholders are not decorative noise: each one renders the exact
 * parameters that reached the provider (control type, strength, style, seed,
 * dimensions). That makes it possible to verify the whole request path is
 * wired correctly just by looking at the results grid.
 */
export class MockProvider implements RenderProvider {
  readonly name: ProviderName = 'mock';

  async generate(input: GenerateInput): Promise<ImageResult> {
    const count = clampCount(input.numImages ?? 4);
    const width = input.width ?? 1024;
    const height = input.height ?? 576;

    await latency(700, 1400);

    const images = Array.from({ length: count }, (_, i) =>
      svgDataUri({
        width,
        height,
        seed: hash(`${input.prompt}:${input.controlType}:${i}`),
        heading: 'GENERATE',
        prompt: input.prompt,
        rows: [
          ['control', `${input.controlType} @ ${input.controlStrength.toFixed(2)}`],
          ['style', input.style ?? 'realistic'],
          ['variant', `${i + 1} / ${count}`],
          ['size', `${width}×${height}`],
          ...(input.styleRefImage ? ([['style ref', 'attached']] as [string, string][]) : []),
        ],
      }),
    );

    return {
      images,
      meta: {
        provider: this.name,
        controlType: input.controlType,
        controlStrength: input.controlStrength,
        style: input.style ?? 'realistic',
        numImages: count,
        width,
        height,
      },
    };
  }

  async inpaint(input: InpaintInput): Promise<ImageResult> {
    await latency(600, 1100);
    return {
      images: [
        svgDataUri({
          width: 1024,
          height: 576,
          seed: hash(`inpaint:${input.prompt}`),
          heading: 'INPAINT — CHANGE THIS',
          prompt: input.prompt,
          rows: [
            ['mode', input.mask ? 'masked (region-bounded)' : 'instruction (whole image)'],
            ['mask', input.mask ? 'received' : 'none'],
          ],
        }),
      ],
      meta: { provider: this.name, op: 'inpaint' },
    };
  }

  async addElement(input: AddElementInput): Promise<ImageResult> {
    await latency(600, 1100);
    return {
      images: [
        svgDataUri({
          width: 1024,
          height: 576,
          seed: hash(`add:${input.prompt}`),
          heading: 'ADD ELEMENT',
          prompt: input.prompt,
          rows: [
            ['mode', 'prompt-based insertion'],
            ['mask', input.mask ? 'received' : 'none (language only)'],
          ],
        }),
      ],
      meta: { provider: this.name, op: 'addElement' },
    };
  }

  async upscale(input: UpscaleInput): Promise<ImageResult> {
    await latency(900, 1600);
    const width = 1024 * input.scale;
    const height = 576 * input.scale;
    return {
      images: [
        svgDataUri({
          width,
          height,
          seed: hash(`upscale:${input.scale}`),
          heading: `UPSCALE ${input.scale}×`,
          prompt: `${width}×${height}`,
          rows: [['scale', `${input.scale}×`]],
        }),
      ],
      meta: { provider: this.name, op: 'upscale', width, height },
    };
  }

  async finalize(input: FinalizeInput): Promise<ImageResult> {
    await latency(800, 1500);
    return {
      images: [
        svgDataUri({
          width: 1024,
          height: 576,
          seed: hash(`finalize:${input.prompt}`),
          heading: 'FINALIZE',
          prompt: 'photoreal finishing pass',
          rows: [['mode', 'whole image, no mask']],
        }),
      ],
      meta: { provider: this.name, op: 'finalize' },
    };
  }
}

/* ------------------------------------------------------------------ helpers */

function clampCount(n: number): number {
  return Math.min(Math.max(Math.trunc(n) || 1, 1), 8);
}

/** Simulate provider round-trip so loading states are exercised in Mock mode. */
function latency(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Small deterministic string hash, so the same prompt yields the same image. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Deterministic pseudo-random sequence from a seed. */
function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return '(no prompt)';
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

interface PlaceholderOptions {
  width: number;
  height: number;
  seed: number;
  heading: string;
  prompt: string;
  rows?: [string, string][];
}

/**
 * Build a base64 data URI for an SVG that reads as a rough massing study:
 * a graded sky, a horizon, and a few extruded volumes derived from the seed.
 */
function svgDataUri(opts: PlaceholderOptions): string {
  const { width, height, seed, heading, prompt, rows = [] } = opts;
  const rand = rng(seed);

  /*
   * Draw in a viewBox whose long edge is 1024 and whose ratio matches the
   * requested size, then let the SVG scale to the real dimensions. Text stays
   * legible at 4K without recomputing the layout, and the placeholder actually
   * takes the shape the user asked for — a fixed 16:9 viewBox would letterbox
   * inside every other format and make the format selector look inert.
   */
  const landscape = width >= height;
  const vw = landscape ? 1024 : Math.round((1024 * width) / height);
  const vh = landscape ? Math.round((1024 * height) / width) : 1024;
  const horizon = vh * 0.68;

  const hue = 24 + rand() * 16; // warm bronze family
  const volumes: string[] = [];
  const count = 3 + Math.floor(rand() * 3);
  let x = vw * 0.12;

  for (let i = 0; i < count; i++) {
    const w = vw * (0.08 + rand() * 0.12);
    const h = vh * (0.14 + rand() * 0.34);
    const shade = 62 + Math.floor(rand() * 22);
    volumes.push(
      `<rect x="${x.toFixed(1)}" y="${(horizon - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
        `fill="hsl(${hue.toFixed(0)} 12% ${shade}%)" />`,
    );
    // Roof line, to read as a building rather than a bar chart.
    volumes.push(
      `<line x1="${x.toFixed(1)}" y1="${(horizon - h).toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${(horizon - h).toFixed(1)}" ` +
        `stroke="hsl(${hue.toFixed(0)} 30% 34%)" stroke-width="1.5" />`,
    );
    x += w + vw * 0.015;
    if (x > vw * 0.86) break;
  }

  const meta = rows
    .map(
      ([key, value], i) =>
        `<text x="34" y="${horizon + 66 + i * 21}" font-family="monospace" font-size="14" fill="#6f6a62">` +
        `${escapeXml(key)}  <tspan fill="#1c1a17">${escapeXml(truncate(value, 48))}</tspan></text>`,
    )
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${vw} ${vh}" role="img">` +
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue.toFixed(0)} 28% 92%)"/>` +
    `<stop offset="100%" stop-color="hsl(${hue.toFixed(0)} 18% 82%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="${vw}" height="${vh}" fill="#faf9f7"/>` +
    `<rect width="${vw}" height="${horizon}" fill="url(#sky)"/>` +
    volumes.join('') +
    `<rect y="${horizon}" width="${vw}" height="${vh - horizon}" fill="#efece6"/>` +
    `<line x1="0" y1="${horizon}" x2="${vw}" y2="${horizon}" stroke="#d8d2c8" stroke-width="1.5"/>` +
    `<text x="34" y="52" font-family="monospace" font-size="15" letter-spacing="2" fill="#a3690f">` +
    `MOCK · ${escapeXml(heading)}</text>` +
    `<text x="34" y="${horizon + 38}" font-family="sans-serif" font-size="19" fill="#1c1a17">` +
    `${escapeXml(truncate(prompt, 62))}</text>` +
    meta +
    `<rect x="0.75" y="0.75" width="${vw - 1.5}" height="${vh - 1.5}" fill="none" stroke="#e5e0d8" stroke-width="1.5"/>` +
    `</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
