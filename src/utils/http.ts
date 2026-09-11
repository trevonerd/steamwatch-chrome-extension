const MAX_CONCURRENT_REQUESTS_PER_ORIGIN = 3;
const DEFAULT_TIMEOUT_MS = 12_000;
const RETRY_DELAY_MS = 100;
const MAX_IMMEDIATE_RETRY_AFTER_MS = 250;

export interface HttpRequest<T> {
  readonly url: string;
  readonly init?: RequestInit;
  readonly read: (response: Response) => Promise<T>;
  readonly timeoutMs?: number;
}

export type HttpRequestResult<T> =
  | { readonly kind: "response"; readonly status: number; readonly value: T }
  | { readonly kind: "http-error"; readonly status: number }
  | { readonly kind: "error"; readonly error: string };

class RequestTimeoutError extends Error {
  public constructor() {
    super("request timed out");
  }
}

class ResponseBodyError extends Error {
  public constructor(cause: unknown) {
    super(errorMessage(cause));
  }
}

const activeByOrigin = new Map<string, number>();
const waitingByOrigin = new Map<string, (() => void)[]>();
const cooldownUntilByOrigin = new Map<string, number>();

export async function requestWithPolicy<T>(request: HttpRequest<T>): Promise<HttpRequestResult<T>> {
  const origin = new URL(request.url).origin;
  if (isCoolingDown(origin)) return { kind: "http-error", status: 429 };
  await acquireOriginSlot(origin);
  try {
    if (isCoolingDown(origin)) return { kind: "http-error", status: 429 };
    return await runAttemptWithRetry(request, origin);
  } finally {
    releaseOriginSlot(origin);
  }
}

async function runAttemptWithRetry<T>(request: HttpRequest<T>, origin: string): Promise<HttpRequestResult<T>> {
  const first = await runAttempt(request);
  if (!shouldRetry(first)) return publicResult(first);

  if (first.kind === "http-error" && first.status === 429) {
    const retryAfterMs = recordCooldown(origin, first.retryAfter);
    if (retryAfterMs > MAX_IMMEDIATE_RETRY_AFTER_MS) {
      return publicResult(first);
    }
    await delay(retryAfterMs || RETRY_DELAY_MS);
  } else {
    await delay(RETRY_DELAY_MS);
  }
  if (isCoolingDown(origin)) return { kind: "http-error", status: 429 };
  const second = await runAttempt(request);
  if (second.kind === "http-error" && second.status === 429) {
    recordCooldown(origin, second.retryAfter);
  }
  return publicResult(second);
}

type AttemptResult<T> = {
  readonly kind: "response";
  readonly status: number;
  readonly value: T;
} | {
  readonly kind: "http-error";
  readonly status: number;
  readonly retryAfter: string | null;
} | {
  readonly kind: "error";
  readonly error: string;
  readonly retryable: boolean;
};

async function runAttempt<T>(request: HttpRequest<T>): Promise<AttemptResult<T>> {
  const controller = new AbortController();
  const sourceSignal = request.init?.signal;
  const abortFromSource = () => controller.abort();
  sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
  if (sourceSignal?.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new RequestTimeoutError());
      }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    });
    const operation = async (): Promise<AttemptResult<T>> => {
      let response: Response;
      try {
        response = await fetch(request.url, { ...request.init, signal: controller.signal });
      } catch (error) {
        return { kind: "error", error: errorMessage(error), retryable: !sourceSignal?.aborted };
      }
      if (!response.ok) {
        return {
          kind: "http-error",
          status: response.status,
          retryAfter: response.headers?.get("Retry-After") ?? null,
        };
      }
      try {
        const value = await request.read(response);
        return { kind: "response", status: response.status, value };
      } catch (error) {
        return { kind: "error", error: new ResponseBodyError(error).message, retryable: false };
      }
    };
    return await Promise.race([operation(), timeout]);
  } catch (error) {
    return { kind: "error", error: errorMessage(error), retryable: !sourceSignal?.aborted };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    sourceSignal?.removeEventListener("abort", abortFromSource);
  }
}

function shouldRetry<T>(result: AttemptResult<T>): boolean {
  if (result.kind === "error") return result.retryable;
  return result.kind === "http-error" && (result.status === 429 || result.status >= 500);
}

function publicResult<T>(result: AttemptResult<T>): HttpRequestResult<T> {
  if (result.kind === "response") return result;
  if (result.kind === "http-error") return { kind: "http-error", status: result.status };
  return { kind: "error", error: result.error };
}

function retryAfterDelay(retryAfter: string | null): number {
  if (retryAfter === null) return 0;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}

function recordCooldown(origin: string, retryAfter: string | null): number {
  const delayMs = retryAfterDelay(retryAfter);
  if (delayMs > 0) cooldownUntilByOrigin.set(origin, Date.now() + delayMs);
  return delayMs;
}

function isCoolingDown(origin: string): boolean {
  const until = cooldownUntilByOrigin.get(origin);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  cooldownUntilByOrigin.delete(origin);
  return false;
}

function acquireOriginSlot(origin: string): Promise<void> {
  const active = activeByOrigin.get(origin) ?? 0;
  if (active < MAX_CONCURRENT_REQUESTS_PER_ORIGIN) {
    activeByOrigin.set(origin, active + 1);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const waiting = waitingByOrigin.get(origin) ?? [];
    waiting.push(resolve);
    waitingByOrigin.set(origin, waiting);
  });
}

function releaseOriginSlot(origin: string): void {
  const waiting = waitingByOrigin.get(origin);
  if (waiting !== undefined) {
    const next = waiting.shift();
    if (next !== undefined) {
      if (waiting.length === 0) waitingByOrigin.delete(origin);
      next();
      return;
    }
  }
  const active = activeByOrigin.get(origin) ?? 1;
  if (active <= 1) activeByOrigin.delete(origin);
  else activeByOrigin.set(origin, active - 1);
}

function delay(ms: number): Promise<void> {
  return ms === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "request failed";
}
