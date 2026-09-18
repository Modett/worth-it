/** Injection token for the swappable screenshot-extraction implementation. */
export const AI_EXTRACTION_SERVICE = Symbol('AI_EXTRACTION_SERVICE');

/**
 * The OpenAI SDK client. Tests replace this rather than the extraction
 * service so the provider's parse/retry/timeout behaviour can be exercised
 * without a network call.
 */
export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');
