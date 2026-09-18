import { ExtractionTimeoutError, withTimeout } from './with-timeout';

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves when the work finishes inside the budget', async () => {
    const resultPromise = withTimeout(Promise.resolve('ok'), 1_000);

    await expect(resultPromise).resolves.toBe('ok');
  });

  it('rejects with ExtractionTimeoutError when the work hangs', async () => {
    const resultPromise = withTimeout(new Promise<string>(() => undefined), 1_000);

    const assertion = expect(resultPromise).rejects.toBeInstanceOf(ExtractionTimeoutError);
    await jest.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});
