'use client';

import {
  CONTROL_TYPE_HINTS,
  CONTROL_TYPE_LABELS,
  describeControlStrength,
  suggestedControlTypes,
} from '@/lib/preprocess';
import type { ControlType, InputType, StylePreset } from '@/lib/providers/types';
import { ASPECTS, ASPECT_KEYS, type AspectKey } from '@/lib/studio';

const STYLE_LABELS: Record<StylePreset, string> = {
  realistic: 'Fotorealistisk',
  watercolor: 'Akvarell',
  vector: 'Vektor',
};

const STYLES = Object.keys(STYLE_LABELS) as StylePreset[];

interface StyleControlsProps {
  inputType: InputType;
  controlType: ControlType;
  controlStrength: number;
  style: StylePreset;
  aspect: AspectKey;
  numImages: number;
  disabled: boolean;
  onControlTypeChange: (controlType: ControlType) => void;
  onControlStrengthChange: (strength: number) => void;
  onStyleChange: (style: StylePreset) => void;
  onAspectChange: (aspect: AspectKey) => void;
  onNumImagesChange: (count: number) => void;
}

/**
 * Style preset, structure method, and the strength slider — the control that
 * produces Visoid's Sketch↔Volumetric spectrum (brief §2 item 3).
 */
export default function StyleControls({
  inputType,
  controlType,
  controlStrength,
  style,
  aspect,
  numImages,
  disabled,
  onControlTypeChange,
  onControlStrengthChange,
  onStyleChange,
  onAspectChange,
  onNumImagesChange,
}: StyleControlsProps) {
  // Ordered by what suits the current input type; all options stay available.
  const controlTypes = suggestedControlTypes(inputType);

  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="label">Stil</h2>
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
        <h2 className="label">Strukturmetode</h2>
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

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="label" id="strength-label">
            Følg underlaget
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
          <span className="text-[11px] text-muted">Fri</span>
          <span className="text-[11px] text-muted">Streng</span>
        </div>
        <p id="strength-hint" className="text-[12px] text-muted">
          {describeControlStrength(controlStrength)}
        </p>
      </section>

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

      <section className="flex flex-col gap-2">
        <h2 className="label">Antall varianter</h2>
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
          Forhåndsvisning i ~1K er billig. Oppskalering til 2K/4K kjøres bare på bildet du velger.
        </p>
      </section>
    </>
  );
}
