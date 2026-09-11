import { describe, expect, it, vi } from "vitest";
import { RefreshError, requestRefresh } from "../src/utils/messages.js";

describe("requestRefresh", () => {
  it("explicitly requests failed-history retry for a manual refresh", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true });
    await requestRefresh(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "FETCH_NOW", retryHistory: true });
  });
  it("completes when the background acknowledges success", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true });
    await expect(requestRefresh()).resolves.toBeUndefined();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "FETCH_NOW" });
  });

  it("rejects when the background reports failure", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false, error: "Failed to persist data" });
    await expect(requestRefresh()).rejects.toThrow(RefreshError);
  });

  it.each([undefined, null, {}, { ok: "true" }, { ok: false }])("rejects when no valid success response arrives: %j", async (response) => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue(response);
    await expect(requestRefresh()).rejects.toThrow(RefreshError);
  });

  it("propagates a connection failure", async () => {
    const failure = new Error("Disconnected");
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValue(failure);
    await expect(requestRefresh()).rejects.toBe(failure);
  });
});
