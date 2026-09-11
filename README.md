# SteamWatch Chrome Extension

[![Changelog](https://img.shields.io/badge/changelog-latest-blue)](CHANGELOG.md)

Chrome extension for tracking Steam games with live player counts, local graph history, Twitch viewers, notifications, and quick popup insights.

> Not affiliated with Valve Corporation or Steam.
> Built by [trevonerd](https://github.com/trevonerd) / TREVISOFT

---

## Features

- Live Steam player counts from the Steam Web API
- Provider-reported 24h and all-time peaks, distinct from observed maxima
- Current Twitch viewers
- Local player tracking every 5 minutes
- 60-day local graph retention
- Popup sparklines and expanded player graphs
- Period averages, changes and extrema with explicit historical coverage
- Weekly activity: last seven days versus the preceding seven, matching hours and weekdays
- Preliminary daily activity for limited history, with absolute changes for tiny baselines
- Player-count notifications with per-game overrides and quiet hours
- Toolbar badge for rising or alerting games
- Favorite game badge for showing one live count on the toolbar icon
- Share cards as text or image
- Up to 10 tracked games

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
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

---

## Development

```bash
pnpm run dev         # Vite watch mode
pnpm test            # Vitest
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

```text
src/
├── background/
│   ├── index.ts          Service worker - alarms, tracking loop, notifications, badge
│   └── fetchCycle.ts     Player data fetch cycle and notification logic
├── popup/                Toolbar popup UI with cards, sparklines, graphs, sharing
│   ├── index.html
│   ├── main.ts
│   └── popup.css
├── options/              Lean settings page: Games, Notifications, About
│   ├── index.html
│   ├── main.ts
│   └── options.css
├── types/index.ts        Shared TypeScript types and Zod schemas
└── utils/
    ├── api.ts            Steam, SteamSpy, SteamCharts, Twitch fetchers
    ├── card.ts           CardViewModel factory for popup display data
    ├── html.ts           XSS-safe DOM helpers
    ├── idb-storage.ts    IndexedDB wrapper for player snapshots and cooldowns
    ├── log.ts            Typed log formatting helpers
    ├── migrate.ts        chrome.storage.local to IndexedDB migration
    ├── quietHours.ts     Quiet hours bitmask logic
    ├── share.ts          Share text and canvas image builder
    ├── sparkline.ts      Graph window and SVG point helpers
    ├── storage.ts        chrome.storage.local abstraction and constants
    └── trend.ts          Trend and badge formatting
tests/                    Vitest unit tests
public/icons/             Extension icons
```

---

## Data sources

| Data | Source |
|---|---|
| Current players | `api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1` |
| All-time peak | SteamCharts, when available; observed maxima are labeled separately |
| 24h peak | `steamcharts.com/app/{id}` |
| Hourly history | SteamCharts, with Games Popularity fallback |
| Twitch viewers | `gql.twitch.tv` |
| Game search | `store.steampowered.com/api/storesearch` |
| Game thumbnail | `cdn.akamai.steamstatic.com/steam/apps/{id}/capsule_sm_120.jpg` |

---

## Freshness and interpretation

The popup shows cache immediately, refreshes counts older than 60 seconds and polls while open. Background tracking runs every five minutes while Chrome and the device are available. This is periodic polling, not a streaming feed. Offline periods and sleeping devices can leave gaps; historical imports fill only what providers actually offer.

Graph periods become available when observations meet their coverage requirements. `All` means available retained history, up to 60 days, not the entire lifetime of a game. Missing values remain unavailable rather than becoming zero.

The weekly percentage compares mean concurrent players over two matched weeks. It does not measure unique users lost or establish why activity changed. Trend alerts require sufficient coverage and agreement on at least five days. Before sufficient weekly history exists, daily comparisons are labeled preliminary and never trigger trend alerts; absolute player thresholds remain available.

See [privacy](PRIVACY.md), [final validation](docs/final-beta-validation.md), and [lifecycle checks](docs/lifecycle-validation.md) for operational details and release limits.

---

## License

MIT - © 2025 TREVISOFT
