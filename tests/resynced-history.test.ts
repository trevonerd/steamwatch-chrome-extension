import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshHistory } from "../src/background/historyBootstrap.js";
import { _resetDbForTesting, idbClearAllData, idbGetBootstrapStatus } from "../src/utils/idb-storage.js";

beforeEach(async () => { await idbClearAllData(); });
afterEach(async () => { vi.unstubAllGlobals(); await _resetDbForTesting(); });

describe("Resynced unavailable provider history", () => {
  it("records a successful empty history response as unavailable rather than a failed download", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    await refreshHistory("3751950");
    expect((await idbGetBootstrapStatus("3751950"))?.state).toBe("unavailable");
    expect((await chrome.storage.local.get("sw_history_revision"))["sw_history_revision"]).toBeGreaterThan(0);
  });
});
