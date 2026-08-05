'use client';

import { CONTROL_TYPE_LABELS } from '@/lib/preprocess';
import {
  ASPECTS,
  EDIT_OP_LABELS,
  type AspectKey,
  type RenderRun,
  type Selection,
} from '@/lib/studio';

interface ResultsGridProps {
  runs: RenderRun[];
  selected: Selection | null;
  isGenerating: boolean;
  expectedCount: number;
  aspect: AspectKey;
  hasInput: boolean;
  onSelect: (selection: Selection) => void;
  onEditRegion: (selection: Selection) => void;
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
  onSelect,
  onEditRegion,
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
        // Narrowing form rather than a boolean flag, so `editOp` is typed EditOp
        // where it is used and the badge lookup stays exhaustive.
        const editOp = run.op === 'generate' ? null : run.op;
        const isGenerated = editOp === null;

        /*
         * Generated runs are laid out on the ratio they were asked for. Edit
         * results are not: the provider returns whatever size it returns, so
         * they are contained rather than cropped to a ratio we would be guessing.
         */
        const figureStyle = isGenerated
          ? { aspectRatio: run.aspect ? `${ASPECTS[run.aspect].width} / ${ASPECTS[run.aspect].height}` : pendingRatio }
          : { maxHeight: '22rem' };

        return (
          <section key={run.id} className="flex flex-col gap-3">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="min-w-0 flex-1 truncate text-[14px] text-ink" title={run.prompt}>
                {editOp && (
                  <span className="mr-2 rounded-full border border-accent px-2 py-0.5 align-middle font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
                    {EDIT_OP_LABELS[editOp]}
                  </span>
                )}
                {run.prompt}
              </h2>
              <span className="label shrink-0">
                {isGenerated && run.controlType && (
                  <>
                    {CONTROL_TYPE_LABELS[run.controlType]} ·{' '}
                    {run.controlStrength?.toFixed(2) ?? '—'} · {run.aspect} ·{' '}
                  </>
                )}
                {new Date(run.createdAt).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </header>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                        alt={`${isGenerated ? 'Variation' : 'Edit'} ${index + 1} of ${run.images.length} for “${run.prompt}”`}
                        loading="lazy"
                        style={figureStyle}
                        className={`w-full ${isGenerated ? 'object-cover' : 'object-contain'}`}
                      />
                    </button>

                    <figcaption className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="font-mono text-muted">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      {isSelected ? (
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onEditRegion({ runId: run.id, index })}
                            className="text-accent underline hover:no-underline"
                          >
                            Edit region
                          </button>
                          <span className="text-muted">· upscale in Phase 4</span>
                        </span>
                      ) : (
                        <span className="text-muted opacity-0 transition-opacity group-hover:opacity-100">
                          select
                        </span>
                      )}
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
