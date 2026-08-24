'use client';

import { CONTROL_TYPE_LABELS } from '@/lib/preprocess';
import {
  ASPECTS,
  EDIT_OP_LABELS,
  type AspectKey,
  type RenderRun,
  type Selection,
} from '@/lib/studio';
import type { UpscaleFactor } from '@/lib/upscale';

interface ResultsGridProps {
  runs: RenderRun[];
  selected: Selection | null;
  isGenerating: boolean;
  expectedCount: number;
  aspect: AspectKey;
  hasInput: boolean;
  upscaling: Selection | null;
  finalizing: Selection | null;
  onSelect: (selection: Selection) => void;
  onEditRegion: (selection: Selection) => void;
  onUpscale: (selection: Selection, scale: UpscaleFactor) => void;
  onFinalize: (selection: Selection) => void;
  onDelete: (selection: Selection) => void;
}

/**
 * Session gallery: newest run first, each variation selectable.
 *
 * Selection drives two things — the region editor (Phase 3) and Phase 4's
 * pick-to-upscale, where only the chosen image gets the expensive pass.
 */
export default function ResultsGrid({
  runs,
  selected,
  isGenerating,
  expectedCount,
  aspect,
  hasInput,
  upscaling,
  finalizing,
  onSelect,
  onEditRegion,
  onUpscale,
  onFinalize,
  onDelete,
}: ResultsGridProps) {
  const pendingRatio = `${ASPECTS[aspect].width} / ${ASPECTS[aspect].height}`;

  if (!isGenerating && runs.length === 0) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center">
        <div className="panel max-w-md px-8 py-12 text-center">
          <p className="text-[15px] text-ink">
            {hasInput
              ? 'Write a prompt and press Generate.'
              : 'Upload a sketch or 3D screenshot to begin.'}
          </p>
          <p className="mt-2 text-[13px] text-muted">
            The geometry of the source is preserved. How strictly is set by “Follow the source”.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {isGenerating && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="label">Generating</span>
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          </div>
          <div
            className={`grid gap-3 ${
              expectedCount === 1
                ? 'grid-cols-1 max-w-4xl'
                : expectedCount === 2
                  ? 'grid-cols-1 sm:grid-cols-2 max-w-5xl'
                  : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
            }`}
          >
            {Array.from({ length: expectedCount }, (_, i) => (
              <div
                key={i}
                style={{ aspectRatio: pendingRatio }}
                className="animate-pulse rounded border border-line bg-surface-2"
              />
            ))}
          </div>
          <span className="sr-only" role="status">
            Generating {expectedCount} variations
          </span>
        </section>
      )}

      {runs.map((run) => {
        const isGenerated = run.op === 'generate';

        // The chip shown before the prompt on non-generate runs.
        const badgeLabel =
          run.op === 'upscale'
            ? run.dimensions
              ? `Upscaled · ${run.dimensions.width}×${run.dimensions.height}`
              : 'Upscaled'
            : run.op === 'finalize'
              ? 'Finalized'
              : run.op === 'inpaint' || run.op === 'add-element'
                ? EDIT_OP_LABELS[run.op]
                : null;

        /*
         * A run is laid out on a fixed ratio only when we actually controlled
         * that ratio — a Mock/control-mode generate. BFL generate (Kontext) and
         * every edit return whatever dimensions the provider chose, so they are
         * contained at natural aspect rather than cropped to a ratio we would be
         * guessing at.
         */
        const knowsAspect = isGenerated && run.provider !== 'bfl';
        const figureStyle = knowsAspect
          ? { aspectRatio: run.aspect ? `${ASPECTS[run.aspect].width} / ${ASPECTS[run.aspect].height}` : pendingRatio }
          : { maxHeight: '40rem' };

        /*
         * Columns follow the variation count so a single render fills the space
         * instead of sitting in one cell of a three-up grid. The max-width caps
         * how large one or two images get on a very wide screen — a lone 1K
         * preview blown up to 1600px only looks soft.
         */
        const gridClass =
          run.images.length === 1
            ? 'grid-cols-1 max-w-4xl'
            : run.images.length === 2
              ? 'grid-cols-1 sm:grid-cols-2 max-w-5xl'
              : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';

        return (
          <section key={run.id} className="flex flex-col gap-3">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="min-w-0 flex-1 truncate text-[14px] text-ink" title={run.prompt}>
                {badgeLabel && (
                  <span className="mr-2 rounded-full border border-accent px-2 py-0.5 align-middle font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
                    {badgeLabel}
                  </span>
                )}
                {run.prompt}
              </h2>
              <span className="label shrink-0">
                {isGenerated && knowsAspect && run.controlType && (
                  <>
                    {CONTROL_TYPE_LABELS[run.controlType]} ·{' '}
                    {run.controlStrength?.toFixed(2) ?? '—'} · {run.aspect} ·{' '}
                  </>
                )}
                {isGenerated && !knowsAspect && run.controlStrength !== undefined && (
                  <>follow {run.controlStrength.toFixed(2)} · </>
                )}
                {new Date(run.createdAt).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </header>

            <div className={`grid gap-3 ${gridClass}`}>
              {run.images.map((src, index) => {
                const isSelected = selected?.runId === run.id && selected.index === index;
                return (
                  <figure key={`${run.id}-${index}`} className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSelect({ runId: run.id, index })}
                      aria-pressed={isSelected}
                      className={`group overflow-hidden rounded border bg-surface transition-colors ${
                        isSelected
                          ? 'border-accent ring-1 ring-accent'
                          : 'border-line hover:border-accent'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- provider returns data URIs and remote URLs; hosts are unknown until Phase 2 */}
                      <img
                        src={src}
                        alt={`${isGenerated ? 'Variation' : run.op === 'upscale' ? 'Upscaled' : 'Edit'} ${index + 1} of ${run.images.length} for “${run.prompt}”`}
                        loading="lazy"
                        style={figureStyle}
                        className={`w-full ${knowsAspect ? 'object-cover' : 'object-contain'}`}
                      />
                    </button>

                    <figcaption className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="font-mono text-muted">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="flex items-center gap-2">
                        {isSelected && (
                          <>
                            <button
                              type="button"
                              onClick={() => onEditRegion({ runId: run.id, index })}
                              className="text-accent underline hover:no-underline"
                            >
                              Edit region
                            </button>
                            <span aria-hidden="true" className="text-line">
                              |
                            </span>
                            <button
                              type="button"
                              onClick={() => onFinalize({ runId: run.id, index })}
                              disabled={finalizing !== null}
                              className="text-accent underline hover:no-underline disabled:opacity-50"
                            >
                              {finalizing?.runId === run.id && finalizing.index === index
                                ? 'Finalizing…'
                                : 'Finalize'}
                            </button>
                            <span aria-hidden="true" className="text-line">
                              |
                            </span>
                            <span className="text-muted">Upscale</span>
                            {([2, 4] as const).map((factor) => (
                              <button
                                key={factor}
                                type="button"
                                onClick={() => onUpscale({ runId: run.id, index }, factor)}
                                disabled={upscaling !== null}
                                className="text-accent underline hover:no-underline disabled:opacity-50"
                              >
                                {upscaling?.runId === run.id && upscaling.index === index
                                  ? `${factor}×…`
                                  : `${factor}×`}
                              </button>
                            ))}
                            <span aria-hidden="true" className="text-line">
                              |
                            </span>
                            <button
                              type="button"
                              onClick={() => onDelete({ runId: run.id, index })}
                              className="text-muted underline hover:text-red-700 hover:no-underline"
                            >
                              Remove
                            </button>
                            <span aria-hidden="true" className="text-line">
                              |
                            </span>
                          </>
                        )}
                        <a
                          href={src}
                          download={`rift-${run.op}-${index + 1}.${src.startsWith('data:image/svg') ? 'svg' : 'png'}`}
                          className={`text-muted underline hover:text-ink ${
                            isSelected ? '' : 'opacity-0 transition-opacity group-hover:opacity-100'
                          }`}
                        >
                          Download
                        </a>
                      </span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
