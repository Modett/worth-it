import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AiExtractionProviderName, EnvironmentVariables } from '../../config/env.validation';
import { AI_CONFIG } from './ai.config';
import { AI_EXTRACTION_SERVICE, OPENAI_CLIENT } from './ai.constants';
import { AiExtractionService } from './interfaces/ai-extraction.interface';
import {
  ExtractionModelClient,
  OpenAiExtractionProvider,
} from './providers/openai-extraction.provider';

@Module({
  providers: [
    {
      provide: OPENAI_CLIENT,
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ): ExtractionModelClient =>
        new OpenAI({
          apiKey: configService.get('AI_EXTRACTION_API_KEY', { infer: true }),
          timeout: AI_CONFIG.extractionTimeoutMs,
          maxRetries: 0,
        }),
    },
    OpenAiExtractionProvider,
    {
      provide: AI_EXTRACTION_SERVICE,
      inject: [ConfigService, OpenAiExtractionProvider],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
        openai: OpenAiExtractionProvider,
      ): AiExtractionService => {
        const provider = configService.get('AI_EXTRACTION_PROVIDER', { infer: true });
        return resolveExtractionProvider(provider, openai);
      },
    },
  ],
  exports: [AI_EXTRACTION_SERVICE],
})
export class AiModule {}

/**
 * The single place a new extraction implementation is wired. Feature modules
 * inject `AI_EXTRACTION_SERVICE` and never name a concrete class.
 */
function resolveExtractionProvider(
  provider: AiExtractionProviderName,
  openai: OpenAiExtractionProvider,
): AiExtractionService {
  switch (provider) {
    case 'openai':
      return openai;
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported AI extraction provider: ${String(exhaustive)}`);
    }
  }
}
