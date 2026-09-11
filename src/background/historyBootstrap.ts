import { fetchPlayerHistoryResult } from "../utils/api.js";
import {
  idbAcquireBootstrapLease,
  idbCompleteBootstrapImport,
  idbFailBootstrapLease,
} from "../utils/idb-storage.js";
import { formatError } from "../utils/log.js";

/** A lease survives worker restarts and makes overlapping history requests harmless. */
export async function refreshHistory(appId: string, retryFailed = false): Promise<boolean> {
  const lease = await idbAcquireBootstrapLease(appId, Date.now(), 120_000, retryFailed);
  if (!lease) return false;

  try {
    const result = await fetchPlayerHistoryResult(appId);
    if (result.status === "unavailable") {
      await idbFailBootstrapLease(lease, Date.now() + 6 * 3_600_000, "unavailable");
      await chrome.storage.local.set({ sw_history_revision: Date.now() });
      return false;
    }
    if (result.status === "ok") {
      const completed = await idbCompleteBootstrapImport(lease, result.value);
      if (completed) {
        try {
          await chrome.storage.local.set({ sw_history_revision: Date.now() });
        } catch (error: unknown) {
          console.warn(`[SteamWatch] History revision publish failed for appid ${appId}: ${formatError(error)}`);
        }
        return true;
      }
    }
    if (result.status === "error") console.warn(`[SteamWatch] History request failed for appid ${appId}: ${result.error}`);
  } catch (error: unknown) {
    console.warn(`[SteamWatch] History import failed for appid ${appId}: ${formatError(error)}`);
  }

  const delay = Math.min(6 * 3_600_000, 15 * 60_000 * 2 ** Math.min(lease.attempt - 1, 5));
  await idbFailBootstrapLease(lease, Date.now() + delay);
  await chrome.storage.local.set({ sw_history_revision: Date.now() });
  return false;
}
