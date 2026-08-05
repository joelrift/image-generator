# RIFT Render Studio

Turns a sketch or an Archicad 3D screenshot into a photorealistic render **with the
building's geometry preserved**, then (from Phase 3) lets you paint a region of
the finished render to change or add elements.

The full specification lives in [`VISOID_CLONE_BRIEF.md`](./VISOID_CLONE_BRIEF.md).
This README covers what is built, how to run it, and where the seams are.

**Status: Phase 1 complete, Phase 3 UI complete.** The whole app is clickable with
no API keys — every AI call is served by `MockProvider`, which returns
placeholders that print the exact parameters that reached the provider. That
includes the region editor: you can paint a mask and run both edit branches
end to end today.

## Quickstart

```bash
npm install
npm run dev          # http://localhost:3000
```

No `.env.local` is needed to start. The app detects that no keys are present,
runs in Mock mode, and says so in a banner.

To go live later (brief §6):

```bash
cp .env.example .env.local
# paste FAL_KEY, set RENDER_PROVIDER=fal, restart
```

Nothing else changes — no rebuild, no code edits.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build (runs the TypeScript check) |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

## Architecture

Every AI call goes through `RenderProvider` (`lib/providers/types.ts`). Route
handlers never touch fal, Replicate, or ComfyUI directly — they call
`getProvider()` and depend only on the interface. Swapping backends is one env
var; adding one is a new file in `lib/providers/` plus a branch in `index.ts`.

```
app/
  page.tsx                  server component — reads the active provider from env
  icon.svg                  favicon
  api/
    generate/route.ts       POST → provider.generate    (ControlNet-conditioned)
    inpaint/route.ts        POST → provider.inpaint     ("change this")
    add-element/route.ts    POST → provider.addElement  ("add something")
    upscale/route.ts        POST → provider.upscale
    enrich-prompt/route.ts  POST → prompt expansion
components/
  Studio.tsx                holds the state the panels share
  UploadPanel.tsx           click / drag-drop / paste, input-type toggle
  StyleControls.tsx         style preset, structure method, strength slider, format
  ResultsGrid.tsx           session gallery, variation selection, edit entry point
  MaskEditor.tsx            brush → mask PNG, change/add modes
  PromptBar.tsx             prompt + Generate (⌘/Ctrl+Enter)
lib/
  providers/{types,index,mock,fal,replicate,comfyui}.ts
  preprocess.ts             input type → controlType, default strengths
  mask.ts                   stroke geometry, mask export, image field encoding
  studio.ts                 aspect ratios and run types shared by the panels
  validate.ts               upload limits and field validation
  api.ts                    one error funnel for all routes
```

### Region editor

Select a variation in the gallery, then **Edit region**. Mark an area, then pick a
branch: *Change this* (mask-based inpaint) or *Add something* (localized
insertion, where a selection is optional because the model can place from language
alone).

Selection is **geometric by default**, because architectural subjects are
polygonal — a facade plane, a window reveal, a roof pitch:

- **Polygon** — click each corner, drag a corner to adjust it, close by clicking
  the first corner, double-clicking, or pressing Enter. Backspace drops the last
  corner. The shape only counts once closed.
- **Rectangle** — drag a box. Windows, doors, signs, a parked car.
- **Brush** — freehand, for organic edges: planting, sky, water.

Each shape is **Add** or **Subtract**, so you can select a whole facade and then
cut the windows back out of it. Undo steps back one corner while drafting, one
shape otherwise. Escape cancels an in-progress shape first and only then closes
the dialog.

Three details that are load-bearing:

- **All geometry is stored normalised** (0..1, brush radius as a fraction of
  width). One region list renders to the on-screen overlay, to a full-resolution
  export mask, and again after a resize — without ever rescaling stored geometry.
- **The image is never drawn into the overlay canvas.** It carries selection
  graphics only, and the export mask renders separately at natural resolution — so
  the canvas can't be tainted no matter where the render came from, the exported
  PNG stays strictly two-tone (white = edit, black = keep), and handles and
  dashed guides never leak into the mask.
- **Results are appended, never substituted.** An edit becomes a new run in the
  gallery, so it can itself be edited and nothing the user liked is lost.

Provider images are forwarded as URLs when they are remote (no re-upload, no CORS
problem) and rasterised to PNG when they are data URIs — which is also how mock's
SVG placeholders round-trip without punching a hole in the SVG rejection.

### Mock mode

`MockProvider` renders an SVG showing the control type, strength, style, variant
number and dimensions that arrived. If a control is wired to the wrong field, the
placeholder says so — which is why the placeholders carry data instead of being
grey boxes.

### Uploads

12 MB cap, PNG/JPEG/WebP only, enforced in `lib/validate.ts` and mirrored
client-side so bad files fail instantly. SVG is rejected deliberately: it is an
active document that can carry script, and nothing downstream needs it. Real
content sniffing belongs wherever bytes get persisted (Phase 5).

Keys are read server-side only. Nothing is exposed as `NEXT_PUBLIC_*`, and no
provider call is ever made from the browser.

## Phase status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Scaffold, UI, MockProvider | **Done** |
| 2 | `FalProvider.generate` — Flux + ControlNet | Interface + model constants scaffolded; methods throw a 501 naming the phase |
| 3 | `MaskEditor`, inpaint, add-element | **UI done** and working against Mock; needs a provider (Flux Fill / Nano Banana Pro) behind it |
| 4 | Style ref, pick-to-upscale, LLM enrichment | Selection state and the upscale route exist; `enrich-prompt` ships a rule-based stand-in |
| 5 | Blob storage, history, auth | Not started — session history is in memory and clears on refresh |

## Decisions worth knowing

Four places where the implementation departs from the brief's literal text, each
for a concrete reason:

1. **Providers are constructed lazily** (`getProvider()`), not into a module-level
   `const` as in brief §4. Next evaluates modules during `next build`, so eager
   construction would fail the build on a missing key — and at runtime it would
   take down pages that render nothing. A misconfigured env now fails only the
   request that needs it.
2. **`/` is `force-dynamic`.** Statically prerendering it baked the provider
   banner in at build time: setting `RENDER_PROVIDER=fal` and restarting still
   showed "Mock mode" while the API routes correctly used fal. Brief §6 promises
   restart-is-enough, so the page reads env per request.
3. **Two files not in brief §7** — `lib/studio.ts` (shared types; importing them
   from `Studio.tsx` creates a cycle that throws at prerender) and
   `lib/validate.ts` (shared upload limits; five handlers duplicating them is how
   one ends up missing a check).
4. **UI copy is English**, and so is the prompt text `enrich-prompt` composes —
   image models are trained predominantly on English captions, so the prompt sent
   to the provider stays English regardless of what the interface says.

ESLint is pinned to 9.x: the `eslint-plugin-react` bundled with
`eslint-config-next` 16 still uses the pre-10 rule context API and crashes on
ESLint 10.

## Verification

`npm run build`, `npm run lint` and `npm run typecheck` are clean.

Beyond that: request-level tests against a running server (all four provider ops,
the 501 path with `RENDER_PROVIDER=fal`, and validation rejections for missing
prompt/image/mask, unknown control type, out-of-range strength, non-image upload,
bad variant count, `scale=3`), plus two Playwright passes — generation (upload →
preset switching → generate → selection, no horizontal overflow at 390/768/1440)
and the region editor. The editor pass reads the overlay canvas back pixel by
pixel, so the geometry is checked rather than assumed: a polygon fills inside and
not outside, an open shape doesn't count as a selection, Subtract cuts a hole that
Undo restores, a dragged corner moves the geometry, and Enter commits a shape
(distinguished from a draft fill by alpha, since both are non-zero). Plus: mask
required for *Change this* but optional for *Add something*, the mask exported as
a PNG at the image's natural resolution, the source rasterised to PNG rather than
SVG, no `mask` field when nothing is selected, results appended rather than
replacing the original, and Escape cancelling a shape before closing the dialog.
No console errors in either pass.

There is no test suite in the repo yet. Worth adding with Phase 2, when there is
provider-mapping logic whose regressions would be silent — `lib/mask.ts` is
already written to be unit-testable without a browser beyond the canvas calls.

## Next step

Phase 2: implement `FalProvider.generate`. The region editor is already waiting on
`inpaint` and `addElement` in the same file, so once a provider is live all three
paths light up together. `lib/providers/fal.ts` has the model
constants, the intended request shape, and the ControlNet mapping documented in
place. **Verify the model IDs against fal.ai's catalogue first** — the brief is
explicit that they move fast, and the constants are overridable by env
(`FAL_MODEL_GENERATE` and friends) so a rename doesn't need a code change.
