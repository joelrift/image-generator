import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { getProvider } from '@/lib/providers';
import { readImageField, readLimitedFormData, readNumber } from '@/lib/validate';

/**
 * POST /api/upscale — run only on the variation the user picked, since this is
 * the expensive step (brief §5, §10).
 *
 * Expects multipart form data:
 *   image (file, required)
 *   scale 2 | 4
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await readLimitedFormData(request);

    const image = await readImageField(form, 'image', { required: true });
    const scale = readNumber(form, 'scale', { min: 2, max: 4, fallback: 2, integer: true });

    if (scale !== 2 && scale !== 4) {
      return NextResponse.json({ error: '"scale" must be 2 or 4.' }, { status: 400 });
    }

    const result = await getProvider().upscale({ image: image!, scale });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
