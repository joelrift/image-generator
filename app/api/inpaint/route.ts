import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { getProvider } from '@/lib/providers';
import { readImageField, readString } from '@/lib/validate';

/**
 * POST /api/inpaint — the "change this" branch of the region editor (Phase 3).
 *
 * Expects multipart form data:
 *   image  (file, required)  the finished render being edited
 *   mask   (file, optional)  white = edit, black = keep (PNG from MaskEditor).
 *                            With a mask the change is bounded to it; without
 *                            one it applies from the instruction over the image.
 *   prompt (string, required)
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await request.formData();

    const image = await readImageField(form, 'image', { required: true });
    const mask = await readImageField(form, 'mask');

    const result = await getProvider('edit').inpaint({
      image: image!,
      mask,
      prompt: readString(form, 'prompt', { required: true, maxLength: 2000 }),
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
