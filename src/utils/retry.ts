export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  label?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 2;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const label = opts?.label ?? "operation";

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

  console.error(`[SteamWatch] ${label} failed after ${maxRetries} retries`);
  throw lastError;
}
