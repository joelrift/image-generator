import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { CONTROL_TYPES } from '@/lib/preprocess';
import { getProvider } from '@/lib/providers';
import type { StylePreset } from '@/lib/providers/types';
import {
  readEnum,
  readImageField,
  readLimitedFormData,
  readMaterials,
  readNumber,
  readString,
} from '@/lib/validate';

const STYLES: readonly StylePreset[] = ['realistic', 'watercolor', 'vector'];

/**
 * POST /api/generate — ControlNet-conditioned generation.
 *
 * Expects multipart form data:
 *   image          (file, required)  sketch or 3D screenshot
 *   prompt         (string, required)
 *   controlType    depth | softedge | scribble | canny
 *   controlStrength 0..1
 *   style          realistic | watercolor | vector
 *   numImages      1..8
 *   width, height  px
 *   styleRefImage  (file, optional)  Phase 4
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await readLimitedFormData(request);

    const image = await readImageField(form, 'image', { required: true });
    const styleRefImage = await readImageField(form, 'styleRefImage');
    const materials = await readMaterials(form);

    const result = await getProvider('generate').generate({
      image: image!,
      prompt: readString(form, 'prompt', { required: true, maxLength: 2000 }),
      controlType: readEnum(form, 'controlType', CONTROL_TYPES, 'depth'),
      controlStrength: readNumber(form, 'controlStrength', { min: 0, max: 1, fallback: 0.8 }),
      style: readEnum(form, 'style', STYLES, 'realistic'),
      styleRefImage,
      materials,
      lockMaterials: readString(form, 'lockMaterials') !== 'false',
      numImages: readNumber(form, 'numImages', { min: 1, max: 8, fallback: 4, integer: true }),
      width: readNumber(form, 'width', { min: 256, max: 2048, fallback: 1024, integer: true }),
      height: readNumber(form, 'height', { min: 256, max: 2048, fallback: 576, integer: true }),
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
