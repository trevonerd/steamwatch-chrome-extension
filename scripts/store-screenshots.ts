// Regenerates Chrome Web Store screenshots (1280x800 PNG) from the real built extension in dist/.
// Game data is synthetic and seeded straight into chrome.storage + IndexedDB; Steam hosts are blocked
// so nothing is fetched. Run via `pnpm screenshots`; output lands in store-screenshots/.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";

const EXT = resolve(process.cwd(), "dist");
const OUT = resolve(process.cwd(), "store-screenshots");
const HOUR = 3_600_000;
const NOW = Date.now();
const END = Math.floor(NOW / HOUR) * HOUR;
const HISTORY_DAYS = 21;

// ── Synthetic data ───────────────────────────────────────────────────────────

interface Spec {
  appid: string;
  name: string;
  base: number; // typical evening peak
  short: string; // header art label; the card crops the art to 4:3
  hue: number; // header art colour
  /** Players now vs the same hours a week ago, applied to the last `hours` hours. */
  shift?: { factor: number; hours: number };
  twitch: number;
  ath: number;
  athLabel: string;
}

const SPECS: Spec[] = [
  {
    appid: "730",
    name: "Counter-Strike 2",
    short: "CS2",
    base: 1_450_000,
    hue: 32,
    twitch: 182_400,
    ath: 1_862_500,
    athLabel: "Mar 2025",
  },
  {
    appid: "570",
    name: "Dota 2",
    short: "DOTA 2",
    base: 720_000,
    hue: 4,
    twitch: 41_900,
    ath: 1_295_114,
    athLabel: "Mar 2016",
  },
  {
    appid: "1172470",
    name: "Apex Legends",
    short: "APEX",
    base: 205_000,
    hue: 350,
    shift: { factor: 1.18, hours: 26 },
    twitch: 23_600,
    ath: 624_473,
    athLabel: "May 2019",
  },
  {
    appid: "1808500",
    name: "ARC Raiders",
    short: "ARC",
    base: 214_000,
    hue: 18,
    shift: { factor: 0.55, hours: 30 },
    twitch: 38_200,
    ath: 481_900,
    athLabel: "Nov 2025",
  },
  {
    appid: "553850",
    name: "Helldivers 2",
    short: "HD2",
    base: 68_000,
    hue: 52,
    shift: { factor: 1.46, hours: 22 },
    twitch: 9_800,
    ath: 458_709,
    athLabel: "Feb 2024",
  },
  {
    appid: "1086940",
    name: "Baldur's Gate 3",
    short: "BG3",
    base: 71_000,
    hue: 262,
    twitch: 6_300,
    ath: 875_343,
    athLabel: "Aug 2023",
  },
];

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hourly(spec: Spec): { ts: number; current: number }[] {
  const rand = rng(Number(spec.appid));
  const rows: { ts: number; current: number }[] = [];
  for (let hour = END - HISTORY_DAYS * 24 * HOUR; hour < END; hour += HOUR) {
    const date = new Date(hour);
    const daily = 0.72 + 0.28 * Math.sin(((date.getUTCHours() - 14) / 24) * 2 * Math.PI);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 1.1 : 1;
    const shift = spec.shift && hour >= END - spec.shift.hours * HOUR ? spec.shift.factor : 1;
    const noise = 1 + (rand() - 0.5) * 0.06;
    rows.push({ ts: hour + 30 * 60_000, current: Math.round(spec.base * daily * weekend * shift * noise) });
  }
  return rows;
}

// Game header art as a data URI, so the popup needs no network.
function art(spec: Spec): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215" viewBox="0 0 460 215">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${spec.hue} 70% 46%)"/><stop offset="1" stop-color="hsl(${(spec.hue + 40) % 360} 60% 16%)"/>
    </linearGradient></defs>
    <rect width="460" height="215" fill="url(#g)"/>
    <text x="230" y="125" text-anchor="middle" font-family="Rajdhani, sans-serif" font-weight="700" font-size="90" fill="#fff" fill-opacity=".92">${spec.short}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const freshness = (source: string) => ({ source, status: "ok", acquiredAt: NOW, attemptedAt: NOW });

function seed(spec: Spec) {
  const rows = hourly(spec);
  const last24 = rows.slice(-24).map((row) => row.current);
  const current = Math.round((rows.at(-1)?.current ?? spec.base) * 1.01);
  return {
    game: { appid: spec.appid, name: spec.name, image: art(spec) },
    rows,
    cache: {
      current,
      peak24h: Math.max(...last24),
      allTimePeak: spec.ath,
      allTimePeakLabel: spec.athLabel,
      fetchedAt: NOW,
      twitchViewers: spec.twitch,
      freshness: {
        current: freshness("steam"),
        peak24h: freshness("steamspy"),
        allTimePeak: freshness("steamcharts"),
        twitchViewers: freshness("twitch"),
      },
    },
  };
}

const seeded = Object.fromEntries(SPECS.map((spec) => [spec.appid, seed(spec)]));

const SETTINGS = {
  notificationsEnabled: true,
  globalThresholdUp: 30,
  globalThresholdDown: -25,
  quietHoursEnabled: true,
  quietStart: "23:00",
  quietEnd: "07:00",
  quietDays: 0b1111111,
  badgeFavoriteAppid: "730",
};

// The crash starts 30h ago; the patch notes land a few hours earlier.
const NEWS = {
  fetchedAt: NOW,
  items: [
    {
      title: "Store Update 2.2.0",
      url: "https://store.steampowered.com/news/app/1808500",
      date: END - 33 * HOUR,
    },
  ],
};

// ── Slides ───────────────────────────────────────────────────────────────────

interface Slide {
  file: string;
  title: string; // <em> marks the accent words
  sub: string;
  page: "popup" | "options";
  appids?: string[]; // popup: games shown, in storage order
  act?: (page: Page) => Promise<void>;
  viewport?: { width: number; height: number };
}

const expand = (appid: string) => async (page: Page) => {
  await page.locator(`.game-card[data-appid="${appid}"] .btn-expand`).click();
  await page.waitForTimeout(900);
};
const openSection = (section: string) => async (page: Page) => {
  await page.locator(`.nav-item[data-section="${section}"]`).click();
  await page.waitForTimeout(300);
};

const slides: Slide[] = [
  {
    file: "1-overview",
    title: "Every game. <em>One glance.</em>",
    sub: "Live player counts, 24h peaks and Twitch viewers for the Steam games you follow.",
    page: "popup",
    appids: ["730", "570", "1172470", "553850", "1086940"],
  },
  {
    file: "2-history",
    title: "See the <em>trend</em>, not just the number.",
    sub: "Local history graphs show how players moved over the last day, week or month.",
    page: "popup",
    appids: ["730", "570"],
    act: expand("730"),
  },
  {
    file: "3-changes",
    title: "Spot <em>sudden changes</em>.",
    sub: "Big drops and surges are flagged against the same hours last week, with the Steam news behind them.",
    page: "popup",
    appids: ["1808500", "553850"],
    act: expand("1808500"),
  },
  {
    file: "4-alerts",
    title: "Alerts on <em>your terms</em>.",
    sub: "Get notified on trend changes or player thresholds. Quiet hours keep nights silent.",
    page: "options",
    viewport: { width: 880, height: 640 },
    act: openSection("notifications"),
  },
  {
    file: "5-games",
    title: "Up to <em>10 games</em>, one search.",
    sub: "Add games by name and pin a favorite to the toolbar badge. Your data stays local.",
    page: "options",
    appids: ["730", "570", "1172470", "1808500", "553850", "1086940"],
    viewport: { width: 880, height: 640 },
  },
];

// ── Browser plumbing ─────────────────────────────────────────────────────────

const BLOCKED = [
  "api.steampowered.com",
  "store.steampowered.com",
  "steamspy.com",
  "steamcharts.com",
  "games-popularity.com",
  "gql.twitch.tv",
  "*.steamstatic.com",
];

async function launch(profile: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    locale: "en-US",
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      `--host-resolver-rules=${BLOCKED.map((host) => `MAP ${host} ~NOTFOUND`).join(", ")}`,
    ],
  });
}

/** Writes games, cache, settings, news and hourly history; runs inside the extension's service worker. */
async function seedStorage(context: BrowserContext, appids: string[]): Promise<string> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const selected = appids.map((appid) => {
    const item = seeded[appid];
    if (!item) throw new Error(`unknown appid ${appid}`);
    return item;
  });
  await worker.evaluate(
    async ({ games, cache, rows, settings, news, now }) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        sw_games: games,
        sw_cache: cache,
        sw_settings: settings,
        sw_last_fetch: now,
        sw_last_fetch_attempt: now,
        sw_news_1808500: news,
      });
      const db = await new Promise<IDBDatabase>((resolveDb, reject) => {
        const request = indexedDB.open("steamwatch", 5);
        request.onupgradeneeded = () => {
          const d = request.result;
          if (!d.objectStoreNames.contains("snapshots")) {
            const store = d.createObjectStore("snapshots", { keyPath: "id", autoIncrement: true });
            store.createIndex("byApp", "appId");
            store.createIndex("byAppTime", ["appId", "ts"]);
          }
          if (!d.objectStoreNames.contains("cooldowns")) d.createObjectStore("cooldowns", { keyPath: "key" });
          if (!d.objectStoreNames.contains("bootstrapStates"))
            d.createObjectStore("bootstrapStates", { keyPath: "appId" });
          if (!d.objectStoreNames.contains("gameTombstones"))
            d.createObjectStore("gameTombstones", { keyPath: "appId" });
        };
        request.onsuccess = () => resolveDb(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(["snapshots", "bootstrapStates"], "readwrite");
      tx.objectStore("snapshots").clear();
      for (const [appId, series] of Object.entries(rows)) {
        for (const row of series)
          tx.objectStore("snapshots").add({ appId, ...row, source: "steamcharts", granularity: "hourly" });
        tx.objectStore("bootstrapStates").put({
          appId,
          state: "completed",
          attempt: 1,
          completedAt: now,
          importedCount: series.length,
        });
      }
      await new Promise<void>((resolveTx, reject) => {
        tx.oncomplete = () => resolveTx();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    {
      games: selected.map((item) => item.game),
      cache: Object.fromEntries(selected.map((item) => [item.game.appid, item.cache])),
      rows: Object.fromEntries(selected.map((item) => [item.game.appid, item.rows])),
      settings: SETTINGS,
      news: NEWS,
      now: NOW,
    },
  );
  return new URL(worker.url()).host;
}

async function frame(browser: Browser, shot: Buffer, slide: Slide): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const wide = slide.page === "options";
  const img = `<img src="data:image/png;base64,${shot.toString("base64")}" class="shot">`;
  await page.setContent(`<!doctype html><html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=DM+Sans:wght@400;500&display=swap">
    <style>
      *{box-sizing:border-box;margin:0}
      body{width:1280px;height:800px;overflow:hidden;position:relative;display:flex;
        flex-direction:${wide ? "column" : "row"};align-items:center;justify-content:center;gap:${wide ? 34 : 96}px;
        background:radial-gradient(circle at ${wide ? "50% 100%" : "78% 45%"},rgba(0,200,255,.22),transparent 55%),#080c15;
        font-family:'DM Sans',sans-serif;color:#e2e8f2}
      .brand{position:absolute;top:34px;left:44px;display:flex;align-items:center;gap:10px;color:#00c8ff;
        font:700 26px 'Rajdhani',sans-serif;letter-spacing:.5px}
      .brand span{color:#e2e8f2}.brand b{color:#00c8ff;font-weight:700}
      .copy{max-width:${wide ? 900 : 470}px;text-align:${wide ? "center" : "left"};${wide ? "margin-top:40px" : ""}}
      h1{font:700 ${wide ? 60 : 68}px/1.02 'Rajdhani',sans-serif;letter-spacing:-.5px;margin-bottom:18px}
      h1 em{font-style:normal;color:#00c8ff;text-shadow:0 0 28px rgba(0,200,255,.45)}
      p{font-size:${wide ? 22 : 23}px;line-height:1.4;color:#94a3b8}
      .shot{height:${wide ? 440 : 660}px;border-radius:14px;border:1px solid rgba(255,255,255,.12);
        box-shadow:0 0 70px rgba(0,200,255,.28),0 30px 60px rgba(0,0,0,.5)}
    </style></head><body>
    <div class="brand"><svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M12 3C7 3 3.5 7.5 2 12c1.5 4.5 5 9 10 9s8.5-4.5 10-9C20.5 7.5 17 3 12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="#080c15"/></svg>
      <span>Steam<b>Watch</b></span></div>
    <div class="copy"><h1>${slide.title}</h1><p>${slide.sub}</p></div>${img}
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const out = await page.screenshot({ type: "png" });
  await page.close();
  return out;
}

// ── Run ──────────────────────────────────────────────────────────────────────

await mkdir(OUT, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "steamwatch-shots-"));
const context = await launch(profile);
const framer = await chromium.launch({ channel: "chromium" });
try {
  for (const slide of slides) {
    const appids = slide.appids ?? SPECS.map((spec) => spec.appid);
    const id = await seedStorage(context, appids);
    const page = await context.newPage();
    await page.setViewportSize(slide.viewport ?? { width: 400, height: 640 });
    await page.goto(`chrome-extension://${id}/src/${slide.page}/index.html`);
    await page
      .locator(slide.page === "popup" ? ".game-card" : ".nav-item")
      .first()
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200); // history loads after the first paint
    await slide.act?.(page);
    if (slide.page === "popup")
      await page.setViewportSize({
        width: 400,
        height: await page.evaluate(() => document.documentElement.scrollHeight),
      });
    const shot = await page.screenshot({ type: "png", fullPage: slide.page === "popup" });
    await page.close();
    await writeFile(`${OUT}/${slide.file}.png`, await frame(framer, shot, slide));
    console.log(`wrote ${slide.file}.png`);
  }
} finally {
  await framer.close();
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
