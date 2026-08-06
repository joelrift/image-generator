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
# paste BFL_API_KEY (or FAL_KEY), set RENDER_PROVIDER, restart
```

Nothing else changes — no rebuild, no code edits. See
[Black Forest Labs](#black-forest-labs-unverified) below before the first run
with a BFL key: that provider was written without access to the live API.

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

### Black Forest Labs (unverified)

`lib/providers/bfl.ts` implements the full contract — generate, inpaint,
add-element — against BFL's first-party FLUX API.

**Verified against a live account (Aug 2026):** the endpoint probe found
`flux-kontext-pro` and `flux-pro-1.0-fill` live, and the standalone `depth`/`canny`
ControlNet endpoints **retired (404)**. Two consequences:

- `generate()` uses **Kontext** by default (`BFL_GENERATE_MODE=kontext`): it hands
  the source image plus an instruction to Kontext, which re-renders while holding
  the composition — the same "keep the geometry, change materials and light" the
  ControlNet path aimed at, delivered more directly. The "Follow the source"
  slider selects how firmly the instruction tells Kontext to hold the geometry
  (in words, since Kontext exposes no conditioning scale). The structure-method
  pills (Depth/Canny/…) no longer pick an endpoint in this mode.
- The ControlNet path is preserved behind `BFL_GENERATE_MODE=control` for an
  account or API version that exposes depth/canny again.

Request field names were still written without live confirmation, so a first real
run can still surface a 422 — which appears in the UI as "the provider rejected
the request as malformed", with the upstream body excerpt in the server log
naming the field.

Everything likely to be wrong is either in the `CONFIG` block at the top of that
file — where each value has an environment-variable override, so a fix needs no
code change — or in the three `build*Body` functions, which are the only places
request fields are named. Check in this order:

1. endpoint paths (`BFL_ENDPOINT_DEPTH`, `_CANNY`, `_FILL`, `_KONTEXT`)
2. field names in `buildControlBody` / `buildFillBody` / `buildKontextBody`
3. the polling contract in `poll()` — status strings and where the result sits

A 422 surfaces in the UI as "the provider rejected the request as malformed",
with the upstream body excerpt in the server log — so a wrong field name reads as
a clear error rather than a silent empty result. If width/height are the problem,
`BFL_SEND_DIMENSIONS=0` drops them and the control image's aspect governs instead.

Three decisions worth knowing, each forced by how BFL differs from fal:

- **Results are inlined as data URIs, not passed through as links.** BFL returns
  signed URLs that expire in minutes; forwarding one would give the user a gallery
  whose thumbnails 404 mid-session, and would break editing a render later, since
  the region editor forwards remote URLs to the provider assuming they stay
  fetchable. This is an argument for pulling Phase 5's blob storage forward, and a
  reason not to run large variation counts at 4K on this provider — the payloads
  sit in memory.
- **`addElement` routes on whether a selection exists.** With a mask, Fill is used
  so the painted region is respected. Without one, Kontext places the element from
  the instruction. Kontext accepts no mask, so sending a selection to it would
  discard the user's work.
- **Partial failures don't sink the batch.** Variations run as `Promise.allSettled`,
  so if one of N jobs fails the successful (paid) ones are still returned; only an
  all-fail batch throws, surfacing the first real reason.
- **`upscale` throws.** BFL has no upscaler endpoint. Either route upscaling to a
  provider that has one, or re-run the keeper seed-locked at higher resolution —
  seeds are returned in `meta` for exactly that. Faking it here would be worse
  than the honest 501.

Verified as far as it can be without the API: a stub implementing the assumed
contract exercised request assembly, the poll loop, download-to-data-URI, the
canny substitution, add-element routing, and every error mapping (bad key, no
credit, 422, content moderation, success-with-no-image, response-with-no-job-id) —
28 checks. None of that validates BFL's real field names.

### Prompt helper

Above the prompt field, **Prompt helper** expands a chip grid — Lighting, Season,
Weather, Setting, People — so common descriptors are one click instead of retyped
each time (the pattern GoBANANAS uses). One choice per category; the selections
compose onto the free text and the exact string sent is shown under the field.
Chips alone are enough to generate — free text is optional.

Two categories from the GoBANANAS panel are deliberately absent: **Style** (already
the app's Style control) and **Camera angle** (the camera is fixed by the source
and held by "Follow the source", so offering a reframe would promise what the tool
won't do). The taxonomy and `composePrompt` live in `lib/prompt-tags.ts`, kept
pure so composition is unit-testable.

### Upscale

Select a result and use **Upscale 2× / 4×** in its caption. This is a client-side
high-quality resample (`lib/upscale.ts`) — it makes the image bigger, not more
detailed. No new texture is invented; a 4× of a ~1K preview is a clean, slightly
soft enlargement, which is enough for a screen presentation or a PDF but not for
a large print. The result lands as its own run (badged with its pixel size) and
every result carries a **Download** link, so the enlarged copy can be saved.

It runs in the browser rather than server-side on purpose: the image is already
there as a data URI, it needs no API or dependency, and a 4K encode never touches
a serverless function's timeout or memory. A true *creative* upscaler that adds
detail (BFL has none; fal's clarity upscaler does) would be the provider path —
`RenderProvider.upscale` is where it slots in, keyed behind a `FAL_KEY`.

### Region editor

Select a variation in the gallery, then **Edit region**, and pick a branch:
*Change this* or *Add something*. Both take an **optional** selection: with one,
the change is bounded to that region (routed to Fill); without one, it applies
from the instruction across the whole image (routed to Kontext). Maskless is the
better path for a surface-wide material change — Kontext follows "reclad the
facade in white timber" over a whole surface better than a masked patch does; a
selection is for localized work like swapping one window or removing a car.

When a selection *is* drawn, it is **geometric by default**, because
architectural subjects are polygonal — a facade plane, a window reveal, a roof
pitch:

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
| 2 | Real generation | **BFL implemented but unverified** (see above). fal still scaffolded — model constants in place, methods throw a 501 naming the phase |
| 3 | `MaskEditor`, inpaint, add-element | **UI done**; BFL implements both branches (unverified), fal does not |
| 4 | Style ref, pick-to-upscale, LLM enrichment | **Upscale done** (client resample, see below); style-ref and LLM enrichment pending (`enrich-prompt` ships a rule-based stand-in) |
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
(distinguished from a draft fill by alpha, since both are non-zero). Plus: a
prompt alone enables apply (maskless whole-image edit), the mask exported as a PNG
at the image's natural resolution, the source rasterised to PNG rather than SVG,
no `mask` field when nothing is selected, results appended rather than replacing
the original, and Escape cancelling a shape before closing the dialog. No console
errors in either pass.

The BFL provider is exercised against a local stub of its submit → poll →
download contract (30 checks): Kontext-mode generate, the strength→instruction
mapping, masked edits routing to Fill with prompt-upsampling on, maskless edits
routing to Kontext, and every error mapping. That verifies the client's side of
the contract, not BFL's real field names.

There is no test suite in the repo yet. Worth adding with Phase 2, when there is
provider-mapping logic whose regressions would be silent — `lib/mask.ts` is
already written to be unit-testable without a browser beyond the canvas calls.

## Next step

Run it with a real `BFL_API_KEY` and fix whatever the first request reveals. The
whole flow is implemented, so this is a correction pass against real API
responses, not new construction — and the failure modes are instrumented to say
which field or endpoint to look at. `lib/providers/fal.ts` has the model
constants, the intended request shape, and the ControlNet mapping documented in
place. **Verify the model IDs against fal.ai's catalogue first** — the brief is
explicit that they move fast, and the constants are overridable by env
(`FAL_MODEL_GENERATE` and friends) so a rename doesn't need a code change.
