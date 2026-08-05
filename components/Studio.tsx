'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ASPECTS, type AspectKey, type RenderRun, type Selection } from '@/lib/studio';

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
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>('');

  const [runs, setRuns] = useState<RenderRun[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);

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

  const canGenerate = Boolean(file) && prompt.trim().length > 0 && !isGenerating;

  const handleGenerate = useCallback(async () => {
    if (!file || !prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setError('');

    const { width, height } = ASPECTS[aspect];
    const form = new FormData();
    form.set('image', file);
    form.set('prompt', prompt.trim());
    form.set('controlType', controlType);
    form.set('controlStrength', String(controlStrength));
    form.set('style', style);
    form.set('numImages', String(numImages));
    form.set('width', String(width));
    form.set('height', String(height));

    try {
      const response = await fetch('/api/generate', { method: 'POST', body: form });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : `Generation failed (HTTP ${response.status}).`;
        setError(message);
        return;
      }

      const result = payload as ImageResult;
      if (!result?.images?.length) {
        setError('The provider returned no images.');
        return;
      }

      const run: RenderRun = {
        id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prompt: prompt.trim(),
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
    controlStrength,
    controlType,
    file,
    inputType,
    isGenerating,
    numImages,
    prompt,
    style,
  ]);

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
              onSelect={setSelected}
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
            canGenerate={canGenerate}
            isGenerating={isGenerating}
            hasInput={Boolean(file)}
            numImages={numImages}
            imageCount={totalImages}
            onPromptChange={setPrompt}
            onGenerate={handleGenerate}
          />
        </main>
      </div>
    </div>
  );
}
