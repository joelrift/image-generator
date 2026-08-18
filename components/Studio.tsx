'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MaskEditor, { type ApplyEditArgs } from './MaskEditor';
import MaterialPalette from './MaterialPalette';
import PromptBar from './PromptBar';
import ResultsGrid from './ResultsGrid';
import StyleControls from './StyleControls';
import UploadPanel from './UploadPanel';
import { defaultControlStrength, defaultControlType } from '@/lib/preprocess';
import type {
  ControlType,
  ImageResult,
  InputType,
  ProviderName,
  StylePreset,
} from '@/lib/providers/types';
import { imageFieldValue } from '@/lib/mask';
import { activeMaterials, materialsClause, type Material } from '@/lib/materials';
import { composePrompt, type SceneTags } from '@/lib/prompt-tags';
import { upscaleImage, type UpscaleFactor } from '@/lib/upscale';
import {
  ASPECTS,
  EDIT_OP_LABELS,
  type AspectKey,
  type RenderRun,
  type Selection,
} from '@/lib/studio';

/** Random enough to key a list; not used for anything security-sensitive. */
function runId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Pull the error message out of a route's JSON body, whatever shape it took. */
function messageFrom(payload: unknown, status: number, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    return String((payload as { error: unknown }).error);
  }
  return `${fallback} (HTTP ${status}).`;
}

/** A base64 data URI → Blob, for sending palette swatches as file parts. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Append the active palette swatches (images + parallel labels) to a form. */
function appendMaterials(form: FormData, materials: Material[]): void {
  const active = activeMaterials(materials);
  if (active.length === 0) return;
  const labels: string[] = [];
  active.forEach((material, index) => {
    form.append('material', new File([dataUrlToBlob(material.dataUrl)], `material-${index}.png`, {
      type: 'image/png',
    }));
    labels.push(material.label.trim());
  });
  form.set('materialLabels', JSON.stringify(labels));
}

/**
 * Holds the state the panels share. The brief lists the four panels but not a
 * parent for them; something has to own the shared state, and keeping page.tsx a
 * server component is what lets us read the provider from env.
 */
export default function Studio({ providerName }: { providerName: ProviderName }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');

  const [inputType, setInputType] = useState<InputType>('screenshot');
  const [controlType, setControlType] = useState<ControlType>(defaultControlType('screenshot'));
  const [controlStrength, setControlStrength] = useState<number>(
    defaultControlStrength('screenshot'),
  );
  const [style, setStyle] = useState<StylePreset>('realistic');
  const [aspect, setAspect] = useState<AspectKey>('16:9');
  const [numImages, setNumImages] = useState(4);

  const [prompt, setPrompt] = useState('');
  const [sceneTags, setSceneTags] = useState<SceneTags>({});
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>('');

  // Free text + helper chips + active material names → the prompt actually sent.
  const composedPrompt = useMemo(
    () => [composePrompt(prompt, sceneTags), materialsClause(materials)].filter(Boolean).join(' '),
    [prompt, sceneTags, materials],
  );

  const [runs, setRuns] = useState<RenderRun[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);

  // Region editor: which image is open, and its own in-flight/error state so a
  // failed edit does not disturb the studio behind the dialog.
  const [editing, setEditing] = useState<string | null>(null);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  // Which selection is currently being upscaled (client-side resample).
  const [upscaling, setUpscaling] = useState<Selection | null>(null);
  // Which selection is currently being finalized (Gemini finishing pass).
  const [finalizing, setFinalizing] = useState<Selection | null>(null);

  /**
   * Object URLs are not garbage collected on their own, and they are created as
   * a direct consequence of an event rather than of rendering — so mint and
   * revoke them in the handler, keeping the outstanding one in a ref for the
   * unmount sweep. (Doing this in an effect that calls setState would tear down
   * and recreate the URL on every dependency change.)
   */
  const previewUrlRef = useRef<string>('');

  const replaceInputFile = useCallback((next: File | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = next ? URL.createObjectURL(next) : '';
    previewUrlRef.current = url;
    setFile(next);
    setPreviewUrl(url);
  }, []);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  /**
   * Switching input type re-applies the preprocessor preset and strength.
   * Sketch and screenshot want genuinely different defaults, so carrying the old
   * values across would leave the user with a setting that fights their input.
   */
  const handleInputTypeChange = useCallback((next: InputType) => {
    setInputType(next);
    setControlType(defaultControlType(next));
    setControlStrength(defaultControlStrength(next));
  }, []);

  const handleFile = useCallback(
    (next: File | null, detectedType?: InputType) => {
      replaceInputFile(next);
      setError('');
      if (next && detectedType) handleInputTypeChange(detectedType);
    },
    [handleInputTypeChange, replaceInputFile],
  );

  // A prompt can come from free text, the helper chips, or both.
  const canGenerate = Boolean(file) && composedPrompt.trim().length > 0 && !isGenerating;

  const handleGenerate = useCallback(async () => {
    if (!file || !composedPrompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setError('');

    const { width, height } = ASPECTS[aspect];
    const form = new FormData();
    form.set('image', file);
    form.set('prompt', composedPrompt);
    form.set('controlType', controlType);
    form.set('controlStrength', String(controlStrength));
    form.set('style', style);
    form.set('numImages', String(numImages));
    form.set('width', String(width));
    form.set('height', String(height));
    appendMaterials(form, materials);

    try {
      const response = await fetch('/api/generate', { method: 'POST', body: form });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(messageFrom(payload, response.status, 'Generation failed'));
        return;
      }

      const result = payload as ImageResult;
      if (!result?.images?.length) {
        setError('The provider returned no images.');
        return;
      }

      const run: RenderRun = {
        id: runId(),
        op: 'generate',
        provider: providerName,
        prompt: composedPrompt,
        images: result.images,
        inputType,
        controlType,
        controlStrength,
        style,
        aspect,
        createdAt: Date.now(),
      };

      setRuns((previous) => [run, ...previous]);
      setSelected({ runId: run.id, index: 0 });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Network error: ${cause.message}`
          : 'Unknown error during generation.',
      );
    } finally {
      setIsGenerating(false);
    }
  }, [
    aspect,
    composedPrompt,
    controlStrength,
    controlType,
    file,
    inputType,
    isGenerating,
    materials,
    numImages,
    providerName,
    style,
  ]);

  const handleOpenEditor = useCallback(
    (selection: Selection) => {
      const run = runs.find((candidate) => candidate.id === selection.runId);
      const src = run?.images[selection.index];
      if (!run || !src) return;

      setSelected(selection);
      setEditing(src);
      setEditingRunId(run.id);
      setEditError('');
    },
    [runs],
  );

  const handleCloseEditor = useCallback(() => {
    if (editBusy) return; // don't drop a request the provider is still serving
    setEditing(null);
    setEditingRunId(null);
    setEditError('');
  }, [editBusy]);

  /**
   * Send the painted mask to whichever branch the user chose. The result lands
   * in the gallery as a new run rather than replacing the original, so an edit
   * can itself be edited and nothing the user liked is ever lost.
   */
  const handleApplyEdit = useCallback(
    async ({ op, prompt: instruction, image, mask }: ApplyEditArgs) => {
      setEditBusy(true);
      setEditError('');

      const form = new FormData();
      form.set('prompt', instruction);
      form.set(
        'image',
        typeof image === 'string' ? image : new File([image], 'render.png', { type: 'image/png' }),
      );
      if (mask) form.set('mask', new File([mask], 'mask.png', { type: 'image/png' }));

      const endpoint = op === 'inpaint' ? '/api/inpaint' : '/api/add-element';

      try {
        const response = await fetch(endpoint, { method: 'POST', body: form });
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          setEditError(messageFrom(payload, response.status, `${EDIT_OP_LABELS[op]} failed`));
          return;
        }

        const result = payload as ImageResult;
        if (!result?.images?.length) {
          setEditError('The provider returned no images.');
          return;
        }

        const run: RenderRun = {
          id: runId(),
          op,
          provider: providerName,
          prompt: instruction,
          images: result.images,
          sourceRunId: editingRunId ?? undefined,
          createdAt: Date.now(),
        };

        setRuns((previous) => [run, ...previous]);
        setSelected({ runId: run.id, index: 0 });
        setEditing(null);
        setEditingRunId(null);
      } catch (cause) {
        setEditError(
          cause instanceof Error ? `Network error: ${cause.message}` : 'Unknown error during edit.',
        );
      } finally {
        setEditBusy(false);
      }
    },
    [editingRunId, providerName],
  );

  /**
   * Upscale the selected image by resampling it client-side (Option A). It makes
   * the image bigger, not more detailed; the result lands as its own run so the
   * original preview is untouched and the enlarged copy can be saved.
   */
  const handleUpscale = useCallback(
    async (selection: Selection, scale: UpscaleFactor) => {
      if (upscaling) return;
      const run = runs.find((candidate) => candidate.id === selection.runId);
      const src = run?.images[selection.index];
      if (!run || !src) return;

      setUpscaling(selection);
      setError('');
      try {
        const { url, width, height } = await upscaleImage(src, scale);
        const upscaled: RenderRun = {
          id: runId(),
          op: 'upscale',
          provider: run.provider,
          prompt: run.prompt,
          images: [url],
          sourceRunId: run.id,
          dimensions: { width, height },
          createdAt: Date.now(),
        };
        setRuns((previous) => [upscaled, ...previous]);
        setSelected({ runId: upscaled.id, index: 0 });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not upscale the image.');
      } finally {
        setUpscaling(null);
      }
    },
    [runs, upscaling],
  );

  /**
   * The last stage: send a settled composition to the finalize provider (Gemini
   * by default) for a whole-image photoreal pass. Lands as its own run, so the
   * pre-finish version is kept — the finish is an alternative, not a replacement.
   */
  const handleFinalize = useCallback(
    async (selection: Selection) => {
      if (finalizing) return;
      const run = runs.find((candidate) => candidate.id === selection.runId);
      const src = run?.images[selection.index];
      if (!run || !src) return;

      setFinalizing(selection);
      setError('');

      const form = new FormData();
      try {
        const image = await imageFieldValue(src);
        form.set(
          'image',
          typeof image === 'string' ? image : new File([image], 'render.png', { type: 'image/png' }),
        );
        // Palette swatches ride along so Gemini applies the real materials.
        appendMaterials(form, materials);
        const mats = activeMaterials(materials);
        if (mats.length) form.set('prompt', materialsClause(materials));

        const response = await fetch('/api/finalize', { method: 'POST', body: form });
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          setError(messageFrom(payload, response.status, 'Finalize failed'));
          return;
        }
        const result = payload as ImageResult;
        if (!result?.images?.length) {
          setError('The provider returned no image.');
          return;
        }

        const finalized: RenderRun = {
          id: runId(),
          op: 'finalize',
          provider: run.provider,
          prompt: run.prompt,
          images: result.images,
          sourceRunId: run.id,
          createdAt: Date.now(),
        };
        setRuns((previous) => [finalized, ...previous]);
        setSelected({ runId: finalized.id, index: 0 });
      } catch (cause) {
        setError(
          cause instanceof Error ? `Network error: ${cause.message}` : 'Unknown error during finalize.',
        );
      } finally {
        setFinalizing(null);
      }
    },
    [finalizing, materials, runs],
  );

  const totalImages = useMemo(() => runs.reduce((sum, run) => sum + run.images.length, 0), [runs]);

  return (
    <div className="flex min-h-dvh flex-col">
      {providerName === 'mock' && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-accent-soft px-4 py-2 text-[13px] text-accent">
          <strong className="font-semibold">Mock mode</strong>
          <span className="text-muted">
            No API key found — images are placeholders showing the parameters that were sent. Add{' '}
            <code className="font-mono">FAL_KEY</code> to{' '}
            <code className="font-mono">.env.local</code> for real generation.
          </span>
        </div>
      )}

      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="label tracking-[0.14em] text-ink">RIFT RENDER STUDIO</span>
          <span className="label">Visualisation with preserved geometry</span>
        </div>
        <span className="label">
          provider: <span className="text-ink">{providerName}</span>
        </span>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col gap-6 border-line p-5 lg:w-[320px] lg:border-r">
          <UploadPanel
            file={file}
            previewUrl={previewUrl}
            inputType={inputType}
            disabled={isGenerating}
            onFileChange={handleFile}
            onInputTypeChange={handleInputTypeChange}
            onError={setError}
          />
          <StyleControls
            providerName={providerName}
            inputType={inputType}
            controlType={controlType}
            controlStrength={controlStrength}
            style={style}
            aspect={aspect}
            numImages={numImages}
            disabled={isGenerating}
            onControlTypeChange={setControlType}
            onControlStrengthChange={setControlStrength}
            onStyleChange={setStyle}
            onAspectChange={setAspect}
            onNumImagesChange={setNumImages}
          />
          <MaterialPalette
            materials={materials}
            disabled={isGenerating}
            onChange={setMaterials}
            onError={setError}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <ResultsGrid
              runs={runs}
              selected={selected}
              isGenerating={isGenerating}
              expectedCount={numImages}
              aspect={aspect}
              hasInput={Boolean(file)}
              upscaling={upscaling}
              finalizing={finalizing}
              onSelect={setSelected}
              onEditRegion={handleOpenEditor}
              onUpscale={handleUpscale}
              onFinalize={handleFinalize}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="mx-5 mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800"
            >
              {error}
            </div>
          )}

          <PromptBar
            prompt={prompt}
            composedPrompt={composedPrompt}
            tags={sceneTags}
            canGenerate={canGenerate}
            isGenerating={isGenerating}
            hasInput={Boolean(file)}
            numImages={numImages}
            imageCount={totalImages}
            onPromptChange={setPrompt}
            onTagsChange={setSceneTags}
            onGenerate={handleGenerate}
          />
        </main>
      </div>

      {editing && (
        <MaskEditor
          src={editing}
          busy={editBusy}
          error={editError}
          onApply={handleApplyEdit}
          onCancel={handleCloseEditor}
          onError={setEditError}
        />
      )}
    </div>
  );
}
