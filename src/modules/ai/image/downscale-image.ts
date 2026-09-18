import sharp from 'sharp';
import { AI_CONFIG } from '../ai.config';

export interface DownscaledImage {
  buffer: Buffer;
  mimeType: 'image/jpeg';
}

/**
 * Caps the longest side and re-encodes as JPEG so the vision request stays
 * inside typical model limits and does not pay for pixels the model will
 * downsample anyway (.cursorrules cost guidance).
 *
 * `rotate()` honours EXIF orientation first, otherwise a phone screenshot
 * taken in landscape can arrive sideways and the price becomes unreadable.
 */
export async function downscaleImage(imageBuffer: Buffer): Promise<DownscaledImage> {
  const buffer = await sharp(imageBuffer)
    .rotate()
    .resize({
      width: AI_CONFIG.maxImageDimensionPx,
      height: AI_CONFIG.maxImageDimensionPx,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: AI_CONFIG.jpegQuality, mozjpeg: true })
    .toBuffer();

  return { buffer, mimeType: 'image/jpeg' };
}
