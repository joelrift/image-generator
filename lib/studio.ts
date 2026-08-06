import type { ControlType, InputType, ProviderName, StylePreset } from './providers/types';

/**
 * Types and constants shared between Studio and its child panels.
 *
 * These live here rather than in components/Studio.tsx because the panels need
 * them too: importing them from the parent creates a cycle (Studio → panel →
 * Studio) and the module-init order then throws at prerender time.
 */

/** Preview aspect ratios, long edge ~1K. All dimensions are multiples of 8. */
export const ASPECTS = {
  '16:9': { width: 1024, height: 576 },
  '3:2': { width: 1024, height: 680 },
  '1:1': { width: 1024, height: 1024 },
  '9:16': { width: 576, height: 1024 },
} as const;

export type AspectKey = keyof typeof ASPECTS;

export const ASPECT_KEYS = Object.keys(ASPECTS) as AspectKey[];

/** Which operation produced a run. */
export type RunOp = 'generate' | 'inpaint' | 'add-element';

/** The two branches of the region editor, as the user meets them. */
export const EDIT_OPS = ['inpaint', 'add-element'] as const;

export type EditOp = (typeof EDIT_OPS)[number];

export const EDIT_OP_LABELS: Record<EditOp, string> = {
  inpaint: 'Change this',
  'add-element': 'Add something',
};

export const EDIT_OP_HINTS: Record<EditOp, string> = {
  inpaint:
    'Change what is there. Select an area to bound the change to it (a window, a parked car), or leave it unselected to restyle the whole image — better for a surface-wide material change.',
  'add-element':
    'Describes what to insert, matching perspective and lighting. A selection is optional: mark where it goes, or just say so in words.',
};

export const EDIT_OP_PLACEHOLDERS: Record<EditOp, string> = {
  inpaint: 'What should this area become? e.g. “dark standing-seam metal cladding”',
  'add-element': 'What should be added? e.g. “a timber pergola over the terrace”',
};

/** One generation or edit, kept for the session gallery (brief §2 item 6). */
export interface RenderRun {
  id: string;
  op: RunOp;
  /** Which backend produced it — drives how the run's metadata is shown. */
  provider: ProviderName;
  prompt: string;
  images: string[];
  createdAt: number;

  /** Set for `generate` runs — the settings that produced them. */
  aspect?: AspectKey;
  inputType?: InputType;
  controlType?: ControlType;
  controlStrength?: number;
  style?: StylePreset;

  /** Set for edit runs — the run whose image was edited. */
  sourceRunId?: string;
}

/** Image selected for editing, and for the Phase 4 upscale pass. */
export interface Selection {
  runId: string;
  index: number;
}
