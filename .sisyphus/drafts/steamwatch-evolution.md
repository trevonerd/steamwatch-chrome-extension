# Draft: SteamWatch Evolution — Interactive Charts, Historical DB, Smart Filters

## Requirements (confirmed from user)
- Hover interattivo sui grafici grandi (expanded panel) — mostrare valore del punto in hover
- Tracciare il record negativo (punto più basso) — sia generale che per finestra temporale
- Filtri temporali standard: 24h, 3d, 7d, 15d, 1 mese, "da sempre"
- DB locale per persistere le info dei giochi tracciati — ma senza esplodere dopo 1 anno
- Aperto a consigli su altri filtri utili

## Current Architecture (from exploration)
- **Framework**: Vanilla TS, no React/Vue — DOM manipulation diretta
- **Charts**: SVG sparklines custom (no Chart.js/D3) — `sparkline.ts`
- **Two chart sizes**: Compact (160×36) in card list, Expanded (372×56) in detail panel
- **Current filters**: 24h, 3d, retention window (configurable 3-30 days, default 7)
- **Storage**: chrome.storage.local — key-value (sw_games, sw_snaps_{appid}, sw_cache, sw_settings)
- **Max games**: 5 (MAX_GAMES constant)
- **Snapshot retention**: 3-30 days configurable, auto-purge on fetch
- **APIs used**: Steam player counts, SteamCharts (scraping), SteamSpy, Twitch GQL, Steam Store (prices)
- **No hover/tooltip** on sparklines currently — purely decorative

## Technical Decisions
- (pending) Storage strategy for long-term data
- (pending) Whether to integrate ITAD API for historical prices
- (pending) Data compaction strategy
- (pending) Chart library vs keep custom SVG

## Research Findings

### Storage Options
- **chrome.storage.local**: 10MB default, unlimited with permission. BAD for time-series (full re-serialization on every write)
- **IndexedDB**: Virtually unlimited (~80% disk), indexed range queries, works in MV3 service workers. GOOD for time-series
- **Recommended**: Hybrid — chrome.storage.local for settings/quick cache, IndexedDB for historical time-series
- **idb library**: 1.8KB gzipped, thin promise wrapper, battle-tested

### Data Retention Math
- 1 check/day × 100 games × 365 days = ~1.5 MB/year (very manageable)
- With player count snapshots (every 15 min): 100 games × 96/day × 365 = ~35K records/year
- Tiered compaction: recent=full resolution, 30d+=daily aggregates, 90d+=weekly aggregates

### ITAD API (IsThereAnyDeal)
- Has full historical price data (multi-year!)
- `games/lookup/v1`: Steam AppID → ITAD UUID
- `games/prices/history/v2`: Full price change log
- `games/prices/historyLow/v1`: All-time lowest price
- ToS: OK for complementary extensions, NOT for competitors
- Could bootstrap price history without local accumulation

### How Keepa/Others Do It
- Keepa = thin client, data lives on servers — NOT local
- For a local-only extension, IndexedDB + compaction is the standard

## Decisions (Round 1)
- **Record negativo** = minimo giocatori online (NOT prezzo). Per finestra temporale + all-time.
- **Limite giochi** = resta 5. No cambiamenti.
- **ITAD API** = SÌ, integrare per storico prezzi. Bootstrap history da ITAD, poi append locale.
- **Chart library** = SVG custom + hover. No librerie esterne. Mantieni leggerezza.
- **Retention** = ILLIMITATA. I filtri sono "viste" sui dati, non cancellano nulla.
  - Eliminare il setting purgeAfterDays attuale
  - Migrare da chrome.storage.local (per snapshots) a IndexedDB
  - Compaction automatica: recente=piena risoluzione, vecchio=aggregati giornalieri/settimanali

## Implications of Decisions
- **IndexedDB migration**: sw_snaps_{appid} va spostato in IndexedDB con compound index [appId, timestamp]
- **Compaction strategy needed**: senza purge, serve una strategia per non far crescere il DB all'infinito
- **ITAD integration**: serve API key?, mapping AppID→ITAD UUID, caching strategy
- **Hover system**: mousemove listener su SVG, nearest-point calculation, tooltip DOM element
- **New filters**: 24h, 3d, 7d, 15d, 1m, "da sempre" — sostituiscono i 3 tab attuali (24h, 3d, retention)

## Decisions (Round 2)
- **Tooltip** = solo conteggio giocatori (es: "1,234"), no data/ora. Minimale.
- **UI filtri** = tab/pill buttons (come adesso, ma 6 opzioni: 24h, 3d, 7d, 15d, 1m, all)
- **Grafico prezzi** = SÌ, grafico curva prezzi da ITAD nel pannello espanso (secondo sparkline)
- **Record negativo UI** = riga nel pannello espanso (es: "24h Low: 234 • 7d Low: 180 • All-time Low: 45")
- **ITAD API** = key già disponibile (client ID + secret + API key forniti dall'utente)
  - API key va hardcoded? O meglio in .env? → per sicurezza, dotenv o build-time injection
  - DISCLAIMER OBBLIGATORIO: menzione ITAD + link in pagina About dell'estensione
  - Rispettare ToS: no modifica dati, no rimozione affiliate tags, no competizione con ITAD
  - Aggiungere sezione About con crediti ITAD

## ITAD ToS Compliance
- MUST: Link a IsThereAnyDeal.com nella pagina About
- MUST: Non modificare dati ricevuti (prezzi, URL con affiliate tags intatti)  
- MUST NOT: Sembrare affiliati con ITAD
- MUST NOT: Fare concorrenza a ITAD
- MAY: Usare parte dei dati + arricchire con fonti proprie ✓ (noi aggiungiamo player count)

## Metis Review Findings
- Migration strategy needed (atomic vs dual-write)
- ITAD fetch timing (on-demand vs background vs hybrid)
- Price chart scope (Steam-only vs all shops)
- Record low display (fixed set vs contextual to filter)
- purgeAfterDays repurposing
- Touch device hover behavior
- Must add unlimitedStorage + ITAD host_permissions to manifest
- GraphWindowKey type change is the foundation — do first
- idb + fake-indexeddb are the only new deps allowed
- ITAD API uses query param ?key=, NOT header
- amountInt (integer cents) for prices, never floats

## Scope Boundaries (Updated)
- INCLUDE: hover, record low, 6 filters, IndexedDB migration, ITAD integration, price chart, About page, compaction, TDD
- EXCLUDE: Alzare limite giochi, chart library, framework, notification system changes, loading spinners, price prediction, deal recommendations
