import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSteamNews, newsForChange } from "../src/utils/news.js";

const now = Date.UTC(2026, 9, 21, 12);
const hour = 3_600_000;

describe("Steam news", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  it("keeps official announcements only and caches them for three hours", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        appnews: {
          newsitems: [
            {
              title: "Patch 1.4",
              url: "https://store.steampowered.com/news/1",
              date: (now - hour) / 1000,
              feed_type: 1,
            },
            { title: "Press review", url: "https://example.test/review", date: now / 1000, feed_type: 0 },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const items = await getSteamNews("1", now);
    expect(items).toEqual([{ title: "Patch 1.4", url: "https://store.steampowered.com/news/1", date: now - hour }]);
    await getSteamNews("1", now + 2 * hour);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("links news from the 48 hours before a change, newest first", () => {
    const change = {
      startTs: now,
      lastTs: now + 6 * hour,
      direction: "drop" as const,
      pct: -40,
      hours: 7,
      ongoing: true,
    };
    const item = (title: string, date: number) => ({ title, url: "https://store.steampowered.com/news", date });
    expect(
      newsForChange(
        [item("too old", now - 49 * hour), item("patch", now - 20 * hour), item("hotfix", now - hour)],
        change,
      ).map((news) => news.title),
    ).toEqual(["hotfix", "patch"]);
  });
});
