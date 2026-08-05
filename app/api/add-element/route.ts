import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { getProvider } from '@/lib/providers';
import { readImageField, readString } from '@/lib/validate';

/**
 * POST /api/add-element — the "add something" branch of the region editor
 * (Phase 3). Routed to Nano Banana Pro / Gemini image, which matches
 * perspective and lighting when inserting an element.
 *
 * Expects multipart form data:
 *   image  (file, required)
 *   mask   (file, optional)  language alone is often enough here
 *   prompt (string, required) e.g. "add a pergola here"
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await request.formData();

    const image = await readImageField(form, 'image', { required: true });
    const mask = await readImageField(form, 'mask');

    const result = await getProvider().addElement({
      image: image!,
      mask,
      prompt: readString(form, 'prompt', { required: true, maxLength: 2000 }),
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
