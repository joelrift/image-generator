'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { INPUT_TYPES, INPUT_TYPE_LABELS } from '@/lib/preprocess';
import type { InputType } from '@/lib/providers/types';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/lib/validate';

interface UploadPanelProps {
  file: File | null;
  previewUrl: string;
  inputType: InputType;
  disabled: boolean;
  onFileChange: (file: File | null, detectedType?: InputType) => void;
  onInputTypeChange: (inputType: InputType) => void;
  onError: (message: string) => void;
}

/**
 * Upload surface: click, drag-and-drop, or paste from clipboard.
 *
 * Paste matters here — the whole point is going straight from an Archicad
 * screenshot to a render, and that screenshot is usually already on the
 * clipboard. Matches the Ctrl+V affordance in the other RIFT Lab tools.
 */
export default function UploadPanel({
  file,
  previewUrl,
  inputType,
  disabled,
  onFileChange,
  onInputTypeChange,
  onError,
}: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  /** Mirror the server's limits so bad files fail instantly, not after an upload. */
  const accept = useCallback(
    (candidate: File): boolean => {
      if (!ALLOWED_IMAGE_TYPES.includes(candidate.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
        onError(`Filtypen ${candidate.type || 'ukjent'} støttes ikke. Bruk PNG, JPEG eller WebP.`);
        return false;
      }
      if (candidate.size > MAX_UPLOAD_BYTES) {
        onError(
          `Filen er ${(candidate.size / 1024 / 1024).toFixed(1)} MB. Maks er ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        );
        return false;
      }
      return true;
    },
    [onError],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const candidate = files?.[0];
      if (!candidate || !accept(candidate)) return;
      onFileChange(candidate);
    },
    [accept, onFileChange],
  );

  // Clipboard paste, scoped to the window so it works without focusing the panel.
  useEffect(() => {
    if (disabled) return;

    const onPaste = (event: ClipboardEvent) => {
      // Don't hijack paste while the user is typing a prompt.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      const image = Array.from(event.clipboardData?.items ?? []).find((item) =>
        item.type.startsWith('image/'),
      );
      if (!image) return;

      const pasted = image.getAsFile();
      if (!pasted || !accept(pasted)) return;

      event.preventDefault();
      onFileChange(pasted);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [accept, disabled, onFileChange]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="label">Underlag</h2>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!disabled) handleFiles(event.dataTransfer.files);
        }}
        className={`rounded border border-dashed p-3 transition-colors ${
          isDragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
        }`}
      >
        {previewUrl ? (
          <div className="flex flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL from the local file */}
            <img
              src={previewUrl}
              alt={`Underlag: ${file?.name ?? 'opplastet bilde'}`}
              className="max-h-48 w-full rounded object-contain"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[12px] text-muted" title={file?.name}>
                {file?.name}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onFileChange(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                className="text-[12px] text-muted underline hover:text-ink disabled:opacity-50"
              >
                Fjern
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-1 px-2 py-8 text-center disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-xl leading-none text-muted">
              +
            </span>
            <span className="text-[13px] text-ink">Slipp, klikk eller lim inn (Ctrl+V)</span>
            <span className="text-[12px] text-muted">
              Skisse eller 3D-skjermbilde · PNG, JPEG, WebP
            </span>
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="label">Type underlag</span>
        <div className="flex flex-wrap gap-2">
          {INPUT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="pill"
              data-active={inputType === type}
              aria-pressed={inputType === type}
              disabled={disabled}
              onClick={() => onInputTypeChange(type)}
            >
              {INPUT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted">
          Styrer forhåndsvalgt strukturmetode. Bytte her nullstiller metode og styrke.
        </p>
      </div>
    </section>
  );
}
