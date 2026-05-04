import type { CachedData, Game } from "../types/index.js";

export interface CycleCacheResult {
  readonly game: Game;
  readonly cacheData?: CachedData;
}

export interface BuildCachedDataInput {
  readonly currentPlayers: number;
  readonly peak24h?: number;
  readonly allTimePeak?: number;
  readonly allTimePeakLabel?: string;
  readonly prevCache?: CachedData;
  readonly fetchedAt: number;
  readonly twitchViewers: number | null;
}

export function mergeCycleCache(
  prevCache: Record<string, CachedData>,
  results: readonly CycleCacheResult[],
): Record<string, CachedData> {
  const nextCache: Record<string, CachedData> = { ...prevCache };
  for (const result of results) {
    if (result.cacheData) {
      nextCache[result.game.appid] = result.cacheData;
    }
  }
  return nextCache;
}

export function buildCachedData(input: BuildCachedDataInput): CachedData {
  const {
    currentPlayers,
    peak24h,
    allTimePeak,
    allTimePeakLabel,
    prevCache,
    fetchedAt,
    twitchViewers,
  } = input;

  const prevLocalPeak = prevCache?.localAllTimePeak ?? prevCache?.current ?? 0;
  const localAllTimePeak = Math.max(prevLocalPeak, currentPlayers, allTimePeak ?? 0);

  return {
    current: currentPlayers,
    ...(peak24h != null
      ? { peak24h }
      : prevCache?.peak24h != null
        ? { peak24h: prevCache.peak24h }
        : {}),
    ...(allTimePeak != null
      ? { allTimePeak }
      : prevCache?.allTimePeak != null
        ? { allTimePeak: prevCache.allTimePeak }
        : {}),
    ...(allTimePeakLabel
      ? { allTimePeakLabel }
      : prevCache?.allTimePeakLabel
        ? { allTimePeakLabel: prevCache.allTimePeakLabel }
        : {}),
    localAllTimePeak,
    fetchedAt,
    ...(twitchViewers != null
      ? { twitchViewers }
      : prevCache?.twitchViewers != null
        ? { twitchViewers: prevCache.twitchViewers }
        : {}),
  };
}
