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
  readonly priceOriginal?: number;
  readonly priceCurrent?: number;
  readonly discountPct?: number;
  readonly priceFormatted?: string;
  readonly priceOriginalFormatted?: string;
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
    priceOriginal,
    priceCurrent,
    discountPct,
    priceFormatted,
    priceOriginalFormatted,
  } = input;

  const prevLocalPeak = prevCache?.localAllTimePeak ?? prevCache?.current ?? 0;
  const localAllTimePeak = Math.max(prevLocalPeak, currentPlayers, allTimePeak ?? 0);

  // For price: if we received fresh price data (discountPct > 0) use it;
  // if discountPct is 0/null, clear sale fields (sale ended).
  // Carry forward only if we received no price data at all (null input).
  const hasFreshPrice = discountPct != null;
  const priceFields: Partial<CachedData> = hasFreshPrice && discountPct > 0
    ? {
        priceOriginal,
        priceCurrent,
        discountPct,
        ...(priceFormatted ? { priceFormatted } : {}),
        ...(priceOriginalFormatted ? { priceOriginalFormatted } : {}),
      }
    : hasFreshPrice
      ? {} // discountPct === 0: sale ended, clear cached price
      : {  // no fresh data: carry forward from prev cache
          ...(prevCache?.priceOriginal != null ? { priceOriginal: prevCache.priceOriginal } : {}),
          ...(prevCache?.priceCurrent  != null ? { priceCurrent:  prevCache.priceCurrent  } : {}),
          ...(prevCache?.discountPct   != null ? { discountPct:   prevCache.discountPct   } : {}),
          ...(prevCache?.priceFormatted         ? { priceFormatted:         prevCache.priceFormatted         } : {}),
          ...(prevCache?.priceOriginalFormatted ? { priceOriginalFormatted: prevCache.priceOriginalFormatted } : {}),
        };

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
    ...priceFields,
  };
}
