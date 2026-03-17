# SteamWatch Chrome Extension

[![Version](https://img.shields.io/badge/version-0.12.0-blue)](CHANGELOG.md)

Chrome extension for tracking Steam games with live player counts, local trend history, Twitch viewers, alerts, and quick popup insights.

> **Not affiliated with Valve Corporation or Steam®.**
> Built by [trevonerd](https://github.com/trevonerd) / TREVISOFT

---

## Features

- **Live Steam players** from the Steam Web API
- **24h peak** and **all-time peak**
- **Current Twitch viewers**
- **Local trend tracking** with sparkline history
- **24h average / gain-loss**
- **Dynamic Xd average / gain-loss** based on your retention setting
- **Trend notifications** with per-game overrides and quiet hours
- **Toolbar badge** for rising or alerting games
- **Favorite game badge** — pin any game to show its live player count directly on the toolbar icon (⭐)
- **Price drop alerts** — 💸 notification when a game goes on sale (configurable min % threshold)
- **Historical player count graph** — annotated chart in Options with 24h / 3d / retention windows
- **Smoothed trend %** in popup badge (3-vs-3 average, latest-change fallback)
- **Share cards** as text or image
- **CSV / JSON export**

---

## Install from source

```bash
git clone https://github.com/trevonerd/steamwatch-chrome-extension.git
cd steamwatch-chrome-extension
pnpm install
pnpm run build       # outputs to dist/
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

---

## Development

```bash
pnpm run dev         # Vite watch mode
pnpm test            # Vitest (289 tests)
pnpm run test:coverage
```

### Stack

| Layer | Tech |
|---|---|
| Language | TypeScript 5 (strict) |
| Bundler | Vite 5 + vite-plugin-web-extension |
| Validation | Zod |
| Testing | Vitest |
| Extension | Chrome MV3 |

### Project structure

```
src/
├── background/
│   ├── index.ts          Service worker — alarms, fetch loop, notifications, badge
│   └── fetchCycle.ts     Price data fetch + alert logic
├── popup/                Toolbar popup UI
│   ├── index.html
│   ├── main.ts
│   └── popup.css
├── options/              Options page (including History graph)
│   ├── index.html
│   ├── main.ts
│   └── options.css
├── types/index.ts        All shared TypeScript types
└── utils/
    ├── api.ts            Steam / SteamSpy / price HTTP fetchers (Zod-validated)
    ├── card.ts           CardViewModel factory — single source of display data
    ├── exporter.ts       CSV / JSON export
    ├── html.ts           XSS-safe helpers, show/hide
    ├── quietHours.ts     Quiet hours bitmask logic
    ├── share.ts          Share text + canvas image builder
    ├── sparkline.ts      SVG sparkline generator
    ├── storage.ts        chrome.storage.local abstraction
    └── trend.ts          Trend, spike, forecast, badge formatting
tests/                    289 Vitest unit tests
public/icons/             Extension icons (16/32/34/48/128px)
```

---

## Data sources

| Data | Source |
|---|---|
| Current players | `api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1` |
| All-time peak | `steamspy.com/api.php?request=appdetails` (+ local accumulation) |
| 24h peak | `steamcharts.com/app/{id}` |
| Twitch viewers | `gql.twitch.tv` |
| Game search | `store.steampowered.com/api/storesearch` |
| Game thumbnail | `cdn.akamai.steamstatic.com/steam/apps/{id}/capsule_sm_120.jpg` |
| Steam news | `api.steampowered.com/ISteamNews/GetNewsForApp/v2` |
| Price / discounts | `store.steampowered.com/api/appdetails` |

---

## License

MIT — © 2025 TREVISOFT
