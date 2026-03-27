// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/popup/main.ts  (v0.5.0)
// ─────────────────────────────────────────────────────────────────────────────

import {
  getGames,
  getCache,
  getSettings,
  saveSettings,
  getLastFetchTime,
  removeGame,
} from "../utils/storage.js";
import { idbGetSnapshots, idbGetSnapshotsInRange, idbGetPriceHistory, idbSavePriceHistory } from "../utils/idb-storage.js";
import { fmtNumber, fmtPct, fmtTimeAgo, computeWindowMin } from "../utils/trend.js";
import {
  buildSparklineSVGWithPoints,
  buildPriceSparklineSVG,
  downsampleSnapshotsForGraph,
  findNearestPointIndex,
  sparklineColor,
} from "../utils/sparkline.js";
import { buildAllViewModels }                from "../utils/card.js";
import { buildShareText, renderShareCanvas } from "../utils/share.js";
import { esc, mustGet, show, hide }          from "../utils/html.js";
import { bindGlobalShareBarClose }           from "./shareBar.js";
import { thumbColor, wireThumbFallback }     from "./thumb.js";
import { fetchPriceHistory }                 from "../utils/itad-api.js";
import type {
  CardViewModel,
  GraphWindowKey,
  MessageRequest,
  MessageResponse,
  Snapshot,
} from "../types/index.js";

// ── DOM refs ──────────────────────────────────────────────────────────────────

const loadingEl     = mustGet<HTMLDivElement>("loading");
const errorStateEl  = mustGet<HTMLDivElement>("errorState");
const errorMsgEl    = mustGet<HTMLParagraphElement>("errorMessage");
const gamesListEl   = mustGet<HTMLUListElement>("gamesList");
const emptyStateEl  = mustGet<HTMLDivElement>("emptyState");
const fetchBarEl    = mustGet<HTMLDivElement>("fetchBar");
const lastUpdatedEl = mustGet<HTMLSpanElement>("lastUpdated");
const refreshBtn    = mustGet<HTMLButtonElement>("refreshBtn");
const settingsBtn   = mustGet<HTMLButtonElement>("settingsBtn");
const openOptionsBtn = document.getElementById("openOptionsBtn") as HTMLButtonElement | null;
const retryBtn       = document.getElementById("retryBtn")      as HTMLButtonElement | null;
let hasAttemptedRichDataHydration = false;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  showState("loading");
  try {
    const [games, cache, settings, lastFetch] = await Promise.all([
      getGames(),
      getCache(),
      getSettings(),
      getLastFetchTime(),
    ]);

    if (games.length === 0) {
      showState("empty");
      return;
    }

    const vms = await buildAllViewModels(games, cache, idbGetSnapshots, settings.purgeAfterDays);

    if (!hasAttemptedRichDataHydration && vms.some(needsRichDataHydration)) {
      hasAttemptedRichDataHydration = true;
      try {
        await chrome.runtime.sendMessage<MessageRequest, MessageResponse>({ type: "FETCH_NOW" });
        return await init();
      } catch (err) {
        console.error("[SteamWatch] Rich data hydration failed:", err);
      }
    }

    if (settings.rankByPlayers) {
      vms.sort((a, b) => (b.current ?? 0) - (a.current ?? 0));
    }

    renderGames(vms, settings.rankByPlayers, settings.badgeFavoriteAppid);
    updateFetchBar(lastFetch);
    updateHeaderTimestamp(vms);
    showState("list");
  } catch (err) {
    console.error("[SteamWatch popup]", err);
    showError("Failed to load data. Please try refreshing.");
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderGames(vms: CardViewModel[], rankByPlayers: boolean, favoriteAppid?: string): void {
  gamesListEl.innerHTML = "";

  vms.forEach((vm, i) => {
    const rankEmoji = rankByPlayers && vms.length > 1
      ? (["🥇", "🥈", "🥉"][i] ?? "")
      : "";
    const li = buildGameItem(vm, rankEmoji, i === 0 && rankByPlayers, favoriteAppid);
    gamesListEl.appendChild(li);

    if (i < vms.length - 1) {
      const sep = document.createElement("li");
      sep.className = "game-divider";
      sep.setAttribute("aria-hidden", "true");
      gamesListEl.appendChild(sep);
    }
  });

  if (vms.length >= 5) {
    const notice = document.createElement("li");
    notice.className = "max-badge";
    notice.setAttribute("role", "status");
    notice.textContent = "⚠ Max 5 games — remove one to add another";
    gamesListEl.appendChild(notice);
  }
}

// ── Card builder ──────────────────────────────────────────────────────────────

function buildGameItem(vm: CardViewModel, rankEmoji: string, isTop: boolean, favoriteAppid?: string): HTMLLIElement {
  const { game, current, peak24h, allTimePeak, trendCls, displayTrendPct, displayTrendIcon, displayTrendCls, svgStr } = vm;
  const trendBadgeHtml = displayTrendPct != null
    ? `<span class="trend-badge ${esc(displayTrendCls)}" aria-label="Trend ${esc(fmtPct(displayTrendPct))}">${displayTrendIcon ? `${esc(displayTrendIcon)} ` : ""}${esc(fmtPct(displayTrendPct))}</span>`
    : "";

  const li = document.createElement("li");
  li.className = "game-item";

  const card = document.createElement("div");
  card.className = `game-card ${esc(trendCls)}${isTop ? " rank-first" : ""}`;
  card.dataset["appid"] = game.appid;

  // Initial letter for placeholder — first alphanumeric char
  const initial = (game.name.match(/[A-Za-z0-9]/) ?? ["?"])[0]!.toUpperCase();
  const bgColor = thumbColor(game.appid);

  card.innerHTML = `
    <div class="thumb-wrap" aria-hidden="true">
      <img
        class="game-thumb"
        src="${esc(game.image)}"
        alt=""
        loading="lazy"
        width="56" height="42"
      >
      <div class="thumb-placeholder" style="--thumb-color:${bgColor}" aria-hidden="true">
        ${esc(initial)}
      </div>
    </div>

    <div class="game-info">
      <div class="game-name" title="${esc(game.name)}">
        ${rankEmoji ? `<span class="rank-badge" aria-hidden="true">${rankEmoji}</span>` : ""}
        <span class="game-name-text">${esc(game.name)}</span>
      </div>
      <div class="game-stats">
        <span class="stat-current" aria-label="${fmtNumber(current)} concurrent players">${fmtNumber(current)}</span>
        <div class="stat-meta">
          <div class="stat-row">
            <span class="stat-label" aria-hidden="true">24H PK</span>
            <span class="stat-value" aria-label="24-hour peak">${fmtNumber(peak24h)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" aria-hidden="true">ATH</span>
            <span class="stat-value" aria-label="all-time peak">${fmtNumber(allTimePeak)}</span>
          </div>
        </div>
        ${trendBadgeHtml}
      </div>
    </div>

    <div class="card-controls">
      <button class="btn-ctrl btn-share" aria-label="Share ${esc(game.name)}" title="Share">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <path d="M8.59 13.51L15.42 17.49"/><path d="M15.41 6.51L8.59 10.49"/>
        </svg>
      </button>
      <button class="btn-ctrl btn-star${favoriteAppid === game.appid ? " active" : ""}" aria-label="${favoriteAppid === game.appid ? "Remove from badge" : "Show on badge"}" title="Show on badge" aria-pressed="${String(favoriteAppid === game.appid)}">
        <svg viewBox="0 0 24 24" fill="${favoriteAppid === game.appid ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </button>
      <button class="btn-ctrl btn-expand" aria-expanded="false" aria-label="Expand details for ${esc(game.name)}" title="Details">
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <button class="btn-ctrl btn-remove" aria-label="Remove ${esc(game.name)}" title="Remove">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    ${svgStr ? `
    <div class="card-bottom" aria-hidden="true">
      <div class="sparkline">${svgStr}</div>
    </div>` : ""}
  `;

  // Expanded panel
  const panel = document.createElement("div");
  panel.className = "card-panel";
  panel.id = `panel-${game.appid}`;
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-label", `Detailed stats for ${game.name}`);

  // Share bar
  const shareBar = document.createElement("div");
  shareBar.className = "share-bar";
  shareBar.hidden = true;
  shareBar.setAttribute("aria-label", "Share options");
  shareBar.innerHTML = `
    <button class="share-opt" data-share="text" aria-label="Copy text summary to clipboard">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      Copy text
    </button>
    <button class="share-opt" data-share="image" aria-label="Copy card image to clipboard">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      Copy image
    </button>
    <span class="share-feedback" role="status" aria-live="polite"></span>
  `;

  li.appendChild(card);
  li.appendChild(shareBar);
  li.appendChild(panel);

  // ── Image error handler: CSP-safe, with retry chain ───────────────────────
  // Chrome MV3 CSP blocks all inline event handlers (onerror="...").
  // We attach listeners programmatically after innerHTML is set.
  const imgEl = card.querySelector<HTMLImageElement>(".game-thumb")!;
  const wrapEl = card.querySelector<HTMLDivElement>(".thumb-wrap")!;
  wireThumbFallback(imgEl, wrapEl, game.appid);

  // Wire events
  const expandBtn = card.querySelector<HTMLButtonElement>(".btn-expand")!;
  const removeBtn = card.querySelector<HTMLButtonElement>(".btn-remove")!;
  const shareBtn  = card.querySelector<HTMLButtonElement>(".btn-share")!;
  const starBtn   = card.querySelector<HTMLButtonElement>(".btn-star")!;

  expandBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(li, panel, expandBtn, vm); });
  removeBtn.addEventListener("click", (e) => { e.stopPropagation(); void handleRemove(game.appid); });
  shareBtn.addEventListener("click",  (e) => { e.stopPropagation(); toggleShareBar(shareBar, shareBtn); });
  starBtn.addEventListener("click",   (e) => { e.stopPropagation(); void handleToggleFavorite(game.appid, starBtn); });

  shareBar.querySelector<HTMLButtonElement>("[data-share='text']")!
    .addEventListener("click", (e) => { e.stopPropagation(); void handleShareText(shareBar, vm); });
  shareBar.querySelector<HTMLButtonElement>("[data-share='image']")!
    .addEventListener("click", (e) => { e.stopPropagation(); void handleShareImage(shareBar, vm); });

  return li;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function togglePanel(li: HTMLLIElement, panel: HTMLDivElement, btn: HTMLButtonElement, vm: CardViewModel): void {
  const opening = panel.hidden;
  panel.hidden = !opening;
  panel.setAttribute("aria-hidden", String(!opening));
  btn.setAttribute("aria-expanded", String(opening));
  li.classList.toggle("expanded", opening);

  if (opening && !panel.dataset["loaded"]) {
    panel.dataset["loaded"] = "1";
    populatePanel(panel, vm);
  }
}

function populatePanel(panel: HTMLDivElement, vm: CardViewModel): void {
  const {
    game, current, peak24h, allTimePeak,
    twitchViewers, avg24h, gain24h, retentionAvg, retentionGain, retentionDays,
    availableGraphWindows, defaultGraphWindow, discountPct, priceFormatted, priceOriginalFormatted,
  } = vm;

  const twitchStr = twitchViewers != null ? fmtNumber(twitchViewers) : "—";
  const avg24hStr = avg24h != null ? fmtNumber(avg24h) : "—";
  const gain24hStr = gain24h != null ? fmtSignedPlayers(gain24h) : "—";
  const retentionAvgStr = retentionAvg != null ? fmtNumber(retentionAvg) : "—";
  const retentionGainStr = retentionGain != null ? fmtSignedPlayers(retentionGain) : "—";
  const ALL_PILL_KEYS: GraphWindowKey[] = ["24h", "3d", "7d", "15d", "1m", "all"];
  const availableKeys = new Set(availableGraphWindows.map((w) => w.key));
  const hasAnyData = availableKeys.size > 0;
  const graphSelector = hasAnyData
    ? `<div class="graph-pill-bar" role="group" aria-label="Graph time range">
        ${ALL_PILL_KEYS.map((key) => {
          const isActive = key === defaultGraphWindow;
          const isDisabled = key !== "all" && !availableKeys.has(key);
          const label = key === "all" ? "All" : key;
          let cls = "graph-pill";
          if (isActive) cls += " graph-pill--active";
          if (isDisabled) cls += " graph-pill--disabled";
          return `<button type="button" class="${esc(cls)}" data-window="${esc(key)}"${isDisabled ? ' disabled aria-disabled="true"' : ""}>${esc(label)}</button>`;
        }).join("")}
      </div>`
    : "";

  panel.innerHTML = `
    ${graphSelector}
    <div class="panel-sparkline" aria-hidden="true"></div>
    <div class="panel-price-section"${vm.itadUuid ? "" : " hidden"}>
      <p class="panel-price-label">Price History</p>
      <div class="panel-price-loading">Loading price data...</div>
      <div class="panel-price-sparkline" aria-hidden="true"></div>
    </div>
    <dl class="panel-stats">
      <div class="panel-stat">
        <dt class="panel-stat-label">Current</dt>
        <dd class="panel-stat-value">${fmtNumber(current)}</dd>
      </div>
      <div class="panel-stat">
        <dt class="panel-stat-label">24h peak</dt>
        <dd class="panel-stat-value">${fmtNumber(peak24h)}</dd>
      </div>
      <div class="panel-stat">
        <dt class="panel-stat-label">All-time peak</dt>
        <dd class="panel-stat-value">${fmtNumber(allTimePeak)}</dd>
      </div>
      <div class="panel-stat">
        <dt class="panel-stat-label">Twitch viewers</dt>
        <dd class="panel-stat-value">${esc(twitchStr)}</dd>
      </div>
      <div class="panel-stat">
        <dt class="panel-stat-label">24h average</dt>
        <dd class="panel-stat-value">${esc(avg24hStr)}</dd>
      </div>
      <div class="panel-stat">
        <dt class="panel-stat-label">24h gain/loss</dt>
        <dd class="panel-stat-value">${esc(gain24hStr)}</dd>
      </div>
      <div class="panel-stat">
        <dt class="panel-stat-label">${esc(`${retentionDays}d average`)}</dt>
        <dd class="panel-stat-value">${esc(retentionAvgStr)}</dd>
      </div>
      <div class="panel-stat">
        <dt class="panel-stat-label">${esc(`${retentionDays}d gain/loss`)}</dt>
        <dd class="panel-stat-value">${esc(retentionGainStr)}</dd>
      </div>
    </dl>
    ${vm.allTimeLow != null ? (() => {
      const windowLabel = defaultGraphWindow === "all" ? "All" : (defaultGraphWindow ?? "24h");
      const windowLowStr = vm.recordLow != null ? fmtNumber(vm.recordLow.value) : "—";
      const allTimeLowStr = fmtNumber(vm.allTimeLow.value);
      return `<div class="panel-record-low">${esc(windowLabel)} Low: <span class="panel-record-low-val">${esc(windowLowStr)}</span> • All-time Low: <span class="panel-record-low-val">${esc(allTimeLowStr)}</span></div>`;
    })() : `<div class="panel-record-low" hidden></div>`}
    ${discountPct != null ? `
    <div class="panel-sale-badge" aria-label="${esc(`On sale: ${discountPct}% off`)}">
      <span class="sale-pct">ON SALE −${esc(String(discountPct))}%</span>
      ${priceFormatted ? `<span class="sale-price">${esc(priceFormatted)}</span>` : ""}
      ${priceOriginalFormatted ? `<s class="sale-orig">${esc(priceOriginalFormatted)}</s>` : ""}
    </div>` : ""}
    <div class="panel-links">
      <a class="panel-link" href="https://store.steampowered.com/app/${esc(game.appid)}"
         target="_blank" rel="noopener noreferrer">Steam ↗</a>
      <a class="panel-link" href="https://steamdb.info/app/${esc(game.appid)}"
         target="_blank" rel="noopener noreferrer">SteamDB ↗</a>
    </div>
  `;

  void renderPanelSparklineFromIdb(panel, vm.game.appid, defaultGraphWindow);
  void renderPanelPriceSparkline(panel, vm);

  panel.querySelectorAll<HTMLButtonElement>(".graph-pill:not(.graph-pill--disabled)").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset["window"];
      if (!isGraphWindowKey(key)) return;
      panel.querySelectorAll<HTMLButtonElement>(".graph-pill").forEach((btn) => {
        btn.classList.toggle("graph-pill--active", btn === button);
      });
      void renderPanelSparklineFromIdb(panel, vm.game.appid, key);
      const updateRecordLow = async (windowKey: GraphWindowKey): Promise<void> => {
        const recordLowEl = panel.querySelector<HTMLElement>(".panel-record-low");
        if (!recordLowEl || !vm.allTimeLow) return;
        const WINDOW_MS: Record<string, number> = {
          "24h": 86_400_000,
          "3d": 3 * 86_400_000,
          "7d": 7 * 86_400_000,
          "15d": 15 * 86_400_000,
          "1m": 30 * 86_400_000,
        };
        let snaps: readonly Snapshot[];
        if (windowKey === "all") {
          snaps = await idbGetSnapshots(vm.game.appid);
        } else {
          const ms = WINDOW_MS[windowKey] ?? 86_400_000;
          snaps = await idbGetSnapshotsInRange(vm.game.appid, Date.now() - ms, Date.now());
        }
        const windowMin = computeWindowMin([...snaps]);
        const windowLabel = windowKey === "all" ? "All" : windowKey;
        const windowLowStr = windowMin ? fmtNumber(windowMin.value) : "—";
        const allTimeLowStr = fmtNumber(vm.allTimeLow.value);
        recordLowEl.innerHTML = `${esc(windowLabel)} Low: <span class="panel-record-low-val">${esc(windowLowStr)}</span> • All-time Low: <span class="panel-record-low-val">${esc(allTimeLowStr)}</span>`;
      };
      void updateRecordLow(key);
    });
  });
}

function needsRichDataHydration(vm: CardViewModel): boolean {
  if (vm.current == null) return false;
  return (
    vm.peak24h == null ||
    vm.allTimePeak == null ||
    vm.twitchViewers == null
  );
}

function fmtSignedPlayers(value: number): string {
  const abs = fmtNumber(Math.abs(value));
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return "0";
}

async function renderPanelSparklineFromIdb(
  panel: HTMLDivElement,
  appId: string,
  selectedWindow: GraphWindowKey | null,
): Promise<void> {
  const sparklineEl = panel.querySelector<HTMLDivElement>(".panel-sparkline");
  if (!sparklineEl) return;

  let snaps: readonly Snapshot[];
  if (selectedWindow === null || selectedWindow === "all") {
    snaps = await idbGetSnapshots(appId);
  } else {
    const WINDOW_MS: Record<string, number> = {
      "24h": 86_400_000,
      "3d": 3 * 86_400_000,
      "7d": 7 * 86_400_000,
      "15d": 15 * 86_400_000,
      "1m": 30 * 86_400_000,
    };
    const windowMs = WINDOW_MS[selectedWindow] ?? 86_400_000;
    const endTs = Date.now();
    const startTs = endTs - windowMs;
    snaps = await idbGetSnapshotsInRange(appId, startTs, endTs);
  }

  const graphSnaps = downsampleSnapshotsForGraph([...snaps], 96);
  const result = buildSparklineSVGWithPoints(graphSnaps, {
    strokeColor: sparklineColor(graphSnaps),
    width: 372,
    height: 56,
    maxPoints: 96,
  });

  sparklineEl.innerHTML = result?.svg ?? "";
  sparklineEl.hidden = !result;

  if (!result) return;

  attachSparklineHover(sparklineEl, result.points, graphSnaps);
}

async function renderPanelPriceSparkline(panel: HTMLDivElement, vm: CardViewModel): Promise<void> {
  if (!vm.itadUuid) return;

  const loadingEl = panel.querySelector<HTMLDivElement>(".panel-price-loading");
  const sparklineEl = panel.querySelector<HTMLDivElement>(".panel-price-sparkline");
  if (!loadingEl || !sparklineEl) return;

  loadingEl.hidden = false;
  sparklineEl.innerHTML = "";

  const cached = await idbGetPriceHistory(vm.game.appid);
  const isFresh = cached.length > 0 && Date.now() - cached[0]!.timestamp < 86_400_000;

  let records = isFresh ? cached : await fetchPriceHistory(vm.itadUuid);
  if (!isFresh && records.length > 0) {
    await idbSavePriceHistory(vm.game.appid, records);
  }

  if (records.length === 0) {
    records = cached;
  }

  if (records.length === 0) {
    loadingEl.textContent = "No price data available";
    return;
  }

  const svg = buildPriceSparklineSVG(records);
  if (svg) {
    sparklineEl.innerHTML = svg;
    loadingEl.hidden = true;
  } else {
    loadingEl.textContent = "No price data available";
  }
}

function attachSparklineHover(
  container: HTMLDivElement,
  points: ReadonlyArray<{ x: number; y: number }>,
  snaps: readonly Snapshot[],
): void {
  const VIEW_W = 372;
  const VIEW_H = 56;

  const tooltip = document.createElement("div");
  tooltip.className = "sparkline-tooltip";
  tooltip.hidden = true;

  const hoverLine = document.createElement("div");
  hoverLine.className = "sparkline-hover-line";
  hoverLine.hidden = true;

  const hoverDot = document.createElement("div");
  hoverDot.className = "sparkline-hover-dot";
  hoverDot.hidden = true;

  container.appendChild(tooltip);
  container.appendChild(hoverLine);
  container.appendChild(hoverDot);

  function onMouseMove(e: MouseEvent): void {
    const rect = container.getBoundingClientRect();
    const domX = e.clientX - rect.left;
    const domW = rect.width;
    if (domW <= 0) return;

    const svgX = (domX / domW) * VIEW_W;
    const idx = findNearestPointIndex(svgX, points);
    const snap = snaps[idx];
    if (!snap) return;

    const pt = points[idx]!;
    const pctX = (pt.x / VIEW_W) * 100;
    const pctY = (pt.y / VIEW_H) * 100;

    tooltip.textContent = fmtNumber(snap.current);
    tooltip.hidden = false;
    hoverLine.hidden = false;
    hoverDot.hidden = false;

    hoverLine.style.left = `${pctX}%`;
    hoverDot.style.left  = `${pctX}%`;
    hoverDot.style.top   = `${pctY}%`;

    const tooltipW = tooltip.offsetWidth;
    const containerW = container.offsetWidth;
    if (containerW > 0 && tooltipW > 0) {
      const halfTooltipPct = (tooltipW / 2 / containerW) * 100;
      const clampedLeft = Math.max(halfTooltipPct, Math.min(pctX, 100 - halfTooltipPct));
      tooltip.style.left = `${clampedLeft}%`;
    } else {
      tooltip.style.left = `${pctX}%`;
    }
  }

  function onMouseLeave(): void {
    tooltip.hidden = true;
    hoverLine.hidden = true;
    hoverDot.hidden = true;
  }

  container.addEventListener("mousemove", onMouseMove);
  container.addEventListener("mouseleave", onMouseLeave);
}

function isGraphWindowKey(value: string | undefined): value is GraphWindowKey {
  return value === "24h" || value === "3d" || value === "7d" || value === "15d" || value === "1m" || value === "all";
}

// ── Share handlers ────────────────────────────────────────────────────────────

function toggleShareBar(bar: HTMLDivElement, btn: HTMLButtonElement): void {
  if (bar.hidden) { bar.hidden = false; btn.classList.add("active"); }
  else closeShareBar(bar, btn);
}
function closeShareBar(bar: HTMLDivElement, btn: HTMLButtonElement): void {
  bar.hidden = true; btn.classList.remove("active");
}

async function handleShareText(bar: HTMLDivElement, vm: CardViewModel): Promise<void> {
  const fb = bar.querySelector<HTMLSpanElement>(".share-feedback")!;
  try {
    await navigator.clipboard.writeText(buildShareText(vm));
    showShareFeedback(fb, "✓ Copied!", "success");
  } catch { showShareFeedback(fb, "✗ Copy failed", "error"); }
}

async function handleShareImage(bar: HTMLDivElement, vm: CardViewModel): Promise<void> {
  const fb     = bar.querySelector<HTMLSpanElement>(".share-feedback")!;
  const imgBtn = bar.querySelector<HTMLButtonElement>("[data-share='image']")!;
  imgBtn.disabled = true;
  showShareFeedback(fb, "Rendering…", "pending");
  try {
    const blob = await renderShareCanvas(vm);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    showShareFeedback(fb, "✓ Image copied!", "success");
  } catch { showShareFeedback(fb, "✗ Copy failed", "error"); }
  finally { imgBtn.disabled = false; }
}

let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
function showShareFeedback(el: HTMLSpanElement, msg: string, kind: "success" | "error" | "pending"): void {
  el.textContent = msg;
  el.className   = `share-feedback share-feedback--${kind}`;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  if (kind !== "pending") {
    feedbackTimer = setTimeout(() => { el.textContent = ""; el.className = "share-feedback"; }, 2500);
  }
}

// ── Remove ────────────────────────────────────────────────────────────────────

async function handleRemove(appid: string): Promise<void> {
  try { await removeGame(appid); await init(); }
  catch (err) { console.error("[SteamWatch] Remove failed:", err); }
}

// ── Badge favorite ────────────────────────────────────────────────────────────

async function handleToggleFavorite(appid: string, clickedBtn: HTMLButtonElement): Promise<void> {
  try {
    const settings = await getSettings();
    const isCurrentFav = settings.badgeFavoriteAppid === appid;
    const newFav = isCurrentFav ? undefined : appid;
    await saveSettings({ badgeFavoriteAppid: newFav });

    // Update all star buttons in the list to reflect the new state
    document.querySelectorAll<HTMLButtonElement>(".btn-star").forEach((btn) => {
      const card = btn.closest<HTMLDivElement>(".game-card");
      const cardAppid = card?.dataset["appid"];
      const active = cardAppid === newFav;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
      btn.setAttribute("aria-label", active ? "Remove from badge" : "Show on badge");
      const polygon = btn.querySelector("polygon");
      if (polygon) polygon.setAttribute("fill", active ? "currentColor" : "none");
    });

    // Ask background to refresh badge immediately
    try {
      await chrome.runtime.sendMessage<MessageRequest, MessageResponse>({ type: "FETCH_NOW" });
    } catch (_e) { /* badge refresh is fire-and-forget; swallowing connection errors intentionally */ }
  } catch (err) {
    console.error("[SteamWatch] Toggle favorite failed:", err);
  }
  void clickedBtn;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Show the prominent "Updated X min ago" bar above the games list.
 * Uses the global last-fetch timestamp from the service worker, which is
 * more reliable than per-game CachedData.fetchedAt on first extension install.
 */
function updateFetchBar(lastFetch: number): void {
  if (lastFetch <= 0) {
    hide(fetchBarEl);
    return;
  }
  const mins = Math.round((Date.now() - lastFetch) / 60_000);
  let label: string;
  if (mins <= 0)    label = "Updated just now";
  else if (mins === 1) label = "Updated 1 min ago";
  else if (mins < 60)  label = `Updated ${mins} min ago`;
  else {
    const h = new Date(lastFetch);
    const hh = h.getHours().toString().padStart(2, "0");
    const mm = h.getMinutes().toString().padStart(2, "0");
    label = `Updated at ${hh}:${mm}`;
  }
  fetchBarEl.textContent = label;
  show(fetchBarEl);
}

/** Keep the compact header span in sync (secondary indicator). */
function updateHeaderTimestamp(vms: CardViewModel[]): void {
  const ts = vms.map((vm) => vm.fetchedAt).filter((t) => t > 0);
  if (!ts.length) return;
  lastUpdatedEl.textContent = fmtTimeAgo(Math.max(...ts));
}

function showState(state: "loading" | "empty" | "list" | "error"): void {
  hide(loadingEl); hide(errorStateEl); hide(gamesListEl); hide(emptyStateEl); hide(fetchBarEl);
  switch (state) {
    case "loading": show(loadingEl);    break;
    case "empty":   show(emptyStateEl); break;
    case "list":    show(gamesListEl);  break;
    case "error":   show(errorStateEl); break;
  }
}

function showError(message: string): void {
  errorMsgEl.textContent = message;
  showState("error");
}

// ── Events ────────────────────────────────────────────────────────────────────

refreshBtn.addEventListener("click", async () => {
  refreshBtn.classList.add("spinning");
  refreshBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage<MessageRequest, MessageResponse>({ type: "FETCH_NOW" });
    await init();
  } catch (err) { console.error("[SteamWatch] Refresh failed:", err); }
  finally { refreshBtn.classList.remove("spinning"); refreshBtn.disabled = false; }
});

settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
openOptionsBtn?.addEventListener("click", () => chrome.runtime.openOptionsPage());
retryBtn?.addEventListener("click", () => void init());
bindGlobalShareBarClose(document);

void init();
