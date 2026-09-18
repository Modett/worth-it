import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ItemSource } from '../../generated/prisma/client';
import { AI_EXTRACTION_SERVICE } from '../ai/ai.constants';
import { AiExtractionService, ExtractionResult } from '../ai/interfaces/ai-extraction.interface';
import { OBJECT_STORAGE } from '../../storage/object-storage.constants';
import { ObjectStorageService } from '../../storage/object-storage.interface';
import { CreateItemDto } from './dto/create-item.dto';
import {
  ScreenshotCaptureResponseDto,
  ScreenshotExtractionDto,
} from './dto/screenshot-capture-response.dto';
import { ItemCategory } from './item-category';
import { ITEMS_CONFIG } from './items.config';
import { ItemsService } from './items.service';

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

type AutoCreateExtraction = ExtractionResult & {
  productName: string;
  price: number;
  category: ItemCategory;
};

@Injectable()
export class ScreenshotService {
  private readonly logger = new Logger(ScreenshotService.name);

  constructor(
    @Inject(AI_EXTRACTION_SERVICE) private readonly extractionService: AiExtractionService,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorageService,
    private readonly itemsService: ItemsService,
  ) {}

  async capture(userId: string, file: Express.Multer.File): Promise<ScreenshotCaptureResponseDto> {
    const { url: imageUrl } = await this.objectStorage.upload({
      key: screenshotObjectKey(userId, file.mimetype),
      body: file.buffer,
      mimeType: file.mimetype,
    });

    const extraction = await this.extractionService.extractFromImage({
      imageBuffer: file.buffer,
      mimeType: file.mimetype,
    });
    const publicExtraction = ScreenshotExtractionDto.fromExtraction(extraction);

    if (!canAutoCreate(extraction)) {
      this.logger.log(
        { userId, autoCreated: false, confidence: extraction.confidence },
        'Screenshot captured',
      );
      return ScreenshotCaptureResponseDto.preview(imageUrl, publicExtraction);
    }

    const item = await this.itemsService.create(userId, autoCreateDto(extraction, imageUrl));
    this.logger.log({ userId, itemId: item.id, autoCreated: true }, 'Screenshot item auto-created');
    return ScreenshotCaptureResponseDto.created(imageUrl, publicExtraction, item);
  }
}

export function screenshotObjectKey(userId: string, mimeType: string): string {
  const extension = MIME_EXTENSION[mimeType] ?? 'jpg';
  return `users/${userId}/screenshots/${randomUUID()}.${extension}`;
}

/**
 * High confidence is not enough on its own: the extracted fields still have to
 * satisfy CreateItemDto, otherwise we would write a row the confirm path
 * could not. Rounding the price to cents is the only coercion — everything
 * else must already be valid.
 */
export function canAutoCreate(result: ExtractionResult): result is AutoCreateExtraction {
  if (result.confidence !== 'high') {
    return false;
  }
  if (result.productName === null || result.price === null || result.category === null) {
    return false;
  }

  const productName = result.productName.trim();
  if (
    productName.length < ITEMS_CONFIG.productName.minLength ||
    productName.length > ITEMS_CONFIG.productName.maxLength
  ) {
    return false;
  }

  if (result.brand !== null && result.brand.length > ITEMS_CONFIG.brand.maxLength) {
    return false;
  }

  const price = roundToCents(result.price);
  return price >= ITEMS_CONFIG.price.min && price <= ITEMS_CONFIG.price.max;
}

function autoCreateDto(result: AutoCreateExtraction, imageUrl: string): CreateItemDto {
  return {
    source: ItemSource.SCREENSHOT,
    imageUrl,
    productName: result.productName.trim(),
    brand: result.brand,
    category: result.category,
    price: roundToCents(result.price),
    detectedSaleLanguage: result.detectedSaleLanguage,
  };
}

function roundToCents(price: number): number {
  return Math.round(price * 100) / 100;
}
