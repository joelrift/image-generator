'use client';

import {
  CONTROL_TYPE_HINTS,
  CONTROL_TYPE_LABELS,
  describeControlStrength,
  suggestedControlTypes,
} from '@/lib/preprocess';
import type { ControlType, InputType, ProviderName, StylePreset } from '@/lib/providers/types';
import { ASPECTS, ASPECT_KEYS, type AspectKey } from '@/lib/studio';

const STYLE_LABELS: Record<StylePreset, string> = {
  realistic: 'Photorealistic',
  watercolor: 'Watercolour',
  vector: 'Vector',
};

const STYLES = Object.keys(STYLE_LABELS) as StylePreset[];

interface StyleControlsProps {
  providerName: ProviderName;
  inputType: InputType;
  controlType: ControlType;
  controlStrength: number;
  style: StylePreset;
  aspect: AspectKey;
  numImages: number;
  lockMaterials: boolean;
  disabled: boolean;
  onControlTypeChange: (controlType: ControlType) => void;
  onControlStrengthChange: (strength: number) => void;
  onStyleChange: (style: StylePreset) => void;
  onAspectChange: (aspect: AspectKey) => void;
  onNumImagesChange: (count: number) => void;
  onLockMaterialsChange: (lock: boolean) => void;
}

/**
 * Style preset, structure method, and the strength slider — the control that
 * produces Visoid's Sketch↔Volumetric spectrum (brief §2 item 3).
 */
export default function StyleControls({
  providerName,
  inputType,
  controlType,
  controlStrength,
  style,
  aspect,
  numImages,
  lockMaterials,
  disabled,
  onControlTypeChange,
  onControlStrengthChange,
  onStyleChange,
  onAspectChange,
  onNumImagesChange,
  onLockMaterialsChange,
}: StyleControlsProps) {
  // Ordered by what suits the current input type; all options stay available.
  const controlTypes = suggestedControlTypes(inputType);

  /*
   * On BFL, generate runs through Kontext, which conditions on the whole image
   * from an instruction: it takes no ControlNet method and follows the source
   * image's own aspect. So the Structure-method and Format controls do nothing
   * there, and showing them would claim an effect the output won't reflect. They
   * stay for Mock and for a provider/mode that honours them.
   */
  const structureAndFormatApply = providerName !== 'bfl';

  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="label">Style</h2>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((preset) => (
            <button
              key={preset}
              type="button"
              className="pill"
              data-active={style === preset}
              aria-pressed={style === preset}
              disabled={disabled}
              onClick={() => onStyleChange(preset)}
            >
              {STYLE_LABELS[preset]}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="label">Materials</h2>
        <label className="flex items-start gap-2 text-[13px] text-ink">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={lockMaterials}
            disabled={disabled}
            onChange={(event) => onLockMaterialsChange(event.target.checked)}
          />
          <span>
            Lock materials
            <span className="block text-[12px] text-muted">
              {lockMaterials
                ? 'Keeps your model’s cladding and colours; only lighting and realism change. Name a material (prompt or palette) to change it.'
                : 'Lets the model reinterpret materials for a photoreal look when none are named.'}
            </span>
          </span>
        </label>
      </section>

      {structureAndFormatApply && (
        <section className="flex flex-col gap-2">
          <h2 className="label">Structure method</h2>
          <div className="flex flex-wrap gap-2">
            {controlTypes.map((type) => (
              <button
                key={type}
                type="button"
                className="pill"
                data-active={controlType === type}
                aria-pressed={controlType === type}
                disabled={disabled}
                title={CONTROL_TYPE_HINTS[type]}
                onClick={() => onControlTypeChange(type)}
              >
                {CONTROL_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-muted">{CONTROL_TYPE_HINTS[controlType]}</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="label" id="strength-label">
            Follow the source
          </h2>
          <span className="font-mono text-[12px] text-ink">{controlStrength.toFixed(2)}</span>
        </div>
        <input
          type="range"
          className="slider"
          min={0}
          max={1}
          step={0.05}
          value={controlStrength}
          disabled={disabled}
          aria-labelledby="strength-label"
          aria-describedby="strength-hint"
          aria-valuetext={`${controlStrength.toFixed(2)} — ${describeControlStrength(controlStrength)}`}
          onChange={(event) => onControlStrengthChange(Number(event.target.value))}
        />
        <div className="flex justify-between">
          <span className="text-[11px] text-muted">Free</span>
          <span className="text-[11px] text-muted">Strict</span>
        </div>
        <p id="strength-hint" className="text-[12px] text-muted">
          {describeControlStrength(controlStrength)}
        </p>
      </section>

      {structureAndFormatApply && (
        <section className="flex flex-col gap-2">
          <h2 className="label">Format</h2>
          <div className="flex flex-wrap gap-2">
            {ASPECT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="pill font-mono"
                data-active={aspect === key}
                aria-pressed={aspect === key}
                disabled={disabled}
                title={`${ASPECTS[key].width}×${ASPECTS[key].height}`}
                onClick={() => onAspectChange(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="label">Variations</h2>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 4, 6].map((count) => (
            <button
              key={count}
              type="button"
              className="pill font-mono"
              data-active={numImages === count}
              aria-pressed={numImages === count}
              disabled={disabled}
              onClick={() => onNumImagesChange(count)}
            >
              {count}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted">
          {structureAndFormatApply
            ? 'Previews at ~1K are cheap. Upscaling to 2K/4K runs only on the image you pick.'
            : 'Generate several cheap previews, then refine the one you pick.'}
        </p>
      </section>
    </>
  );
}
