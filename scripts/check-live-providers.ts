import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { fetchAppDetails, fetchCurrentPlayers, fetchSteamChartsHistoryResult, fetchSteamChartsResult, fetchTwitchResult } from "../src/utils/api.js";
import { buildCardViewModel } from "../src/utils/card.js";
import { analyzeSeasonalTrend } from "../src/utils/seasonal.js";
import type { CachedData } from "../src/types/index.js";

// Opt-in live diagnostic; never part of the deterministic test suite.
const pool = ["570", "730", "440", "105600", "413150", "1091500", "1245620", "1086940", "1172470", "252490", "892970", "646570", "1145360", "250900", "620", "400", "431960", "221100", "289070", "703080"];
const output = resolve(process.argv[2] ?? ".sisyphus/evidence/beta6/live");

async function main(): Promise<void> {
  await mkdir(output, { recursive: true });
  const selected: string[] = ["3751950", "242050"];
  const remaining = [...pool];
  while (selected.length < 10) selected.push(...remaining.splice(randomInt(remaining.length), 1));
  await writeFile(resolve(output, "selection.json"), JSON.stringify({ startedAt: new Date().toISOString(), pool, selected }, null, 2));
  const originalFetch = globalThis.fetch;
  let requestNumber = 0;
  const requests: { url: string; status: number; bodyFile: string; acquiredAt: string }[] = [];
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const bodyFile = `${++requestNumber}.body`;
    await writeFile(resolve(output, bodyFile), await response.clone().text());
    requests.push({ url: String(input), status: response.status, bodyFile, acquiredAt: new Date().toISOString() });
    return response;
  };
  const results = [];
  try {
    for (const appid of selected) {
      const details = await fetchAppDetails(appid);
      const [current, charts, history] = await Promise.all([fetchCurrentPlayers(appid), fetchSteamChartsResult(appid), fetchSteamChartsHistoryResult(appid)]);
      const twitch = details ? await fetchTwitchResult(details.name) : { status: "unavailable" };
      const now = Date.now();
      const snapshots = history.status === "ok" ? history.value : [];
      const cached: CachedData = { current: current ?? 0, fetchedAt: now,
        ...(charts.status === "ok" && charts.value.peak24h !== undefined ? { peak24h: charts.value.peak24h } : {}),
        ...(charts.status === "ok" && charts.value.allTimePeak !== undefined ? { allTimePeak: charts.value.allTimePeak } : {}),
        freshness: { allTimePeak: { source: "steamcharts", status: charts.status, attemptedAt: now, ...(charts.status === "ok" ? { acquiredAt: now } : {}) } },
      };
      const vm = buildCardViewModel({ appid, name: details?.name ?? appid, image: details?.image ?? "" }, { [appid]: cached }, snapshots, 60, now);
      if (current !== null) assert.equal(vm.current, current);
      const replay = Array.from({ length: 7 }, (_, day) => {
        const at = now - day * 86_400_000;
        const analysis = analyzeSeasonalTrend(snapshots, at);
        return { at, status: analysis.status, ...(analysis.status === "ready" ? { pct: analysis.trend.pct } : {}) };
      });
      const row = { appid, name: details?.name, current, charts, twitch, historyStatus: history.status,
        points: snapshots.length, hourlyPoints: snapshots.filter((point) => point.granularity === "hourly").length,
        latest: snapshots.at(-1)?.ts, windows: vm.availableGraphWindows.map((window) => window.key),
        average24h: vm.avg24h, trend: vm.seasonalAnalysis, replay,
      };
      results.push(row);
      await writeFile(resolve(output, "results.json"), JSON.stringify({ checkedAt: new Date().toISOString(), results, requests }, null, 2));
      process.stdout.write(`${JSON.stringify(row)}\n`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await writeFile(resolve(output, "requests.json"), JSON.stringify(requests, null, 2));
  }
}
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Live check failed"}\n`); process.exitCode = 1; });
