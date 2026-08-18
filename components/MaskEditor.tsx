'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BRUSH_DEFAULT,
  BRUSH_MAX,
  BRUSH_MIN,
  HANDLE_HIT_PX,
  MIN_POINT_DISTANCE,
  TOOLS,
  TOOL_HINTS,
  TOOL_LABELS,
  distance,
  findHandle,
  hasMaskContent,
  imageFieldValue,
  regionsToMaskBlob,
  renderOverlay,
  type Point,
  type RectRegion,
  type Region,
  type ToolKind,
} from '@/lib/mask';
import {
  EDIT_OPS,
  EDIT_OP_HINTS,
  EDIT_OP_LABELS,
  EDIT_OP_PLACEHOLDERS,
  LOCK_GEOMETRY_CLAUSE,
  type EditOp,
} from '@/lib/studio';

export interface ApplyEditArgs {
  op: EditOp;
  prompt: string;
  image: Blob | string;
  mask: Blob | null;
}

interface MaskEditorProps {
  src: string;
  busy: boolean;
  error: string;
  onApply: (args: ApplyEditArgs) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

/**
 * Region editor (brief §2 item 7).
 *
 * Select an area of the finished render, then either change what is there
 * ("change this" → inpaint) or insert something new ("add something" →
 * addElement).
 *
 * Selection is geometric by default. Architectural subjects are polygonal — a
 * facade plane, a window reveal, a roof pitch — so corners are placed and
 * adjusted precisely rather than smeared over with a brush. The brush remains for
 * organic edges, and erase-mode regions let you cut a window back out of a facade
 * selection.
 *
 * The image itself is never drawn into the overlay canvas: it carries only
 * selection graphics, and the export mask is rendered separately at natural
 * resolution. That keeps the canvas untainted regardless of where the render came
 * from, and means the exported mask is exactly two-tone.
 */
export default function MaskEditor({
  src,
  busy,
  error,
  onApply,
  onCancel,
  onError,
}: MaskEditorProps) {
  const [op, setOp] = useState<EditOp>('inpaint');
  const [tool, setTool] = useState<ToolKind>('polygon');
  const [prompt, setPrompt] = useState('');
  const [brush, setBrush] = useState(BRUSH_DEFAULT);
  const [erasing, setErasing] = useState(false);
  // Preserve structure by default — geometry fidelity is the tool's whole point.
  const [lockGeometry, setLockGeometry] = useState(true);
  // Soften the mask boundary by default — a hard edge is what produced the
  // "white box" leak; crisp is one click away for a window or sign.
  const [softenEdges, setSoftenEdges] = useState(true);

  const [regions, setRegions] = useState<Region[]>([]);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [draftHover, setDraftHover] = useState<Point | null>(null);
  const [rectDraft, setRectDraft] = useState<RectRegion | null>(null);

  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [preparing, setPreparing] = useState(false);

  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const dragHandle = useRef<number | null>(null);
  const brushing = useRef(false);

  const mode = erasing ? 'erase' : 'paint';

  /** Grab radius in normalised units, from a fixed screen-space feel. */
  const handleThreshold = box.width > 0 ? HANDLE_HIT_PX / box.width : 0.02;

  // Keep the overlay canvas exactly on top of the rendered image box.
  useLayoutEffect(() => {
    const element = imageRef.current;
    if (!element) return;

    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [src, natural.width]);

  // Repaint whenever the selection or the box changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.width === 0 || box.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderOverlay(ctx, { regions, draft, draftHover, rectDraft, mode }, box.width, box.height);
  }, [box, regions, draft, draftHover, rectDraft, mode]);

  const commitDraft = useCallback(() => {
    setDraft((current) => {
      if (current && current.length >= 3) {
        setRegions((previous) => [...previous, { kind: 'polygon', mode, points: current }]);
      }
      return null;
    });
    setDraftHover(null);
  }, [mode]);

  // Focus the instruction field once, on open. This must not live in the
  // keyboard effect below: that one re-runs whenever the draft changes, which
  // would drag focus back into the textarea after every corner placed — and with
  // focus there, Enter would insert a newline instead of closing the shape.
  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  /** Escape cancels an in-progress shape first, and only then closes. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA)$/.test((event.target as HTMLElement | null)?.tagName ?? '');

      if (event.key === 'Escape') {
        if (draft) {
          setDraft(null);
          setDraftHover(null);
          return;
        }
        onCancel();
        return;
      }
      if (typing) return;

      if (event.key === 'Enter' && draft) {
        event.preventDefault();
        commitDraft();
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && draft) {
        event.preventDefault();
        setDraft((current) => {
          if (!current) return null;
          const next = current.slice(0, -1);
          return next.length > 0 ? next : null;
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commitDraft, draft, onCancel]);

  const pointFromEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'polygon') {
      if (draft) {
        // Grabbing an existing corner takes priority over adding a new one.
        const handle = findHandle(draft, point, handleThreshold);
        if (handle >= 0) {
          // Clicking the first corner closes the shape; any other corner moves.
          if (handle === 0 && draft.length >= 3) {
            commitDraft();
            return;
          }
          dragHandle.current = handle;
          return;
        }
        setDraft([...draft, point]);
        return;
      }
      setDraft([point]);
      return;
    }

    if (tool === 'rect') {
      setRectDraft({ kind: 'rect', mode, from: point, to: point });
      return;
    }

    brushing.current = true;
    setRegions((previous) => [
      ...previous,
      { kind: 'brush', mode, radius: brush, points: [point] },
    ]);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);

    if (tool === 'polygon') {
      if (dragHandle.current !== null) {
        const index = dragHandle.current;
        setDraft((current) =>
          current ? current.map((existing, i) => (i === index ? point : existing)) : current,
        );
        return;
      }
      if (draft) setDraftHover(point);
      return;
    }

    if (tool === 'rect') {
      setRectDraft((current) => (current ? { ...current, to: point } : current));
      return;
    }

    if (!brushing.current) return;
    setRegions((previous) => {
      const current = previous.at(-1);
      if (!current || current.kind !== 'brush') return previous;

      const last = current.points.at(-1);
      if (last && distance(last, point) < MIN_POINT_DISTANCE) return previous;

      return [...previous.slice(0, -1), { ...current, points: [...current.points, point] }];
    });
  };

  const handlePointerUp = () => {
    dragHandle.current = null;
    brushing.current = false;

    if (rectDraft) {
      const candidate = rectDraft;
      setRectDraft(null);
      // Ignore an accidental click that produced no area.
      if (
        Math.abs(candidate.to.x - candidate.from.x) >= 0.002 &&
        Math.abs(candidate.to.y - candidate.from.y) >= 0.002
      ) {
        setRegions((previous) => [...previous, candidate]);
      }
    }
  };

  const undo = () => {
    if (draft) {
      setDraft((current) => {
        const next = current?.slice(0, -1) ?? [];
        return next.length > 0 ? next : null;
      });
      return;
    }
    setRegions((previous) => previous.slice(0, -1));
  };

  const clearAll = () => {
    setRegions([]);
    setDraft(null);
    setDraftHover(null);
    setRectDraft(null);
  };

  const selected = useMemo(() => hasMaskContent(regions), [regions]);
  const nothingToUndo = !draft && regions.length === 0;
  // A selection is never required now: with one the change is region-bounded,
  // without one it applies from the instruction over the whole image. Only a
  // prompt is mandatory.
  const canApply = prompt.trim().length > 0 && !busy && !preparing;

  const handleApply = async () => {
    if (!canApply) return;

    setPreparing(true);
    try {
      // Feather scales with the image so the soft band is a consistent visual
      // width regardless of export resolution; only applied to a bounded edit.
      const featherPx =
        softenEdges && selected
          ? Math.round(Math.min(natural.width, natural.height) * 0.012)
          : 0;
      const [image, mask] = await Promise.all([
        imageFieldValue(src),
        selected
          ? regionsToMaskBlob(regions, natural.width, natural.height, { featherPx })
          : Promise.resolve(null),
      ]);
      const instruction = lockGeometry
        ? `${prompt.trim()} ${LOCK_GEOMETRY_CLAUSE}`
        : prompt.trim();
      onApply({ op, prompt: instruction, image, mask });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not prepare the mask for sending.');
    } finally {
      setPreparing(false);
    }
  };

  const working = busy || preparing;
  const regionCount = regions.filter((region) => region.mode === 'paint').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mask-editor-title"
    >
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded border border-line bg-surface">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-3">
          <h2 id="mask-editor-title" className="label tracking-[0.14em] text-ink">
            EDIT REGION
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="text-[13px] text-muted underline hover:text-ink disabled:opacity-50"
          >
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row">
          {/* Canvas */}
          <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-2 p-4">
            <div className="relative inline-block max-h-full leading-none">
              {/* eslint-disable-next-line @next/next/no-img-element -- provider data URI or remote URL */}
              <img
                ref={imageRef}
                src={src}
                alt="Render being edited"
                onLoad={(event) =>
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                className="block max-h-[58vh] w-auto max-w-full select-none"
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                // Focusable so the keyboard shortcuts below are reachable
                // without a pointer, and so clicking the canvas moves focus out
                // of the instruction field (where Enter belongs to the textarea).
                tabIndex={0}
                aria-label="Selection canvas. Click to place polygon corners; Enter closes the shape, Backspace removes the last corner."
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onDoubleClick={() => draft && commitDraft()}
                style={{
                  width: box.width || undefined,
                  height: box.height || undefined,
                  touchAction: 'none',
                  cursor: working ? 'progress' : 'crosshair',
                }}
                className="absolute left-0 top-0"
              />
            </div>
          </div>

          {/* Controls */}
          <aside className="flex w-full shrink-0 flex-col gap-5 border-line p-4 lg:w-[340px] lg:border-l">
            <section className="flex flex-col gap-2">
              <h3 className="label">Action</h3>
              <div className="flex flex-wrap gap-2">
                {EDIT_OPS.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className="pill"
                    data-active={op === candidate}
                    aria-pressed={op === candidate}
                    disabled={working}
                    onClick={() => setOp(candidate)}
                  >
                    {EDIT_OP_LABELS[candidate]}
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-muted">{EDIT_OP_HINTS[op]}</p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="label">Selection tool</h3>
              <div className="flex flex-wrap gap-2">
                {TOOLS.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className="pill"
                    data-active={tool === candidate}
                    aria-pressed={tool === candidate}
                    disabled={working}
                    title={TOOL_HINTS[candidate]}
                    onClick={() => {
                      if (draft) commitDraft();
                      setTool(candidate);
                    }}
                  >
                    {TOOL_LABELS[candidate]}
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-muted">{TOOL_HINTS[tool]}</p>
            </section>

            {tool === 'brush' && (
              <section className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="label" id="brush-label">
                    Brush size
                  </h3>
                  <span className="font-mono text-[12px] text-ink">
                    {Math.round(brush * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  className="slider"
                  min={BRUSH_MIN}
                  max={BRUSH_MAX}
                  step={0.005}
                  value={brush}
                  disabled={working}
                  aria-labelledby="brush-label"
                  onChange={(event) => setBrush(Number(event.target.value))}
                />
              </section>
            )}

            <section className="flex flex-col gap-2">
              <h3 className="label">Mode</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="pill"
                  data-active={!erasing}
                  aria-pressed={!erasing}
                  disabled={working}
                  onClick={() => setErasing(false)}
                >
                  Paint
                </button>
                <button
                  type="button"
                  className="pill"
                  data-active={erasing}
                  aria-pressed={erasing}
                  disabled={working}
                  onClick={() => setErasing(true)}
                >
                  Erase
                </button>
                <button
                  type="button"
                  className="pill"
                  disabled={working || nothingToUndo}
                  onClick={undo}
                >
                  Undo
                </button>
                <button
                  type="button"
                  className="pill"
                  disabled={working || (nothingToUndo && !rectDraft)}
                  onClick={clearAll}
                >
                  Clear
                </button>
              </div>
              <p className="text-[12px] text-muted">
                Erase cuts a shape back out — a window out of a facade selection, say.
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="label">Fidelity</h3>
              <label className="flex items-start gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={lockGeometry}
                  disabled={working}
                  onChange={(event) => setLockGeometry(event.target.checked)}
                />
                <span>
                  Lock geometry
                  <span className="block text-[12px] text-muted">
                    Holds structure, proportions and camera fixed — change surface and
                    material only.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={softenEdges}
                  disabled={working}
                  onChange={(event) => setSoftenEdges(event.target.checked)}
                />
                <span>
                  Soften mask edges
                  <span className="block text-[12px] text-muted">
                    Feathers the selection so the edit blends in. Turn off for a crisp
                    cut (a window, a sign).
                  </span>
                </span>
              </label>
            </section>

            <section className="flex flex-col gap-2">
              <label htmlFor="edit-prompt" className="label">
                Instruction
              </label>
              <textarea
                ref={promptRef}
                id="edit-prompt"
                rows={3}
                value={prompt}
                disabled={working}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={EDIT_OP_PLACEHOLDERS[op]}
                className="resize-y rounded border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
              />
            </section>

            {error && (
              <div
                role="alert"
                className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800"
              >
                {error}
              </div>
            )}

            <div className="mt-auto flex flex-col gap-2">
              <button
                type="button"
                onClick={handleApply}
                disabled={!canApply}
                className="btn-primary"
              >
                <span className="block">{working ? 'Working…' : EDIT_OP_LABELS[op]}</span>
                <span className="mt-0.5 block font-mono text-[11px] font-normal opacity-80">
                  {working
                    ? 'sending to provider'
                    : selected
                      ? `${regionCount} region${regionCount === 1 ? '' : 's'} · ${natural.width}×${natural.height}`
                      : 'whole image'}
                </span>
              </button>
              <p className="text-[12px] text-muted">
                {draft
                  ? 'Close the shape to include it — click the first corner, double-click, or press Enter.'
                  : selected
                    ? 'The selected area is regenerated; everything else is kept.'
                    : 'No selection — the change applies from your instruction across the whole image. Select an area to bound it.'}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
