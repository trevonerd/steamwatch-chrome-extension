export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  label?: string;
  warnOnly?: boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 2;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const label = opts?.label ?? "operation";
  const warnOnly = opts?.warnOnly ?? false;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(
          `[SteamWatch] ${label} attempt ${attempt + 1} failed:`,
          lastError
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  const logFn = warnOnly ? console.warn : console.error;
  logFn(`[SteamWatch] ${label} failed after ${maxRetries} retries`);
  throw lastError;
}
