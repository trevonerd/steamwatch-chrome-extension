// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/popup/main.ts  (v0.5.0)
// ─────────────────────────────────────────────────────────────────────────────

import {
  getGames,
  getCache,
  getSnapshotsForGame,
  getSettings,
  getLastFetchTime,
  removeGame,
} from "../utils/storage.js";
import { fmtNumber, fmtPct, fmtTimeAgo } from "../utils/trend.js";
import {
  buildSparklineSVG,
  downsampleSnapshotsForGraph,
  filterSnapshotsByWindow,
  sparklineColor,
} from "../utils/sparkline.js";
import { buildAllViewModels }                from "../utils/card.js";
import { buildShareText, renderShareCanvas } from "../utils/share.js";
import { esc, mustGet, show, hide }          from "../utils/html.js";
import { bindGlobalShareBarClose }           from "./shareBar.js";
import { thumbColor, wireThumbFallback }     from "./thumb.js";
import type {
  CardViewModel,
  MessageRequest,
  MessageResponse,
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

    const vms = await buildAllViewModels(games, cache, getSnapshotsForGame, settings.purgeAfterDays);

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

    renderGames(vms, settings.rankByPlayers);
    updateFetchBar(lastFetch);
    updateHeaderTimestamp(vms);
    showState("list");
  } catch (err) {
    console.error("[SteamWatch popup]", err);
    showError("Failed to load data. Please try refreshing.");
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderGames(vms: CardViewModel[], rankByPlayers: boolean): void {
  gamesListEl.innerHTML = "";

  vms.forEach((vm, i) => {
    const rankEmoji = rankByPlayers && vms.length > 1
      ? (["🥇", "🥈", "🥉"][i] ?? "")
      : "";
    const li = buildGameItem(vm, rankEmoji, i === 0 && rankByPlayers);
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

function buildGameItem(vm: CardViewModel, rankEmoji: string, isTop: boolean): HTMLLIElement {
  const { game, current, peak24h, allTimePeak, trend, trendCls, latestChangePct, svgStr } = vm;
  const latestChangeHtml = latestChangePct != null
    ? `<span class="trend-badge ${esc(changeBadgeClass(latestChangePct))}" aria-label="Latest change ${fmtPct(latestChangePct)}">${esc(fmtPct(latestChangePct))}</span>`
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
        ${latestChangeHtml || (trend ? `<span class="trend-badge ${esc(trendCls)}" aria-label="Trend ${fmtPct(trend.pct)}">${trend.level.icon} ${esc(fmtPct(trend.pct))}</span>` : "")}
      </div>
    </div>

    <div class="card-controls">
      <button class="btn-ctrl btn-share" aria-label="Share ${esc(game.name)}" title="Share">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <path d="M8.59 13.51L15.42 17.49"/><path d="M15.41 6.51L8.59 10.49"/>
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

  expandBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(li, panel, expandBtn, vm); });
  removeBtn.addEventListener("click", (e) => { e.stopPropagation(); void handleRemove(game.appid); });
  shareBtn.addEventListener("click",  (e) => { e.stopPropagation(); toggleShareBar(shareBar, shareBtn); });

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
    game, snaps, current, peak24h, allTimePeak,
    twitchViewers, avg24h, gain24h, retentionAvg, retentionGain, retentionDays,
    availableGraphWindows, defaultGraphWindow,
  } = vm;

  const twitchStr = twitchViewers != null ? fmtNumber(twitchViewers) : "—";
  const avg24hStr = avg24h != null ? fmtNumber(avg24h) : "—";
  const gain24hStr = gain24h != null ? fmtSignedPlayers(gain24h) : "—";
  const retentionAvgStr = retentionAvg != null ? fmtNumber(retentionAvg) : "—";
  const retentionGainStr = retentionGain != null ? fmtSignedPlayers(retentionGain) : "—";
  const graphSelector = availableGraphWindows.length > 0
    ? `<div class="panel-window-selector" role="tablist" aria-label="Graph window selector">
        ${availableGraphWindows.map((window) => `
          <button
            type="button"
            class="panel-window-btn${window.key === defaultGraphWindow ? " active" : ""}"
            data-graph-window="${esc(window.key)}"
            role="tab"
            aria-selected="${String(window.key === defaultGraphWindow)}"
          >${esc(window.label)}</button>
        `).join("")}
      </div>`
    : "";

  panel.innerHTML = `
    ${graphSelector}
    <div class="panel-sparkline" aria-hidden="true"></div>
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
    <div class="panel-links">
      <a class="panel-link" href="https://store.steampowered.com/app/${esc(game.appid)}"
         target="_blank" rel="noopener noreferrer">Steam ↗</a>
      <a class="panel-link" href="https://steamdb.info/app/${esc(game.appid)}"
         target="_blank" rel="noopener noreferrer">SteamDB ↗</a>
    </div>
  `;

  renderPanelSparkline(panel, vm, defaultGraphWindow);

  panel.querySelectorAll<HTMLButtonElement>("[data-graph-window]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset["graphWindow"];
      if (!isGraphWindowKey(key)) return;
      panel.querySelectorAll<HTMLButtonElement>("[data-graph-window]").forEach((btn) => {
        const active = btn === button;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", String(active));
      });
      renderPanelSparkline(panel, vm, key);
    });
  });
}

function changeBadgeClass(pct: number): string {
  if (pct >= 8) return "strong-up";
  if (pct >= 2) return "up";
  if (pct <= -8) return "strong-down";
  if (pct <= -2) return "down";
  return "stable";
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

function renderPanelSparkline(
  panel: HTMLDivElement,
  vm: CardViewModel,
  selectedWindow: CardViewModel["defaultGraphWindow"],
): void {
  const sparklineEl = panel.querySelector<HTMLDivElement>(".panel-sparkline");
  if (!sparklineEl) return;

  const selected = selectedWindow == null
    ? null
    : vm.availableGraphWindows.find((window) => window.key === selectedWindow) ?? null;
  const source = selected ? filterSnapshotsByWindow(vm.snaps, selected.windowMs) : vm.snaps;

  const graphSnaps = downsampleSnapshotsForGraph(source, 96);
  const svg = buildSparklineSVG(graphSnaps, {
    strokeColor: sparklineColor(graphSnaps),
    width: 372,
    height: 56,
    maxPoints: 96,
  });

  sparklineEl.innerHTML = svg ?? "";
  sparklineEl.hidden = !svg;
}

function isGraphWindowKey(value: string | undefined): value is "24h" | "3d" | "retention" {
  return value === "24h" || value === "3d" || value === "retention";
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
