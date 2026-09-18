export class ExtractionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI extraction timed out after ${timeoutMs}ms`);
    this.name = 'ExtractionTimeoutError';
  }
}

/**
 * Bound a provider call so a hung SDK cannot pin the request. The original
 * promise is not cancelled (the SDK has no universal abort); we just stop
 * waiting for it.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExtractionTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
