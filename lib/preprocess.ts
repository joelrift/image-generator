import type { ControlType, InputType } from './providers/types';

/**
 * Input type → ControlNet preprocessor mapping (brief §5).
 *
 *   sketch     → scribble / soft-edge   (loose lines, let the model interpret)
 *   screenshot → depth (+ optional canny) (hard geometry, preserve it)
 *
 * The UI auto-picks from the input-type toggle and the user can override.
 */
export const CONTROL_TYPES: readonly ControlType[] = ['depth', 'softedge', 'scribble', 'canny'];

export const INPUT_TYPES: readonly InputType[] = ['sketch', 'screenshot'];

/** The preprocessor we default to for a given upload. */
export function defaultControlType(inputType: InputType): ControlType {
  return inputType === 'sketch' ? 'scribble' : 'depth';
}

/**
 * Preprocessors worth offering for a given upload, best first. Every control
 * type stays reachable — this only orders them so the sensible ones come first.
 */
export function suggestedControlTypes(inputType: InputType): ControlType[] {
  return inputType === 'sketch'
    ? ['scribble', 'softedge', 'canny', 'depth']
    : ['depth', 'canny', 'softedge', 'scribble'];
}

/**
 * Default strength for the "how strictly to follow the input" slider.
 *
 * A 3D screenshot already carries the geometry the architect wants kept, so it
 * starts high. A hand sketch is a suggestion, so it starts mid-range and leaves
 * the model room — this is the Sketch↔Volumetric spectrum from the brief.
 */
export function defaultControlStrength(inputType: InputType): number {
  return inputType === 'sketch' ? 0.55 : 0.85;
}

/** Human-readable copy for the control-type picker. */
export const CONTROL_TYPE_LABELS: Record<ControlType, string> = {
  depth: 'Dybde',
  softedge: 'Myk kant',
  scribble: 'Skisse',
  canny: 'Kantlinjer',
};

export const CONTROL_TYPE_HINTS: Record<ControlType, string> = {
  depth: 'Bevarer volum og romdybde — best for 3D-eksport fra Archicad.',
  softedge: 'Følger myke konturer — tolerant for unøyaktige linjer.',
  scribble: 'Løs tolkning av strektegning — best for frihåndsskisse.',
  canny: 'Følger harde kanter strengt — kan bli stivt.',
};

export const INPUT_TYPE_LABELS: Record<InputType, string> = {
  sketch: 'Skisse',
  screenshot: '3D-skjermbilde',
};

/**
 * Where the strength slider sits, in words. Shown next to the slider so the
 * number means something to someone who has never touched ControlNet.
 */
export function describeControlStrength(strength: number): string {
  if (strength < 0.35) return 'Fri tolkning — geometrien kan endres mye';
  if (strength < 0.6) return 'Balansert — hovedform beholdes';
  if (strength < 0.85) return 'Tett på input — geometrien følges';
  return 'Nær identisk geometri — kun materialer og lys endres';
}
