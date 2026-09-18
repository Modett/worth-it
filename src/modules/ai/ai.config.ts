/**
 * Single versioned source of truth for AI extraction tunables (.cursorrules
 * §3). Bump `version` whenever a model, timeout or image cap changes so a
 * cost or latency shift is traceable in git.
 *
 * The live provider name lives in `AI_EXTRACTION_PROVIDER` (env), not here:
 * swapping GPT-5 Mini for a future Gemini implementation is a config change
 * plus a factory branch, not a hunt through feature modules.
 */
export const AI_CONFIG = {
  version: 1,

  /**
   * Cheap vision tier. GPT-5 Mini is the current OpenAI extraction-class
   * model; the locked stack's GPT-4o-mini is its predecessor. Structured
   * outputs (json_schema) keep the response parseable without a regex scrape.
   */
  extractionModel: 'gpt-5-mini',

  /**
   * Per-attempt ceiling. A hung provider must not pin an HTTP worker; the
   * caller gets a low-confidence empty result instead.
   */
  extractionTimeoutMs: 10_000,

  /** Initial try plus this many retries after a parse failure or timeout. */
  extraAttemptsAfterFailure: 1,

  /**
   * Longest side sent to the model. 1568px is a common vision-model limit;
   * anything larger is spend with no extra OCR.
   */
  maxImageDimensionPx: 1568,

  /** Re-encode as JPEG at this quality after resize, which is cheaper to send. */
  jpegQuality: 80,

  /**
   * Approximate USD per million tokens, used only to log an estimated cost
   * when the SDK returns usage. Not billed from this figure.
   */
  pricingPerMillionTokens: {
    input: 0.25,
    output: 2.0,
  },

  /** Enough for the extraction JSON; the model must not ramble. */
  maxCompletionTokens: 800,
} as const;

export const LOW_CONFIDENCE_NULL_EXTRACTION = {
  productName: null,
  brand: null,
  price: null,
  currency: null,
  category: null,
  detectedSaleLanguage: false,
  saleLanguagePhrases: [] as string[],
  confidence: 'low' as const,
};
