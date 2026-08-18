import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { getProvider } from '@/lib/providers';
import { readImageField, readLimitedFormData, readMaterials, readString } from '@/lib/validate';

/**
 * POST /api/finalize — the last pipeline stage: a whole-image photoreal
 * finishing pass over a composition the user has settled on (brief §2, pipeline
 * discussion). Routed to the `finalize` provider, which defaults to Gemini.
 *
 * Expects multipart form data:
 *   image  (file, required)  the composed render to finish
 *   prompt (string, optional) extra guidance appended to the fixed instruction
 */
const FINALIZE_INSTRUCTION =
  'Re-render this as a polished, photorealistic architectural visualisation. ' +
  'Keep the geometry, composition, materials and every element exactly as they are — ' +
  'do not add, remove or move anything. Improve only realism, lighting, shadows and fine detail.';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await readLimitedFormData(request);

    const image = await readImageField(form, 'image', { required: true });
    const extra = readString(form, 'prompt', { maxLength: 2000 });
    const prompt = extra ? `${FINALIZE_INSTRUCTION} ${extra}` : FINALIZE_INSTRUCTION;
    const materials = await readMaterials(form);

    const result = await getProvider('finalize').finalize({ image: image!, prompt, materials });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
