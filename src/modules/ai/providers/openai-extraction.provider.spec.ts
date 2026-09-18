import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AI_CONFIG } from '../ai.config';
import { OPENAI_CLIENT } from '../ai.constants';
import { downscaleImage } from '../image/downscale-image';
import { ItemCategory } from '../../items/item-category';
import {
  ExtractionModelClient,
  ModelCompletion,
  OpenAiExtractionProvider,
} from './openai-extraction.provider';

jest.mock('../image/downscale-image', () => ({
  downscaleImage: jest.fn(),
}));

const downscaleImageMock = downscaleImage as jest.MockedFunction<typeof downscaleImage>;

const DOWNSCALED = Buffer.from('downscaled-jpeg');

const VALID_PAYLOAD = {
  productName: 'Runner 2 Trail Shoes',
  brand: 'Nike',
  price: 129.99,
  currency: 'USD',
  category: ItemCategory.FASHION,
  detectedSaleLanguage: true,
  saleLanguagePhrases: ['LIMITED TIME'],
  uncertain: false,
};

describe('OpenAiExtractionProvider', () => {
  let provider: OpenAiExtractionProvider;
  let create: jest.MockedFunction<ExtractionModelClient['chat']['completions']['create']>;

  beforeEach(async () => {
    create = jest.fn();
    downscaleImageMock.mockReset();
    downscaleImageMock.mockResolvedValue({ buffer: DOWNSCALED, mimeType: 'image/jpeg' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        OpenAiExtractionProvider,
        {
          provide: OPENAI_CLIENT,
          useValue: { chat: { completions: { create } } },
        },
      ],
    }).compile();

    provider = moduleRef.get(OpenAiExtractionProvider);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('parses a valid JSON response into a high-confidence result', async () => {
    create.mockResolvedValue(completionWithContent(JSON.stringify(VALID_PAYLOAD)));

    const result = await provider.extractFromImage({
      imageBuffer: Buffer.from('original'),
      mimeType: 'image/png',
    });

    expect(result).toMatchObject({
      productName: 'Runner 2 Trail Shoes',
      brand: 'Nike',
      price: 129.99,
      currency: 'USD',
      category: ItemCategory.FASHION,
      detectedSaleLanguage: true,
      saleLanguagePhrases: ['LIMITED TIME'],
      confidence: 'high',
    });
    expect(result.rawModelResponse).toEqual({
      content: JSON.stringify(VALID_PAYLOAD),
      usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
    });
  });

  it('sends the downscaled JPEG, not the original buffer', async () => {
    create.mockResolvedValue(completionWithContent(JSON.stringify(VALID_PAYLOAD)));

    await provider.extractFromImage({
      imageBuffer: Buffer.from('original-png'),
      mimeType: 'image/png',
    });

    expect(downscaleImageMock).toHaveBeenCalledWith(Buffer.from('original-png'));
    const [body] = create.mock.calls[0] as unknown as [{ messages: unknown[] }];
    const userMessage = body.messages[1] as {
      content: Array<{ type: string; image_url?: { url: string } }>;
    };
    const imageUrl = userMessage.content.find((part) => part.type === 'image_url')?.image_url?.url;
    expect(imageUrl).toBe(`data:image/jpeg;base64,${DOWNSCALED.toString('base64')}`);
  });

  it('retries malformed JSON once, then falls back to low-confidence nulls', async () => {
    create
      .mockResolvedValueOnce(completionWithContent('this is not json'))
      .mockResolvedValueOnce(completionWithContent('still not json'));

    const result = await provider.extractFromImage({
      imageBuffer: Buffer.from('original'),
      mimeType: 'image/png',
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      productName: null,
      brand: null,
      price: null,
      currency: null,
      category: null,
      detectedSaleLanguage: false,
      saleLanguagePhrases: [],
      confidence: 'low',
    });
  });

  it('succeeds on the retry after a malformed first response', async () => {
    create
      .mockResolvedValueOnce(completionWithContent('{'))
      .mockResolvedValueOnce(completionWithContent(JSON.stringify(VALID_PAYLOAD)));

    const result = await provider.extractFromImage({
      imageBuffer: Buffer.from('original'),
      mimeType: 'image/png',
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.confidence).toBe('high');
    expect(result.productName).toBe('Runner 2 Trail Shoes');
  });

  it('treats a timeout the same as a parse failure: retry, then low-confidence nulls', async () => {
    jest.useFakeTimers();
    create.mockReturnValue(new Promise<ModelCompletion>(() => undefined));

    const resultPromise = provider.extractFromImage({
      imageBuffer: Buffer.from('original'),
      mimeType: 'image/png',
    });

    await jest.advanceTimersByTimeAsync(AI_CONFIG.extractionTimeoutMs);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(AI_CONFIG.extractionTimeoutMs);

    await expect(resultPromise).resolves.toMatchObject({
      productName: null,
      confidence: 'low',
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('logs token usage without the extracted product', async () => {
    create.mockResolvedValue(completionWithContent(JSON.stringify(VALID_PAYLOAD)));

    await provider.extractFromImage({
      imageBuffer: Buffer.from('original'),
      mimeType: 'image/png',
    });

    const logged = JSON.stringify((Logger.prototype.log as jest.Mock).mock.calls as unknown[][]);
    expect(logged).toContain('ai.extraction.usage');
    expect(logged).toContain('promptTokens');
    expect(logged).not.toContain('Runner 2 Trail Shoes');
    expect(logged).not.toContain('129.99');
  });

  it('returns low confidence when the model is uncertain even if fields are present', async () => {
    create.mockResolvedValue(
      completionWithContent(JSON.stringify({ ...VALID_PAYLOAD, uncertain: true })),
    );

    const result = await provider.extractFromImage({
      imageBuffer: Buffer.from('original'),
      mimeType: 'image/png',
    });

    expect(result.confidence).toBe('low');
    expect(result.productName).toBe('Runner 2 Trail Shoes');
  });

  it('falls back when downscale fails rather than crashing the request', async () => {
    downscaleImageMock.mockRejectedValue(new Error('corrupt image'));

    const result = await provider.extractFromImage({
      imageBuffer: Buffer.from('nope'),
      mimeType: 'image/png',
    });

    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ confidence: 'low', productName: null });
  });
});

function completionWithContent(content: string): ModelCompletion {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
  };
}
