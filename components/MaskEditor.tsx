'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BRUSH_DEFAULT,
  BRUSH_MAX,
  BRUSH_MIN,
  MIN_POINT_DISTANCE,
  distance,
  hasMaskContent,
  imageFieldValue,
  renderOverlay,
  strokesToMaskBlob,
  type MaskPoint,
  type MaskStroke,
} from '@/lib/mask';
import {
  EDIT_OPS,
  EDIT_OP_HINTS,
  EDIT_OP_LABELS,
  EDIT_OP_PLACEHOLDERS,
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
 * Paint over the finished render, then either change what is there ("change
 * this" → inpaint) or insert something new ("add something" → addElement).
 *
 * The image itself is never drawn into the stroke canvas: the overlay carries
 * only brush marks, and the export mask is rendered separately at natural
 * resolution. That keeps the canvas untainted regardless of where the render
 * came from, and means the exported mask is exactly two-tone.
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
  const [prompt, setPrompt] = useState('');
  const [brush, setBrush] = useState(BRUSH_DEFAULT);
  const [erasing, setErasing] = useState(false);
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [preparing, setPreparing] = useState(false);

  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const drawing = useRef(false);

  // Keep the overlay canvas exactly on top of the rendered image box.
  useLayoutEffect(() => {
    const element = imageRef.current;
    if (!element) return;

    const measure = () =>
      setBox({ width: element.clientWidth, height: element.clientHeight });

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [src, natural.width]);

  // Repaint whenever the strokes or the box change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.width === 0 || box.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderOverlay(ctx, strokes, box.width, box.height);
  }, [box, strokes]);

  // Escape closes, and the prompt takes focus on open.
  useEffect(() => {
    promptRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const pointFromEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>): MaskPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const point = pointFromEvent(event);
    setStrokes((previous) => [
      ...previous,
      { mode: erasing ? 'erase' : 'paint', radius: brush, points: [point] },
    ]);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const point = pointFromEvent(event);

    setStrokes((previous) => {
      const current = previous.at(-1);
      if (!current) return previous;

      const last = current.points.at(-1);
      if (last && distance(last, point) < MIN_POINT_DISTANCE) return previous;

      const updated = { ...current, points: [...current.points, point] };
      return [...previous.slice(0, -1), updated];
    });
  };

  const endStroke = () => {
    drawing.current = false;
  };

  const painted = hasMaskContent(strokes);
  const maskRequired = op === 'inpaint';
  const canApply = prompt.trim().length > 0 && (!maskRequired || painted) && !busy && !preparing;

  const handleApply = async () => {
    if (!canApply) return;

    setPreparing(true);
    try {
      const [image, mask] = await Promise.all([
        imageFieldValue(src),
        painted
          ? strokesToMaskBlob(strokes, natural.width, natural.height)
          : Promise.resolve(null),
      ]);
      onApply({ op, prompt: prompt.trim(), image, mask });
    } catch (cause) {
      onError(
        cause instanceof Error ? cause.message : 'Could not prepare the mask for sending.',
      );
    } finally {
      setPreparing(false);
    }
  };

  const working = busy || preparing;

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
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endStroke}
                onPointerLeave={endStroke}
                onPointerCancel={endStroke}
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
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="label" id="brush-label">
                  Brush
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
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="pill"
                  data-active={erasing}
                  aria-pressed={erasing}
                  disabled={working}
                  onClick={() => setErasing((previous) => !previous)}
                >
                  Eraser
                </button>
                <button
                  type="button"
                  className="pill"
                  disabled={working || strokes.length === 0}
                  onClick={() => setStrokes((previous) => previous.slice(0, -1))}
                >
                  Undo
                </button>
                <button
                  type="button"
                  className="pill"
                  disabled={working || strokes.length === 0}
                  onClick={() => setStrokes([])}
                >
                  Clear
                </button>
              </div>
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
              <button type="button" onClick={handleApply} disabled={!canApply} className="btn-primary">
                <span className="block">
                  {working ? 'Working…' : EDIT_OP_LABELS[op]}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] font-normal opacity-80">
                  {working
                    ? 'sending to provider'
                    : painted
                      ? `masked · ${natural.width}×${natural.height}`
                      : 'no mask painted'}
                </span>
              </button>
              <p className="text-[12px] text-muted">
                {maskRequired && !painted
                  ? 'Paint over the area you want changed to continue.'
                  : !painted
                    ? 'Without a mask, placement comes from your wording alone.'
                    : 'White in the mask marks what changes; everything else is kept.'}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
