import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AI_EXTRACTION_SERVICE, OPENAI_CLIENT } from './ai.constants';
import { AiModule } from './ai.module';
import { AiExtractionService } from './interfaces/ai-extraction.interface';
import { OpenAiExtractionProvider } from './providers/openai-extraction.provider';

describe('AiModule', () => {
  it('binds the extraction token to the OpenAI provider, not a class consumers import', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              AI_EXTRACTION_API_KEY: 'test-key',
              AI_EXTRACTION_PROVIDER: 'openai',
            }),
          ],
        }),
        AiModule,
      ],
    })
      .overrideProvider(OPENAI_CLIENT)
      .useValue({ chat: { completions: { create: jest.fn() } } })
      .compile();

    const extracted = moduleRef.get<AiExtractionService>(AI_EXTRACTION_SERVICE);
    expect(extracted).toBeInstanceOf(OpenAiExtractionProvider);
  });

  it('lets a fake provider replace the token without touching the OpenAI class', async () => {
    const fake: AiExtractionService = {
      extractFromImage: jest.fn().mockResolvedValue({
        productName: null,
        brand: null,
        price: null,
        currency: null,
        category: null,
        detectedSaleLanguage: false,
        saleLanguagePhrases: [],
        confidence: 'low',
        rawModelResponse: null,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ AI_EXTRACTION_API_KEY: 'test-key', AI_EXTRACTION_PROVIDER: 'openai' })],
        }),
        AiModule,
      ],
    })
      .overrideProvider(AI_EXTRACTION_SERVICE)
      .useValue(fake)
      .compile();

    expect(moduleRef.get(AI_EXTRACTION_SERVICE)).toBe(fake);
  });
});
