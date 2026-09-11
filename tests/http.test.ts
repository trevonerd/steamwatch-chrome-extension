import { afterEach, describe, expect, it, vi } from "vitest";
import { requestWithPolicy } from "../src/utils/http.js";

function response(status: number, retryAfter?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(retryAfter ? { "Retry-After": retryAfter } : undefined),
    json: async () => ({ ok: true }),
  } as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("requestWithPolicy", () => {
  it("times out a response body that never resolves", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => new Promise<unknown>(() => undefined),
    })));

    const result = await requestWithPolicy({
      url: "https://api.example.test/hung-body",
      timeoutMs: 10,
      read: (res) => res.json(),
    });

    expect(result.kind).toBe("error");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("runs no more than three active requests for one origin", async () => {
    let active = 0;
    let maximum = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
      return response(200);
    }));

    const requests = Array.from({ length: 4 }, () => requestWithPolicy({
      url: "https://same-origin.example.test/data",
      read: (res) => res.json(),
    }));
    await Promise.resolve();
    await Promise.resolve();
    expect(maximum).toBe(3);
    release?.();
    await Promise.all(requests);
  });

  it("retries one transient server error", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200)));

    const result = await requestWithPolicy({
      url: "https://retry.example.test/data",
      read: (res) => res.json(),
    });

    expect(result).toMatchObject({ kind: "response", status: 200 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a network failure once after a short backoff", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(response(200)));

    const result = await requestWithPolicy({
      url: "https://network-retry.example.test/data",
      read: (res) => res.json(),
    });

    expect(result).toMatchObject({ kind: "response", status: 200 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("honors a long Retry-After cooldown without making another request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const retryAt = new Date("2026-01-01T00:01:00Z").toUTCString();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(429, retryAt))
      .mockResolvedValueOnce(response(200)));
    const request = {
      url: "https://cooldown.example.test/data",
      read: (res: Response) => res.json(),
    };

    expect(await requestWithPolicy(request)).toMatchObject({ kind: "http-error", status: 429 });
    expect(await requestWithPolicy(request)).toMatchObject({ kind: "http-error", status: 429 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect(await requestWithPolicy(request)).toMatchObject({ kind: "response", status: 200 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("records a Retry-After returned by the retry attempt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(429, "60")));
    const request = {
      url: "https://retry-cooldown.example.test/data",
      read: (res: Response) => res.json(),
    };
    const pending = requestWithPolicy(request);
    await vi.advanceTimersByTimeAsync(100);

    expect(await pending).toMatchObject({ kind: "http-error", status: 429 });
    expect(await requestWithPolicy(request)).toMatchObject({ kind: "http-error", status: 429 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the caller aborts an in-flight request", async () => {
    const source = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));

    const pending = requestWithPolicy({
      url: "https://caller-abort.example.test/data",
      init: { signal: source.signal },
      read: (res) => res.json(),
    });
    await Promise.resolve();
    source.abort();

    expect((await pending).kind).toBe("error");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a body decoding error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => { throw new SyntaxError("invalid JSON"); },
    })));

    const result = await requestWithPolicy({
      url: "https://invalid.example.test/data",
      read: (res) => res.json(),
    });

    expect(result.kind).toBe("error");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
