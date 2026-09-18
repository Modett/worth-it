import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { ITEM_CATEGORIES } from '../../items/item-category';
import { AI_CONFIG, LOW_CONFIDENCE_NULL_EXTRACTION } from '../ai.config';
import { OPENAI_CLIENT } from '../ai.constants';
import { downscaleImage } from '../image/downscale-image';
import { AiExtractionService, ExtractionResult } from '../interfaces/ai-extraction.interface';
import { ExtractionTimeoutError, withTimeout } from '../with-timeout';
import {
  EXTRACTION_JSON_SCHEMA,
  ModelExtractionPayload,
  parseModelExtractionPayload,
} from './parse-extraction-payload';

export interface ModelUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ModelCompletion {
  choices: Array<{ message?: { content?: string | null } }>;
  usage?: ModelUsage;
}

/**
 * The slice of the OpenAI client this provider actually uses. Keeping the
 * surface small is what lets unit tests inject a fake without constructing
 * the real SDK.
 */
export interface ExtractionModelClient {
  chat: {
    completions: {
      create: (
        body: ChatCompletionCreateParamsNonStreaming,
        options?: { timeout?: number; maxRetries?: number },
      ) => Promise<ModelCompletion>;
    };
  };
}

const SYSTEM_PROMPT = [
  'You extract a product the user is considering buying from a shopping screenshot.',
  'Return only JSON matching the provided schema.',
  'If a field is unreadable or not a product listing, use null.',
  `category must be one of: ${ITEM_CATEGORIES.join(', ')}, or null if unclear.`,
  'detectedSaleLanguage is true when the image uses urgency or discount phrasing.',
  'saleLanguagePhrases lists the exact phrases you saw (e.g. "LIMITED TIME", "70% OFF").',
  'uncertain is true when you are guessing, the image is not a product, or a required field is missing.',
  'Do not invent a price. currency is a 3-letter ISO 4217 code or null.',
].join(' ');

const USER_PROMPT = 'Extract the product details from this shopping screenshot.';

const MAX_ATTEMPTS = 1 + AI_CONFIG.extraAttemptsAfterFailure;

@Injectable()
export class OpenAiExtractionProvider implements AiExtractionService {
  private readonly logger = new Logger(OpenAiExtractionProvider.name);

  constructor(@Inject(OPENAI_CLIENT) private readonly client: ExtractionModelClient) {}

  async extractFromImage(input: {
    imageBuffer: Buffer;
    mimeType: string;
  }): Promise<ExtractionResult> {
    let downscaled: { buffer: Buffer; mimeType: 'image/jpeg' };
    try {
      downscaled = await downscaleImage(input.imageBuffer);
    } catch {
      this.logger.warn({ reason: 'downscale_failed' }, 'Screenshot downscale failed');
      return {
        ...LOW_CONFIDENCE_NULL_EXTRACTION,
        rawModelResponse: { reason: 'downscale_failed' },
      };
    }

    let lastRaw: unknown = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const completion = await withTimeout(
          this.client.chat.completions.create(this.buildRequest(downscaled), {
            timeout: AI_CONFIG.extractionTimeoutMs,
            maxRetries: 0,
          }),
          AI_CONFIG.extractionTimeoutMs,
        );
        lastRaw = sanitiseCompletion(completion);
        this.logUsage(completion.usage, attempt);

        const payload = parseCompletionContent(completion);
        if (!payload) {
          this.logger.warn(
            { attempt, reason: 'parse_failed' },
            'AI extraction response failed shape check',
          );
          continue;
        }

        return toExtractionResult(payload, lastRaw);
      } catch (error) {
        const reason = error instanceof ExtractionTimeoutError ? 'timeout' : 'provider_error';
        lastRaw = { reason, attempt };
        this.logger.warn({ attempt, reason }, 'AI extraction attempt failed');
      }
    }

    return { ...LOW_CONFIDENCE_NULL_EXTRACTION, rawModelResponse: lastRaw };
  }

  private buildRequest(image: {
    buffer: Buffer;
    mimeType: 'image/jpeg';
  }): ChatCompletionCreateParamsNonStreaming {
    const dataUrl = `data:${image.mimeType};base64,${image.buffer.toString('base64')}`;

    return {
      model: AI_CONFIG.extractionModel,
      max_completion_tokens: AI_CONFIG.maxCompletionTokens,
      reasoning_effort: 'minimal',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'product_extraction',
          strict: true,
          schema: EXTRACTION_JSON_SCHEMA,
        },
      },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: USER_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    };
  }

  private logUsage(usage: ModelUsage | undefined, attempt: number): void {
    if (!usage) {
      return;
    }

    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
    const estimatedCostUsd =
      (promptTokens * AI_CONFIG.pricingPerMillionTokens.input +
        completionTokens * AI_CONFIG.pricingPerMillionTokens.output) /
      1_000_000;

    // Identifiers and usage only — never the extracted product (.cursorrules §5).
    this.logger.log(
      {
        event: 'ai.extraction.usage',
        provider: 'openai',
        model: AI_CONFIG.extractionModel,
        attempt,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd,
      },
      'AI extraction usage',
    );
  }
}

function parseCompletionContent(completion: ModelCompletion): ModelExtractionPayload | null {
  const content = completion.choices[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }

  return parseModelExtractionPayload(parsed);
}

function toExtractionResult(payload: ModelExtractionPayload, raw: unknown): ExtractionResult {
  const missingRequired =
    payload.productName === null || payload.price === null || payload.category === null;

  return {
    productName: payload.productName,
    brand: payload.brand,
    price: payload.price,
    currency: payload.currency,
    category: payload.category,
    detectedSaleLanguage: payload.detectedSaleLanguage,
    saleLanguagePhrases: payload.saleLanguagePhrases,
    confidence: payload.uncertain || missingRequired ? 'low' : 'high',
    rawModelResponse: raw,
  };
}

/**
 * The raw SDK object can include the echoed prompt (and therefore the image
 * data URL). We keep only the model's reply and usage for later tuning.
 */
function sanitiseCompletion(completion: ModelCompletion): unknown {
  return {
    content: completion.choices[0]?.message?.content ?? null,
    usage: completion.usage ?? null,
  };
}
