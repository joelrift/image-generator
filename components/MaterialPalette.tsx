'use client';

import { useRef } from 'react';
import { activeMaterials, type Material } from '@/lib/materials';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/lib/validate';

interface MaterialPaletteProps {
  materials: Material[];
  disabled: boolean;
  onChange: (materials: Material[]) => void;
  onError: (message: string) => void;
}

/**
 * Named material swatches used as render references (GoBANANAS "Materialpalett").
 * Add swatch images, name each, toggle which are active. Active names always go
 * into the prompt; the images ride along to providers that accept them (Gemini).
 */
export default function MaterialPalette({
  materials,
  disabled,
  onChange,
  onError,
}: MaterialPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeCount = activeMaterials(materials).length;

  const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.readAsDataURL(file);
    });

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: Material[] = [];
    for (const file of Array.from(files)) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
        onError(`${file.name}: unsupported type. Use PNG, JPEG or WebP.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        onError(`${file.name} is too large (limit ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`);
        continue;
      }
      const label = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || `Material ${materials.length + next.length + 1}`;
      next.push({
        id: `mat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label,
        dataUrl: await readAsDataUrl(file),
        active: true,
      });
    }
    if (next.length) onChange([...materials, ...next]);
  };

  const update = (id: string, patch: Partial<Material>) =>
    onChange(materials.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const remove = (id: string) => onChange(materials.filter((m) => m.id !== id));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="label">Material palette</h2>
        {materials.length > 0 && (
          <span className="label">
            {activeCount} of {materials.length} active
          </span>
        )}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex flex-col items-center gap-1 rounded border border-dashed border-line bg-surface px-2 py-4 text-center disabled:opacity-50"
      >
        <span aria-hidden="true" className="text-lg leading-none text-muted">
          +
        </span>
        <span className="text-[13px] text-ink">Add material swatches</span>
        <span className="text-[12px] text-muted">Names + images guide the render</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(',')}
        multiple
        className="hidden"
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {materials.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {materials.map((material) => (
            <li
              key={material.id}
              className={`flex flex-col overflow-hidden rounded border ${
                material.active ? 'border-accent' : 'border-line opacity-60'
              }`}
            >
              <div className="relative">
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={material.active}
                  title={material.active ? 'Active — click to mute' : 'Muted — click to use'}
                  onClick={() => update(material.id, { active: !material.active })}
                  className="block w-full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URI swatch */}
                  <img
                    src={material.dataUrl}
                    alt={material.label}
                    className="h-16 w-full object-cover"
                  />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(material.id)}
                  aria-label={`Remove ${material.label}`}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface/90 text-[12px] text-muted hover:text-ink"
                >
                  ×
                </button>
              </div>
              <input
                type="text"
                value={material.label}
                disabled={disabled}
                onChange={(event) => update(material.id, { label: event.target.value })}
                className="w-full border-t border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-accent"
              />
            </li>
          ))}
        </ul>
      )}

      <p className="text-[12px] text-muted">
        Active names are added to the prompt. Swatch images are used as visual
        references on Gemini (generate and Finalize).
      </p>
    </section>
  );
}
