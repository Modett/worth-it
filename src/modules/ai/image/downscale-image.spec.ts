import sharp from 'sharp';
import { AI_CONFIG } from '../ai.config';
import { downscaleImage } from './downscale-image';

describe('downscaleImage', () => {
  it('caps the longest side at the configured vision-model limit', async () => {
    const oversized = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 20, g: 20, b: 20 } },
    })
      .png()
      .toBuffer();

    const result = await downscaleImage(oversized);
    const metadata = await sharp(result.buffer).metadata();

    expect(result.mimeType).toBe('image/jpeg');
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(AI_CONFIG.maxImageDimensionPx);
    expect(metadata.format).toBe('jpeg');
  });

  it('does not enlarge an image already inside the cap', async () => {
    const small = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 20, g: 20, b: 20 } },
    })
      .png()
      .toBuffer();

    const result = await downscaleImage(small);
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.width).toBe(400);
    expect(metadata.height).toBe(300);
  });
});
