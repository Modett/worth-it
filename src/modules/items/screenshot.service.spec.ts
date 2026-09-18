import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ItemSource, ItemStatus } from '../../generated/prisma/client';
import { AI_EXTRACTION_SERVICE } from '../ai/ai.constants';
import { AiExtractionService, ExtractionResult } from '../ai/interfaces/ai-extraction.interface';
import { OBJECT_STORAGE } from '../../storage/object-storage.constants';
import { ObjectStorageService } from '../../storage/object-storage.interface';
import { ItemResponseDto } from './dto/item-response.dto';
import { ItemCategory } from './item-category';
import { ItemsService } from './items.service';
import { canAutoCreate, ScreenshotService } from './screenshot.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const IMAGE_URL =
  'https://cdn.example.test/users/11111111-1111-4111-8111-111111111111/screenshots/shot.jpg';

const FILE = {
  buffer: Buffer.from('png-bytes'),
  mimetype: 'image/png',
} as Express.Multer.File;

function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    productName: 'Runner 2 Trail Shoes',
    brand: 'Nike',
    price: 129.99,
    currency: 'USD',
    category: ItemCategory.FASHION,
    detectedSaleLanguage: true,
    saleLanguagePhrases: ['LIMITED TIME'],
    confidence: 'high',
    rawModelResponse: { secret: 'do-not-leak' },
    ...overrides,
  };
}

const createdItem: ItemResponseDto = {
  id: '33333333-3333-4333-8333-333333333333',
  source: ItemSource.SCREENSHOT,
  sourceUrl: null,
  imageUrl: IMAGE_URL,
  productName: 'Runner 2 Trail Shoes',
  brand: 'Nike',
  category: ItemCategory.FASHION,
  price: 129.99,
  detectedSaleLanguage: true,
  discoveredAt: '2026-09-17T00:00:00.000Z',
  status: ItemStatus.WISHLIST,
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
};

describe('ScreenshotService', () => {
  let service: ScreenshotService;
  let extractionService: { extractFromImage: jest.Mock };
  let objectStorage: { upload: jest.Mock };
  let itemsService: { create: jest.Mock };

  beforeEach(async () => {
    extractionService = { extractFromImage: jest.fn() };
    objectStorage = { upload: jest.fn().mockResolvedValue({ url: IMAGE_URL }) };
    itemsService = { create: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ScreenshotService,
        { provide: AI_EXTRACTION_SERVICE, useValue: extractionService },
        { provide: OBJECT_STORAGE, useValue: objectStorage },
        { provide: ItemsService, useValue: itemsService },
      ],
    }).compile();

    service = moduleRef.get(ScreenshotService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses whatever is bound to AI_EXTRACTION_SERVICE, not a concrete provider class', async () => {
    const swapped: AiExtractionService = {
      extractFromImage: jest
        .fn()
        .mockResolvedValue(extraction({ confidence: 'low', productName: null })),
    };
    const storage: ObjectStorageService = {
      upload: jest.fn().mockResolvedValue({ url: IMAGE_URL }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ScreenshotService,
        { provide: AI_EXTRACTION_SERVICE, useValue: swapped },
        { provide: OBJECT_STORAGE, useValue: storage },
        { provide: ItemsService, useValue: itemsService },
      ],
    }).compile();

    await moduleRef.get(ScreenshotService).capture(USER_ID, FILE);

    expect(swapped.extractFromImage).toHaveBeenCalledWith({
      imageBuffer: FILE.buffer,
      mimeType: FILE.mimetype,
    });
    expect(itemsService.create).not.toHaveBeenCalled();
  });

  it('auto-creates an item when extraction is high-confidence and complete', async () => {
    extractionService.extractFromImage.mockResolvedValue(extraction());
    itemsService.create.mockResolvedValue(createdItem);

    const result = await service.capture(USER_ID, FILE);

    const [[uploadArg]] = objectStorage.upload.mock.calls as [
      [{ key: string; body: Buffer; mimeType: string }],
    ];
    expect(uploadArg.body).toEqual(FILE.buffer);
    expect(uploadArg.mimeType).toBe('image/png');
    expect(uploadArg.key).toMatch(new RegExp(`^users/${USER_ID}/screenshots/[0-9a-f-]+\\.png$`));
    expect(itemsService.create).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        source: ItemSource.SCREENSHOT,
        imageUrl: IMAGE_URL,
        productName: 'Runner 2 Trail Shoes',
        price: 129.99,
        category: ItemCategory.FASHION,
        detectedSaleLanguage: true,
      }),
    );
    expect(result).toMatchObject({ autoCreated: true, imageUrl: IMAGE_URL, item: createdItem });
    expect(result.extraction).not.toHaveProperty('rawModelResponse');
    expect(JSON.stringify(result)).not.toContain('do-not-leak');
  });

  it('returns a draft and creates nothing when confidence is low', async () => {
    extractionService.extractFromImage.mockResolvedValue(
      extraction({ confidence: 'low', productName: null, price: null, category: null }),
    );

    const result = await service.capture(USER_ID, FILE);

    expect(itemsService.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      autoCreated: false,
      imageUrl: IMAGE_URL,
      item: null,
      extraction: { confidence: 'low', productName: null },
    });
  });

  it('logs identifiers only, never the product or price', async () => {
    extractionService.extractFromImage.mockResolvedValue(extraction());
    itemsService.create.mockResolvedValue(createdItem);

    await service.capture(USER_ID, FILE);

    const logged = JSON.stringify((Logger.prototype.log as jest.Mock).mock.calls as unknown[][]);
    expect(logged).toContain(USER_ID);
    expect(logged).not.toContain('Runner 2 Trail Shoes');
    expect(logged).not.toContain('129.99');
  });
});

describe('canAutoCreate', () => {
  it('requires high confidence and the three fields an Item cannot be born without', () => {
    expect(canAutoCreate(extraction())).toBe(true);
    expect(canAutoCreate(extraction({ confidence: 'low' }))).toBe(false);
    expect(canAutoCreate(extraction({ productName: null }))).toBe(false);
    expect(canAutoCreate(extraction({ price: null }))).toBe(false);
    expect(canAutoCreate(extraction({ category: null }))).toBe(false);
  });
});
