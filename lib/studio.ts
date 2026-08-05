import type { ControlType, InputType, StylePreset } from './providers/types';

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

/** One generation, kept for the session gallery (brief §2 item 6). */
export interface RenderRun {
  id: string;
  prompt: string;
  images: string[];
  inputType: InputType;
  controlType: ControlType;
  controlStrength: number;
  style: StylePreset;
  aspect: AspectKey;
  createdAt: number;
}

/** Image selected for the Phase 4 upscale pass. */
export interface Selection {
  runId: string;
  index: number;
}
