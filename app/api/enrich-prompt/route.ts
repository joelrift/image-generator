import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { CONTROL_TYPES } from '@/lib/preprocess';
import type { ControlType, StylePreset } from '@/lib/providers/types';
import { readEnum, readString } from '@/lib/validate';

const STYLES: readonly StylePreset[] = ['realistic', 'watercolor', 'vector'];

/**
 * POST /api/enrich-prompt — expand a short prompt into a full architectural
 * render prompt (materials, lighting, lens, time of day). Brief §2 item 9,
 * scheduled for Phase 4.
 *
 * Phase 1 ships the deterministic template below so the endpoint is real and
 * testable with no key. Phase 4 swaps the body for an LLM call when
 * ANTHROPIC_API_KEY or OPENAI_API_KEY is set — keep the response shape.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await request.formData();

    const prompt = readString(form, 'prompt', { required: true, maxLength: 2000 });
    const style = readEnum(form, 'style', STYLES, 'realistic');
    const controlType = readEnum(form, 'controlType', CONTROL_TYPES, 'depth');

    const hasLlmKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

    return NextResponse.json({
      prompt: expandWithTemplate(prompt, style, controlType),
      meta: {
        // Phase 4 flips this to 'llm'. The UI can show "enriched by …".
        source: 'template' as const,
        llmKeyPresent: hasLlmKey,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Rule-based stand-in for the LLM. Appends the qualities an architectural render
 * prompt normally needs, skipping anything the user already said so we never
 * fight their own wording.
 */
function expandWithTemplate(prompt: string, style: StylePreset, controlType: ControlType): string {
  const lower = prompt.toLowerCase();
  const additions: string[] = [];

  const mentions = (...terms: string[]) => terms.some((t) => lower.includes(t));

  if (!mentions('light', 'lighting', 'sun', 'overcast', 'dusk', 'golden hour', 'shadow')) {
    additions.push('natural daylight, soft overcast light');
  }
  if (
    !mentions('material', 'timber', 'wood', 'concrete', 'brick', 'glass', 'stone', 'steel', 'clad')
  ) {
    additions.push('realistic materials with visible texture');
  }
  if (!mentions('mm', 'lens', 'perspective', 'photo', 'wide-angle', 'eye level')) {
    additions.push('architectural photography, 24 mm, two-point perspective, verticals plumb');
  }
  if (!mentions('context', 'surrounding', 'landscape', 'site', 'street', 'terrain')) {
    additions.push('believable Nordic context and terrain');
  }

  const styleClause: Record<StylePreset, string> = {
    realistic: 'photorealistic architectural visualisation, high detail',
    watercolor: 'watercolour illustration, soft washes, visible paper texture',
    vector: 'clean vector diagram, flat planes, limited palette',
  };
  additions.push(styleClause[style]);

  if (controlType === 'depth') {
    additions.push('keep the exact geometry and camera angle from the reference');
  }

  return [prompt.replace(/[.\s]+$/, ''), ...additions].join(', ');
}
