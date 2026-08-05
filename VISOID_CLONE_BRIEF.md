# Build Brief — AI Architectural Render Tool (Visoid-style)

**Purpose of this document:** A self-contained specification to hand to Claude Code. Drop it in the repo root, open Claude Code, and say: _"Read VISOID_CLONE_BRIEF.md and scaffold Phase 1."_ It contains every decision made during planning so no context is lost.

## 1. What we're building

A web app for architects that turns a sketch or 3D-model screenshot into a photorealistic render while **preserving the building's geometry**, then lets the user select areas of the finished render to change or add elements. It mirrors what Visoid does, but with a **pluggable AI backend** so we can swap between hosted APIs (fal.ai, Replicate) and a self-hosted ComfyUI later.

**Target user:** architecture office (Rift Arkitektur), primarily using Archicad. Concept-stage visualization and client communication, not deterministic production rendering.

## 2. Core features

### MVP

1. Upload a sketch (hand-drawn) or a 3D screenshot (Archicad export).
2. Enter a text prompt + pick a style preset (realistic / watercolor / vector).
3. Structure preservation via ControlNet — depth for 3D screenshots, soft-edge/scribble for sketches — with a "how strictly to follow the input" strength slider (this is Visoid's Sketch vs Volumetric behavior).
4. Generate several low-res preview variations (~1K) cheaply.
5. Pick a favorite → upscale to 2K/4K (only pay for the keeper).
6. Render history/gallery for the session.

### Differentiator — region editing (high priority)

7. Mask/brush tool on the finished render (HTML canvas). User paints an area, then chooses:
   - **"Change this"** → mask-based inpainting (Flux Fill). Good for swapping a facade material, removing a car, changing a window.
   - **"Add something"** → natural-language element insertion (Nano Banana Pro / Gemini image). Good for "add a pergola here," "put people on the terrace" — matches perspective and lighting.

### Later

8. Style-reference input (drop a mood image, render inherits palette/atmosphere) — Flux Redux or IP-Adapter.
9. Prompt enrichment: an LLM expands the user's short prompt into a full architectural render prompt (materials, lighting, lens, time of day).
10. Accounts, credits/billing, saved projects.

## 3. Tech stack

- **Framework:** Next.js (App Router) + TypeScript
- **Styling:** Tailwind CSS
- **Canvas / mask tool:** react-konva or plain `<canvas>` for brush → export mask PNG
- **Backend:** Next.js route handlers (`app/api/.../route.ts`)
- **Image storage:** start local/in-memory; move to Vercel Blob or S3-compatible bucket
- **DB** (when history/accounts needed): Postgres via Supabase or Neon
- **Deploy:** Vercel
- **AI backend:** provider-abstraction layer (see §4), default fal.ai

## 4. Provider-abstraction layer (the key architectural decision)

All AI calls go through one interface so the backend is provider-agnostic. **Never call fal/Replicate/ComfyUI directly from routes** — always through a provider instance selected by env var.

```ts
// lib/providers/types.ts
export interface RenderProvider {
  generate(input: GenerateInput): Promise<ImageResult>;   // ControlNet-conditioned generation
  inpaint(input: InpaintInput): Promise<ImageResult>;      // mask-based edit ("change this")
  addElement(input: AddElementInput): Promise<ImageResult>;// prompt-based localized add ("add something")
  upscale(input: UpscaleInput): Promise<ImageResult>;
}

export interface GenerateInput {
  image: Buffer | string;          // sketch or 3D screenshot
  prompt: string;
  controlType: 'depth' | 'softedge' | 'scribble' | 'canny';
  controlStrength: number;         // 0..1  (the slider)
  style?: 'realistic' | 'watercolor' | 'vector';
  styleRefImage?: Buffer | string; // optional (Redux/IP-Adapter)
  numImages?: number;
  width?: number; height?: number;
}

export interface InpaintInput { image: Buffer|string; mask: Buffer|string; prompt: string; }
export interface AddElementInput { image: Buffer|string; mask?: Buffer|string; prompt: string; }
export interface UpscaleInput { image: Buffer|string; scale: 2 | 4; }
export interface ImageResult { images: string[]; /* urls or base64 */ meta?: Record<string,unknown>; }
```

Implementations: `FalProvider`, `ReplicateProvider`, `ComfyUIProvider`, plus a `MockProvider` that returns placeholder images so the whole UI is testable before any API key exists.

```ts
// lib/providers/index.ts — select by env
const provider =
  process.env.RENDER_PROVIDER === 'replicate' ? new ReplicateProvider() :
  process.env.RENDER_PROVIDER === 'comfyui'   ? new ComfyUIProvider() :
  process.env.FAL_KEY                          ? new FalProvider() :
                                                 new MockProvider();
```

## 5. Model choices (recommended, closest to Visoid)

**Verify exact current model IDs on the provider's model catalog at build time — these move fast.**

| Job | Recommended | fal.ai model family (verify ID) |
| --- | --- | --- |
| Base generation | Flux.1 [dev] (better realism than SDXL) | `fal-ai/flux-control-lora-*` / `fal-ai/flux-general` with ControlNet |
| Structure control | ControlNet: depth (3D screenshots), soft-edge/scribble (sketches) | ControlNet union / preprocessors |
| Region edit ("change") | Flux Fill (inpainting) | `fal-ai/flux-*-fill` |
| Add element ("add") | Nano Banana Pro (Gemini image) | Google Gemini image API, or via fal if exposed |
| Style reference | Flux Redux (or IP-Adapter on SDXL) | `fal-ai/flux/redux` |
| Upscale | Creative/clarity upscaler | `fal-ai/*-upscaler` |
| Prompt enrichment | Claude or GPT (text) | Anthropic / OpenAI API |

**Cheaper fallback for high volume:** SDXL + ControlNet (~$0.002/image vs Flux ~$0.01–0.02). Keep both selectable.

**Preprocessor mapping:** sketch → scribble/soft-edge; 3D screenshot → depth (+ optional canny). Auto-pick from an "input type" toggle in the UI, overridable.

**Cost strategy baked into UX:** generate previews cheap at ~1K, only run the paid 2K/4K upscale on the image the user selects.

## 6. API keys — added later, no rebuild needed

Keys are all read from env; the app runs in Mock mode until they're present, so you can build and click through the whole thing now and flip it live later.

```bash
# .env.local  (fill when ready)
RENDER_PROVIDER=fal          # fal | replicate | comfyui
FAL_KEY=
REPLICATE_API_TOKEN=
GEMINI_API_KEY=              # for Nano Banana Pro / add-element
ANTHROPIC_API_KEY=           # or OPENAI_API_KEY, for prompt enrichment
COMFYUI_URL=                 # if/when self-hosting (e.g. a RunPod endpoint)
```

**Getting keys later:** fal.ai → dashboard → API keys; Replicate → account → API tokens; Gemini → Google AI Studio. Paste into `.env.local`, set `RENDER_PROVIDER`, restart. Done.

## 7. Suggested file structure

```
app/
  page.tsx                     # main studio UI
  api/
    generate/route.ts          # POST -> provider.generate
    inpaint/route.ts           # POST -> provider.inpaint
    add-element/route.ts       # POST -> provider.addElement
    upscale/route.ts           # POST -> provider.upscale
    enrich-prompt/route.ts     # POST -> LLM prompt expansion
components/
  UploadPanel.tsx
  PromptBar.tsx
  StyleControls.tsx            # style preset + control-strength slider
  ResultsGrid.tsx              # variations, pick-to-upscale
  MaskEditor.tsx               # canvas brush -> mask PNG, change/add modes
lib/
  providers/
    types.ts
    index.ts
    fal.ts
    replicate.ts
    comfyui.ts
    mock.ts
  preprocess.ts                # input-type -> controlType mapping
```

## 8. Build phases (hand to Claude Code one at a time)

- **Phase 1 — Scaffold + UI + MockProvider.** Next.js app, upload → prompt → style/slider → results grid, all wired to Mock so it's clickable with zero keys.
- **Phase 2 — fal.ai generation.** Implement `FalProvider.generate` with Flux + ControlNet (depth/soft-edge) and the strength slider. Add preprocessor mapping.
- **Phase 3 — Region editor.** `MaskEditor` canvas brush; wire "change this" → `inpaint` (Flux Fill) and "add something" → `addElement` (Nano Banana Pro).
- **Phase 4 — Style ref, upscale, prompt enrichment.** Redux style input; pick-to-upscale to 2K/4K; LLM prompt expansion.
- **Phase 5 — Persistence & accounts.** Blob storage, project history, then auth + credits if going multi-user.

## 9. Open decisions (defaults chosen; change if you like)

- **Default provider:** fal.ai (easiest, per-image billing). ComfyUI on RunPod later if volume justifies fixed GPU cost.
- **DB:** deferred until Phase 5.
- **Auth/billing:** deferred; single-user internal tool first.
- **Deploy target:** Vercel.

## 10. Cost reference (from planning research, 2026)

Per ~1K image: SDXL+ControlNet ≈ $0.002 (~400/$1); Flux+ControlNet ≈ $0.01–0.02; Flux Pro ≈ $0.05. 4K upscale costs several× more (more pixels) — hence preview-cheap, upscale-the-keeper. For burst office use the API cost is negligible; self-hosted ComfyUI wins only at high volume.

## 11. How to start in Claude Code

1. Put this file in an empty repo root.
2. `claude` (or open the Claude Code IDE integration).
3. Prompt: _"Read VISOID_CLONE_BRIEF.md. Scaffold Phase 1: a Next.js + TypeScript + Tailwind app with the UI and MockProvider so I can click through it with no API keys. Follow the file structure and provider interface in the brief."_
4. Iterate phase by phase. Add keys to `.env.local` when ready and set `RENDER_PROVIDER=fal`.
