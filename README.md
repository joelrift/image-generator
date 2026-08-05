# RIFT Render Studio

Turns a sketch or an Archicad 3D screenshot into a photorealistic render **with the
building's geometry preserved**, then (from Phase 3) lets you paint a region of
the finished render to change or add elements.

The full specification lives in [`VISOID_CLONE_BRIEF.md`](./VISOID_CLONE_BRIEF.md).
This README covers what is built, how to run it, and where the seams are.

**Status: Phase 1 complete.** The whole UI is clickable with no API keys — every
AI call is served by `MockProvider`, which returns placeholders that print the
exact parameters that reached the provider.

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
  ResultsGrid.tsx           session gallery, variation selection
  PromptBar.tsx             prompt + Generate (⌘/Ctrl+Enter)
lib/
  providers/{types,index,mock,fal,replicate,comfyui}.ts
  preprocess.ts             input type → controlType, default strengths
  studio.ts                 aspect ratios and run types shared by the panels
  validate.ts               upload limits and field validation
  api.ts                    one error funnel for all routes
```

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
| 3 | `MaskEditor`, inpaint, add-element | Routes and provider methods exist; the canvas component is not built |
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
   showed "Mock-modus" while the API routes correctly used fal. Brief §6 promises
   restart-is-enough, so the page reads env per request.
3. **Two files not in brief §7** — `lib/studio.ts` (shared types; importing them
   from `Studio.tsx` creates a cycle that throws at prerender) and
   `lib/validate.ts` (shared upload limits; five handlers duplicating them is how
   one ends up missing a check).
4. **UI copy is Norwegian**, matching the other RIFT Lab tools; code, comments and
   docs are English. Flagging it since the brief doesn't specify — the strings are
   inline in `components/` if English is wanted instead.

ESLint is pinned to 9.x: the `eslint-plugin-react` bundled with
`eslint-config-next` 16 still uses the pre-10 rule context API and crashes on
ESLint 10.

## Verification

Phase 1 was checked with `npm run build`, `npm run lint`, `npm run typecheck`,
plus request-level tests against a running server (all four provider ops, the
501 path with `RENDER_PROVIDER=fal`, and validation rejections for missing
prompt/image, unknown control type, out-of-range strength, non-image upload, bad
variant count, `scale=3`) and a Playwright pass covering upload → preset
switching → generate → selection, with no console errors and no horizontal
overflow at 390/768/1440 px.

There is no test suite in the repo yet. Worth adding with Phase 2, when there is
provider-mapping logic whose regressions would be silent.

## Next step

Phase 2: implement `FalProvider.generate`. `lib/providers/fal.ts` has the model
constants, the intended request shape, and the ControlNet mapping documented in
place. **Verify the model IDs against fal.ai's catalogue first** — the brief is
explicit that they move fast, and the constants are overridable by env
(`FAL_MODEL_GENERATE` and friends) so a rename doesn't need a code change.
