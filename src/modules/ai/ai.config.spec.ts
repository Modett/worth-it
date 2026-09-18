import { AI_CONFIG } from './ai.config';

describe('AI_CONFIG', () => {
  it('caps a vision request at a common model limit', () => {
    expect(AI_CONFIG.maxImageDimensionPx).toBe(1568);
  });

  it('times out an extraction well inside a mobile request budget', () => {
    expect(AI_CONFIG.extractionTimeoutMs).toBe(10_000);
    expect(AI_CONFIG.extraAttemptsAfterFailure).toBe(1);
  });
});
