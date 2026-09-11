import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchBootstrap: vi.fn(),
  acquireLease: vi.fn(),
  completeImport: vi.fn(),
  failLease: vi.fn(),
  storageSet: vi.fn(),
}));

vi.mock("../src/utils/api.js", () => ({ fetchPlayerHistoryResult: mocks.fetchBootstrap }));
vi.mock("../src/utils/idb-storage.js", () => ({
  idbAcquireBootstrapLease: mocks.acquireLease,
  idbCompleteBootstrapImport: mocks.completeImport,
  idbFailBootstrapLease: mocks.failLease,
}));

import { refreshHistory } from "../src/background/historyBootstrap.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("chrome", { storage: { local: { set: mocks.storageSet } } });
  mocks.acquireLease.mockResolvedValue({ appId: "1", token: "lease", expiresAt: 1, attempt: 1 });
  mocks.completeImport.mockResolvedValue(true);
  mocks.fetchBootstrap.mockResolvedValue({ status: "ok", value: [{ ts: 1, current: 50, source: "steamcharts", granularity: "hourly" }] });
  mocks.storageSet.mockResolvedValue(undefined);
});

describe("refreshHistory", () => {
  it("publishes a revision after a successful durable history import", async () => {
    await expect(refreshHistory("1")).resolves.toBe(true);

    expect(mocks.acquireLease).toHaveBeenCalledWith("1", expect.any(Number), 120_000, false);
    expect(mocks.completeImport).toHaveBeenCalledTimes(1);
    expect(mocks.storageSet).toHaveBeenCalledWith({ sw_history_revision: expect.any(Number) });
  });
});
