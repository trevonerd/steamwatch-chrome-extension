// tests/retry.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry } from "../src/utils/retry.js";

describe("withRetry", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValueOnce("success");
    const result = await withRetry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds on second attempt", async () => {
    const fn = vi.fn();
    fn.mockRejectedValueOnce(new Error("fail 1"));
    fn.mockResolvedValueOnce("success");

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 1000 });
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past first retry delay
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    const result = await promise;
    expect(result).toBe("success");
  });

  it("retries with exponential backoff", async () => {
    const fn = vi.fn();
    fn.mockRejectedValueOnce(new Error("fail 1"));
    fn.mockRejectedValueOnce(new Error("fail 2"));
    fn.mockResolvedValueOnce("success");

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 1000 });

    // First attempt fails immediately
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance 1000ms (2^0 * 1000)
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    // Advance 2000ms (2^1 * 1000)
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toBe("success");
  });

  it("throws original error after max retries exhausted", async () => {
    const originalError = new Error("persistent failure");
    const fn = vi.fn().mockRejectedValue(originalError);

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 1000 });
    promise.catch(() => {}); // suppress unhandled rejection during timer advancement

    // First attempt
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance 1000ms for first retry
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    // Advance 2000ms for second retry
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);

    await expect(promise).rejects.toBe(originalError);
  });

  it("uses default maxRetries of 2", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const promise = withRetry(fn, { baseDelayMs: 100 });
    promise.catch(() => {}); // suppress unhandled rejection during timer advancement

    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(3);

    await expect(promise).rejects.toThrow();
  });

  it("uses default baseDelayMs of 1000", async () => {
    const fn = vi.fn();
    fn.mockRejectedValueOnce(new Error("fail"));
    fn.mockResolvedValueOnce("success");

    const promise = withRetry(fn);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result).toBe("success");
  });

  it("logs warnings on each retry with label", async () => {
    const fn = vi.fn();
    fn.mockRejectedValueOnce(new Error("fail 1"));
    fn.mockRejectedValueOnce(new Error("fail 2"));
    fn.mockResolvedValueOnce("success");

    const promise = withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 100,
      label: "testOp",
    });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      "[SteamWatch] testOp attempt 1 failed:",
      expect.any(Error)
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      "[SteamWatch] testOp attempt 2 failed:",
      expect.any(Error)
    );

  });

  it("logs warnings with 'operation' label when label not provided", async () => {
    const fn = vi.fn();
    fn.mockRejectedValueOnce(new Error("fail"));
    fn.mockResolvedValueOnce("success");

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 100 });

    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(warnSpy).toHaveBeenCalledWith(
      "[SteamWatch] operation attempt 1 failed:",
      expect.any(Error)
    );

  });

  it("logs error on final failure with label", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent"));

    const promise = withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 100,
      label: "fetchData",
    });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      "[SteamWatch] fetchData failed after 2 retries"
    );

  });

  it("logs warn (not error) on final failure when warnOnly is true", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent"));

    const promise = withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 100,
      label: "ITAD:lookupGame",
      warnOnly: true,
    });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).rejects.toThrow();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenLastCalledWith(
      "[SteamWatch] ITAD:lookupGame failed after 2 retries"
    );

  });

  it("logs error on final failure with default 'operation' label", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent"));

    const promise = withRetry(fn, { maxRetries: 1, baseDelayMs: 100 });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      "[SteamWatch] operation failed after 1 retries"
    );

  });

  it("preserves generic type through retries", async () => {
    interface TestData {
      id: number;
      name: string;
    }

    const fn = vi.fn<[], Promise<TestData>>();
    fn.mockResolvedValueOnce({ id: 1, name: "test" });

    const result = await withRetry(fn);

    expect(result.id).toBe(1);
    expect(result.name).toBe("test");
  });

  it("handles async function that returns a value", async () => {
    const fn = async () => {
      return { data: "value" };
    };

    const result = await withRetry(fn);
    expect(result).toEqual({ data: "value" });
  });
});
