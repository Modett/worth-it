import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp, NEST_FACTORY_OPTIONS } from '../src/app.setup';
import { ErrorResponse } from '../src/common/filters/error-response.interface';
import { AI_EXTRACTION_SERVICE } from '../src/modules/ai/ai.constants';
import {
  AiExtractionService,
  ExtractionResult,
} from '../src/modules/ai/interfaces/ai-extraction.interface';
import { AuthTokensDto } from '../src/modules/auth/dto/auth-tokens.dto';
import { ScreenshotCaptureResponseDto } from '../src/modules/items/dto/screenshot-capture-response.dto';
import { ItemCategory } from '../src/modules/items/item-category';
import { ITEMS_CONFIG } from '../src/modules/items/items.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { OBJECT_STORAGE } from '../src/storage/object-storage.constants';

const PASSWORD = 'correct-horse-battery';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const HIGH_CONFIDENCE: ExtractionResult = {
  productName: 'Runner 2 Trail Shoes',
  brand: 'Nike',
  price: 129.99,
  currency: 'USD',
  category: ItemCategory.FASHION,
  detectedSaleLanguage: true,
  saleLanguagePhrases: ['LIMITED TIME'],
  confidence: 'high',
  rawModelResponse: { content: 'must-not-reach-the-client' },
};

const LOW_CONFIDENCE: ExtractionResult = {
  productName: null,
  brand: null,
  price: null,
  currency: null,
  category: null,
  detectedSaleLanguage: false,
  saleLanguagePhrases: [],
  confidence: 'low',
  rawModelResponse: { content: 'must-not-reach-the-client' },
};

describe('POST /items/from-screenshot (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prismaService: PrismaService;
  let extractFromImage: jest.MockedFunction<AiExtractionService['extractFromImage']>;
  let upload: jest.Mock;

  beforeAll(async () => {
    extractFromImage = jest.fn();
    upload = jest.fn();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_EXTRACTION_SERVICE)
      .useValue({ extractFromImage })
      .overrideProvider(OBJECT_STORAGE)
      .useValue({ upload })
      .compile();

    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>(NEST_FACTORY_OPTIONS),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prismaService = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    extractFromImage.mockReset();
    upload.mockReset();
    upload.mockImplementation(() =>
      Promise.resolve({ url: `https://cdn.example.test/screenshots/${randomUUID()}.jpg` }),
    );
  });

  function uniqueEmail(): string {
    return `shopper-${randomUUID()}@example.com`;
  }

  function uniqueClientIp(): string {
    const octet = (): number => 1 + Math.floor(Math.random() * 254);
    return `10.${octet()}.${octet()}.${octet()}`;
  }

  async function registerUser(): Promise<AuthTokensDto> {
    const email = uniqueEmail();

    await request(server)
      .post('/api/v1/auth/signup')
      .set('X-Forwarded-For', uniqueClientIp())
      .send({ email, password: PASSWORD })
      .expect(201);

    const response = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', uniqueClientIp())
      .send({ email, password: PASSWORD })
      .expect(200);

    return response.body as AuthTokensDto;
  }

  function postScreenshot(
    accessToken: string,
    ip: string,
    file = TINY_PNG,
    filename = 'shot.png',
    type = 'image/png',
  ) {
    return request(server)
      .post('/api/v1/items/from-screenshot')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Forwarded-For', ip)
      .attach(ITEMS_CONFIG.screenshot.fieldName, file, { filename, contentType: type });
  }

  it('creates and returns an item on a high-confidence extraction', async () => {
    const tokens = await registerUser();
    extractFromImage.mockResolvedValue(HIGH_CONFIDENCE);

    const response = await postScreenshot(tokens.accessToken, uniqueClientIp()).expect(201);
    const body = response.body as ScreenshotCaptureResponseDto;

    expect(body.autoCreated).toBe(true);
    expect(body.imageUrl).toEqual(expect.stringContaining('https://cdn.example.test/screenshots/'));
    expect(body.item).toMatchObject({
      source: 'SCREENSHOT',
      imageUrl: body.imageUrl,
      productName: 'Runner 2 Trail Shoes',
      price: 129.99,
      category: 'FASHION',
      detectedSaleLanguage: true,
      status: 'WISHLIST',
    });
    expect(JSON.stringify(body)).not.toContain('must-not-reach-the-client');
    await expect(prismaService.item.count({ where: { id: body.item?.id } })).resolves.toBe(1);
  });

  it('returns a draft and creates nothing on a low-confidence extraction', async () => {
    const tokens = await registerUser();
    extractFromImage.mockResolvedValue(LOW_CONFIDENCE);

    const response = await postScreenshot(tokens.accessToken, uniqueClientIp()).expect(200);
    const body = response.body as ScreenshotCaptureResponseDto;

    expect(body).toMatchObject({
      autoCreated: false,
      item: null,
      extraction: { confidence: 'low', productName: null },
    });
    expect(body.imageUrl).toEqual(expect.stringContaining('https://cdn.example.test/screenshots/'));
    expect(JSON.stringify(body)).not.toContain('must-not-reach-the-client');
    await expect(prismaService.item.count({ where: { imageUrl: body.imageUrl } })).resolves.toBe(0);
  });

  it('rejects an unsupported mime type with a 400', async () => {
    const tokens = await registerUser();

    const response = await postScreenshot(
      tokens.accessToken,
      uniqueClientIp(),
      TINY_PNG,
      'notes.pdf',
      'application/pdf',
    ).expect(400);

    expect((response.body as ErrorResponse).error).toBe('Bad Request');
    expect(extractFromImage).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects an oversized upload with a 400', async () => {
    const tokens = await registerUser();
    const oversized = Buffer.alloc(ITEMS_CONFIG.screenshot.maxUploadBytes + 1);

    const response = await postScreenshot(
      tokens.accessToken,
      uniqueClientIp(),
      oversized,
      'huge.png',
      'image/png',
    ).expect(400);

    expect((response.body as ErrorResponse).message).toEqual(
      expect.stringContaining(String(ITEMS_CONFIG.screenshot.maxUploadBytes)),
    );
    expect(extractFromImage).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with a 401', async () => {
    const response = await request(server)
      .post('/api/v1/items/from-screenshot')
      .set('X-Forwarded-For', uniqueClientIp())
      .attach(ITEMS_CONFIG.screenshot.fieldName, TINY_PNG, {
        filename: 'shot.png',
        contentType: 'image/png',
      })
      .expect(401);

    expect(response.body as ErrorResponse).toMatchObject({
      statusCode: 401,
      error: 'Unauthorized',
      path: '/api/v1/items/from-screenshot',
    });
  });

  it('throttles a sixth screenshot from the same IP', async () => {
    const tokens = await registerUser();
    extractFromImage.mockResolvedValue(LOW_CONFIDENCE);
    const ip = uniqueClientIp();

    for (let attempt = 1; attempt <= ITEMS_CONFIG.screenshotThrottle.limit; attempt += 1) {
      await postScreenshot(tokens.accessToken, ip).expect(200);
    }

    const rejected = await postScreenshot(tokens.accessToken, ip).expect(429);
    expect(rejected.body as ErrorResponse).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
      path: '/api/v1/items/from-screenshot',
    });
  });
});
