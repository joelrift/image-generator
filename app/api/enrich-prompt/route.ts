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

  if (!mentions('lys', 'light', 'sol', 'sun', 'overcast', 'skumring', 'golden hour')) {
    additions.push('naturlig dagslys, mykt overskyet lys');
  }
  if (!mentions('materiale', 'material', 'tre', 'betong', 'concrete', 'tegl', 'brick', 'glass')) {
    additions.push('realistiske materialer med tydelig tekstur');
  }
  if (!mentions('mm', 'linse', 'lens', 'perspektiv', 'perspective', 'foto')) {
    additions.push('arkitekturfoto, 24 mm, to-punkts perspektiv, vertikaler i lodd');
  }
  if (!mentions('kontekst', 'omgivelse', 'landskap', 'context', 'surrounding')) {
    additions.push('troverdig nordisk kontekst og terreng');
  }

  const styleClause: Record<StylePreset, string> = {
    realistic: 'fotorealistisk arkitekturvisualisering, høy detalj',
    watercolor: 'akvarell-illustrasjon, myke lag, synlig papirstruktur',
    vector: 'rent vektor-diagram, flate flater, begrenset palett',
  };
  additions.push(styleClause[style]);

  if (controlType === 'depth') {
    additions.push('behold eksakt geometri og kameravinkel fra referansen');
  }

  return [prompt.replace(/[.\s]+$/, ''), ...additions].join(', ');
}
