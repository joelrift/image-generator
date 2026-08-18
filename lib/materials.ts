/**
 * Material palette — named swatches the render should use as its materials
 * (the GoBANANAS "Materialpalett" pattern).
 *
 * Names always reach the prompt so any provider can act on them; the swatch
 * images are attached as visual references by providers that accept multiple
 * images (Gemini). Kept pure so the prompt composition is unit-testable.
 */

export interface Material {
  id: string;
  label: string;
  /** The swatch image as a data URI, held client-side. */
  dataUrl: string;
  active: boolean;
}

export function activeMaterials(materials: Material[]): Material[] {
  return materials.filter((m) => m.active && m.dataUrl && m.label.trim());
}

/**
 * The clause appended to the prompt naming the palette's materials. Empty when
 * nothing is active, so it never leaves a dangling fragment.
 */
export function materialsClause(materials: Material[]): string {
  const names = activeMaterials(materials).map((m) => m.label.trim());
  if (names.length === 0) return '';
  return `Apply these materials to the building: ${names.join(', ')}.`;
}
