// SteamWatch — src/popup/main.ts
import {
  getGames,
  removeGame,
  getSettings,
  saveSettings,
  getCache,
  getLastFetchTime,
  TRACKING_RETENTION_DAYS,
  MAX_GAMES,
} from "../utils/storage.js";
import { idbGetSnapshots, idbGetBootstrapStatus } from "../utils/idb-storage.js";
import { fmtNumber, fmtPct, fmtTimeAgo } from "../utils/trend.js";
import { populatePanel, renderSparkline, freshnessTitle } from "./graphs.js";
import { buildAllViewModels, buildCardViewModel } from "../utils/card.js";
import { buildShareText, renderShareCanvas } from "../utils/share.js";
import { append, clear, h, mustGet, s, show, hide } from "../utils/html.js";
import { formatError } from "../utils/log.js";
import { requestRefresh } from "../utils/messages.js";
import { bindGlobalShareBarClose } from "./shareBar.js";
import { thumbColor, wireThumbFallback } from "./thumb.js";
import { shouldRefreshGames, startPopupUpdates } from "./updates.js";

import type {
  CardViewModel,
} from "../types/index.js";

const loadingEl = mustGet<HTMLDivElement>("loading");
const errorStateEl = mustGet<HTMLDivElement>("errorState");
const errorMsgEl = mustGet<HTMLParagraphElement>("errorMessage");
const gamesListEl = mustGet<HTMLUListElement>("gamesList");
const emptyStateEl = mustGet<HTMLDivElement>("emptyState");
const fetchBarEl = mustGet<HTMLDivElement>("fetchBar");
const lastUpdatedEl = mustGet<HTMLSpanElement>("lastUpdated");
const refreshBtn = mustGet<HTMLButtonElement>("refreshBtn");
const settingsBtn = mustGet<HTMLButtonElement>("settingsBtn");
const openOptionsBtn = document.getElementById("openOptionsBtn") as HTMLButtonElement | null;
const retryBtn = document.getElementById("retryBtn") as HTMLButtonElement | null;
const manifest = chrome.runtime.getManifest();
mustGet<HTMLSpanElement>("appVersion").textContent = `v${manifest.version_name ?? manifest.version}`;

let renderRevision = 0;
let updating = false;
let automaticError = false;

async function init(refreshOnOpen = false): Promise<void> {
  const revision = ++renderRevision;
  if (gamesListEl.children.length === 0) showState("loading");

  try {
    const [games, cache, settings] = await Promise.all([
      getGames(),
      getCache(),
      getSettings(),
    ]);

    if (revision !== renderRevision) return;
    if (games.length === 0) {
      showState("empty");
      return;
    }

    if (gamesListEl.children.length === 0) {
      const initial = games.map((game) => ({ ...buildCardViewModel(game, cache, [], TRACKING_RETENTION_DAYS), historyLoading: true }));
      initial.sort((a, b) => (b.current ?? -1) - (a.current ?? -1));
      renderGames(initial, settings.badgeFavoriteAppid);
      showState("list");
      updateHeaderTimestamp(initial);
      updateFetchBar(await getLastFetchTime());
    }

    const vms = await buildAllViewModels(games, cache, idbGetSnapshots, TRACKING_RETENTION_DAYS, idbGetBootstrapStatus);
    const lastFetch = await getLastFetchTime();
    if (revision !== renderRevision) return;
    vms.sort((a, b) => (b.current ?? -1) - (a.current ?? -1));
    renderGames(vms, settings.badgeFavoriteAppid);
    updateHeaderTimestamp(vms);
    showState("list");
    updateFetchBar(lastFetch);
    if (automaticError) showAutomaticError();
    if (refreshOnOpen && shouldRefreshGames(games, cache)) void refresh(true);
  } catch (err) {
    if (revision !== renderRevision) return;
    console.error(`[SteamWatch popup] ${formatError(err)}`);
    showError("Failed to load SteamWatch data.");
  }
}

function renderGames(vms: CardViewModel[], favoriteAppid?: string): void {
  const expanded = new Map<string, string | undefined>();
  const focusedLabel = document.activeElement?.getAttribute("aria-label");
  for (const item of Array.from(gamesListEl.querySelectorAll<HTMLElement>(".game-item"))) {
    const appId = item.querySelector<HTMLElement>(".game-card")?.dataset["appid"];
    if (appId && item.classList.contains("expanded")) {
      expanded.set(appId, item.querySelector<HTMLElement>(".graph-pill--active")?.dataset["window"]);
    }
    const graph = item.querySelector<HTMLDivElement>(".panel-sparkline") as (HTMLDivElement & { hoverCleanup?: () => void }) | null;
    graph?.hoverCleanup?.();
  }
  clear(gamesListEl);

  vms.forEach((vm, index) => {
    const rankEmoji = vms.length > 1
      ? index === 0 ? "1" : index === 1 ? "2" : index === 2 ? "3" : ""
      : "";
    const item = buildGameItem(vm, rankEmoji, index === 0, favoriteAppid);
    gamesListEl.appendChild(item);
    if (expanded.has(vm.game.appid)) {
      item.querySelector<HTMLButtonElement>(".btn-expand")?.click();
      const selected = expanded.get(vm.game.appid);
      const button = Array.from(item.querySelectorAll<HTMLButtonElement>(".graph-pill"))
        .find((pill) => pill.dataset["window"] === selected && !pill.disabled);
      button?.click();
    }
    if (index < vms.length - 1) {
      gamesListEl.appendChild(h("li", { className: "game-divider", attrs: { "aria-hidden": "true" } }));
    }
  });
  if (focusedLabel) {
    Array.from(gamesListEl.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.getAttribute("aria-label") === focusedLabel)?.focus({ preventScroll: true });
  }

  if (vms.length >= MAX_GAMES) {
    gamesListEl.appendChild(h("li", {
      className: "max-badge",
      text: `Max ${MAX_GAMES} games - remove one to add another`,
      attrs: { role: "status" },
    }));
  }
}

function buildGameItem(vm: CardViewModel, rankEmoji: string, isTop: boolean, favoriteAppid?: string): HTMLLIElement {
  const { game, current, peak24h, allTimePeak, trendCls, displayTrendPct, displayTrendIcon, displayTrendCls } = vm;
  const li = h("li", { className: "game-item", dataset: { historyLoading: String(vm.historyLoading === true) } });
  const card = h("div", {
    className: `game-card ${trendCls}${isTop ? " rank-first" : ""}`,
    dataset: { appid: game.appid },
  });

  const thumbWrap = h("div", { className: "thumb-wrap", attrs: { "aria-hidden": "true" } });
  const img = h("img", {
    className: "game-thumb",
    attrs: {
      src: game.image,
      alt: "",
      loading: "lazy",
      width: "56",
      height: "42",
    },
  });
  append(
    thumbWrap,
    img,
    h("div", {
      className: "thumb-placeholder",
      text: firstGameInitial(game.name),
      attrs: {
        "aria-hidden": "true",
        style: `--thumb-color:${thumbColor(game.appid)}`,
      },
    }),
  );
  wireThumbFallback(img, thumbWrap, game.appid);

  const gameName = h("div", { className: "game-name", attrs: { title: game.name } });
  if (rankEmoji) {
    gameName.appendChild(h("span", { className: "rank-badge", text: rankEmoji, attrs: { "aria-hidden": "true" } }));
  }
  gameName.appendChild(h("span", { className: "game-name-text", text: game.name }));

  const stats = h("div", { className: "game-stats" });
  append(
    stats,
    h("span", {
      className: "stat-current",
      text: fmtNumber(current),
      attrs: {
        "aria-label": `${fmtNumber(current)} concurrent players`,
        title: freshnessTitle(vm.freshness?.current),
      },
    }),
    h("div", {
      className: "stat-meta",
      children: [
        statRow("24H PK", `24-hour peak · ${freshnessTitle(vm.freshness?.peak24h)}`, peak24h),
        statRow(allTimePeak !== null ? "ATH" : "OBS PK", allTimePeak !== null ? `SteamCharts record · ${freshnessTitle(vm.freshness?.allTimePeak)}` : "Maximum in available observations; not an all-time record", allTimePeak ?? vm.observedPeak ?? null),
      ],
    }),
  );
  if (displayTrendPct != null) {
    stats.appendChild(h("span", {
      className: `trend-badge ${displayTrendCls}`,
      text: `${displayTrendIcon ? `${displayTrendIcon} ` : ""}${fmtPct(displayTrendPct)}`,
      attrs: { "aria-label": `Seasonal trend ${fmtPct(displayTrendPct)}`, title: "7-day seasonal trend: matched hours and weekdays from previous weeks" },
    }));
  } else {
    stats.appendChild(h("span", { className: "trend-badge stable", text: "No trend", attrs: { title: vm.seasonalAnalysis?.reason ?? "Not enough comparable history" } }));
  }

  append(
    card,
    thumbWrap,
    h("div", { className: "game-info", children: [gameName, stats] }),
    buildCardControls(game.name, favoriteAppid === game.appid),
  );

  const cardSparkline = renderSparkline(vm.snaps, {
    width: 160,
    height: 36,
    maxPoints: 48,
    strokeColor: vm.sparklineStroke,
  });
  if (cardSparkline) {
    card.appendChild(h("div", {
      className: "card-bottom",
      attrs: { "aria-hidden": "true" },
      children: [h("div", { className: "sparkline", children: [cardSparkline.svg] })],
    }));
  }

  const panel = h("div", {
    className: "card-panel",
    attrs: {
      id: `panel-${game.appid}`,
      hidden: true,
      "aria-hidden": "true",
      "aria-label": `Detailed stats for ${game.name}`,
    },
  });
  const shareBar = buildShareBar();

  append(li, card, shareBar, panel);

  const expandBtn = card.querySelector<HTMLButtonElement>(".btn-expand");
  const removeBtn = card.querySelector<HTMLButtonElement>(".btn-remove");
  const shareBtn = card.querySelector<HTMLButtonElement>(".btn-share");
  const starBtn = card.querySelector<HTMLButtonElement>(".btn-star");

  expandBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePanel(li, panel, expandBtn, vm);
  });
  removeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void handleRemove(game.appid);
  });
  shareBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleShareBar(shareBar, shareBtn);
  });
  starBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void handleToggleFavorite(game.appid, starBtn);
  });

  shareBar.querySelector<HTMLButtonElement>("[data-share='text']")?.addEventListener("click", (event) => {
    event.stopPropagation();
    void handleShareText(shareBar, vm);
  });
  shareBar.querySelector<HTMLButtonElement>("[data-share='image']")?.addEventListener("click", (event) => {
    event.stopPropagation();
    void handleShareImage(shareBar, vm);
  });

  return li;
}

function statRow(label: string, ariaLabel: string, value: number | null): HTMLDivElement {
  return h("div", {
    className: "stat-row",
    children: [
      h("span", { className: "stat-label", text: label, attrs: { "aria-hidden": "true" } }),
      h("span", { className: "stat-value", text: fmtNumber(value), attrs: { "aria-label": ariaLabel } }),
    ],
  });
}

function buildCardControls(gameName: string, favorite: boolean): HTMLDivElement {
  return h("div", {
    className: "card-controls",
    children: [
      controlButton("btn-share", `Share ${gameName}`, "Share", shareIcon()),
      controlButton("btn-star", favorite ? "Remove from badge" : "Show on badge", "Show on badge", starIcon(favorite), favorite),
      controlButton("btn-expand", `Expand details for ${gameName}`, "Details", chevronIcon(), false, { "aria-expanded": "false" }),
      controlButton("btn-remove", `Remove ${gameName}`, "Remove", removeIcon()),
    ],
  });
}

function controlButton(
  cls: string,
  ariaLabel: string,
  title: string,
  icon: SVGSVGElement,
  active = false,
  attrs: Record<string, string> = {},
): HTMLButtonElement {
  return h("button", {
    className: `btn-ctrl ${cls}${active ? " active" : ""}`,
    attrs: {
      type: "button",
      "aria-label": ariaLabel,
      title,
      "aria-pressed": cls === "btn-star" ? String(active) : undefined,
      ...attrs,
    },
    children: [icon],
  });
}

function buildShareBar(): HTMLDivElement {
  return h("div", {
    className: "share-bar",
    attrs: {
      hidden: true,
      "aria-label": "Share options",
    },
    children: [
      h("button", {
        className: "share-opt",
        attrs: {
          type: "button",
          "data-share": "text",
          "aria-label": "Copy text summary to clipboard",
        },
        children: [copyIcon(), "Copy text"],
      }),
      h("button", {
        className: "share-opt",
        attrs: {
          type: "button",
          "data-share": "image",
          "aria-label": "Copy card image to clipboard",
        },
        children: [imageIcon(), "Copy image"],
      }),
      h("span", { className: "share-feedback", attrs: { role: "status", "aria-live": "polite" } }),
    ],
  });
}

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

function toggleShareBar(bar: HTMLDivElement, btn: HTMLButtonElement): void {
  if (bar.hidden) {
    bar.hidden = false;
    btn.classList.add("active");
    return;
  }
  closeShareBar(bar, btn);
}

function closeShareBar(bar: HTMLDivElement, btn: HTMLButtonElement): void {
  bar.hidden = true;
  btn.classList.remove("active");
}

async function handleShareText(bar: HTMLDivElement, vm: CardViewModel): Promise<void> {
  const feedback = bar.querySelector<HTMLSpanElement>(".share-feedback");
  if (!feedback) return;

  try {
    await navigator.clipboard.writeText(buildShareText(vm));
    showShareFeedback(feedback, "Copied!", "success");
  } catch (err) {
    console.error(`[SteamWatch popup] Text share failed: ${formatError(err)}`);
    showShareFeedback(feedback, "Copy failed", "error");
  }
}

async function handleShareImage(bar: HTMLDivElement, vm: CardViewModel): Promise<void> {
  const feedback = bar.querySelector<HTMLSpanElement>(".share-feedback");
  const imgBtn = bar.querySelector<HTMLButtonElement>("[data-share='image']");
  if (!feedback || !imgBtn) return;

  imgBtn.disabled = true;
  showShareFeedback(feedback, "Rendering...", "pending");
  try {
    const blob = await renderShareCanvas(vm);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    showShareFeedback(feedback, "Image copied!", "success");
  } catch (err) {
    console.error(`[SteamWatch popup] Image share failed: ${formatError(err)}`);
    showShareFeedback(feedback, "Copy failed", "error");
  } finally {
    imgBtn.disabled = false;
  }
}

let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

function showShareFeedback(el: HTMLSpanElement, msg: string, kind: "success" | "error" | "pending"): void {
  el.textContent = msg;
  el.className = `share-feedback share-feedback--${kind}`;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  if (kind !== "pending") {
    feedbackTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "share-feedback";
    }, 2500);
  }
}

async function handleRemove(appid: string): Promise<void> {
  try {
    await removeGame(appid);
    await init();
  } catch (err) {
    console.error(`[SteamWatch] Remove failed: ${formatError(err)}`);
  }
}

async function handleToggleFavorite(appid: string, clickedBtn: HTMLButtonElement): Promise<void> {
  try {
    const settings = await getSettings();
    const isCurrentFavorite = settings.badgeFavoriteAppid === appid;
    const newFavorite = isCurrentFavorite ? undefined : appid;
    await saveSettings({ badgeFavoriteAppid: newFavorite });

    document.querySelectorAll<HTMLButtonElement>(".btn-star").forEach((btn) => {
      const card = btn.closest<HTMLDivElement>(".game-card");
      const cardAppid = card?.dataset["appid"];
      const active = cardAppid === newFavorite;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
      btn.setAttribute("aria-label", active ? "Remove from badge" : "Show on badge");
      const polygon = btn.querySelector("polygon");
      if (polygon) polygon.setAttribute("fill", active ? "currentColor" : "none");
    });

    clickedBtn.blur();

  } catch (err) {
    console.error(`[SteamWatch] Toggle favorite failed: ${formatError(err)}`);
  }
}

function updateFetchBar(lastFetch: number): void {
  if (lastFetch <= 0) {
    hide(fetchBarEl);
    return;
  }

  const mins = Math.round((Date.now() - lastFetch) / 60_000);
  let label: string;
  if (mins <= 0) label = "Updated just now";
  else if (mins === 1) label = "Updated 1 min ago";
  else if (mins < 60) label = `Updated ${mins} min ago`;
  else {
    const date = new Date(lastFetch);
    const hh = date.getHours().toString().padStart(2, "0");
    const mm = date.getMinutes().toString().padStart(2, "0");
    label = `Updated at ${hh}:${mm}`;
  }

  fetchBarEl.textContent = label;
  fetchBarEl.title = "Latest successful live player update. Each metric has its own source update time.";
  show(fetchBarEl);
}

function updateHeaderTimestamp(vms: CardViewModel[]): void {
  if (vms.some((vm) => vm.current === null || vm.freshness?.current?.status === "error")) {
    lastUpdatedEl.textContent = "Partial update";
    return;
  }
  const timestamps = vms.map((vm) => vm.fetchedAt).filter((timestamp) => timestamp > 0);
  if (!timestamps.length) return;
  lastUpdatedEl.textContent = fmtTimeAgo(Math.max(...timestamps));
}

function showState(state: "loading" | "empty" | "list" | "error"): void {
  hide(loadingEl);
  hide(errorStateEl);
  hide(gamesListEl);
  hide(emptyStateEl);
  hide(fetchBarEl);

  switch (state) {
    case "loading":
      show(loadingEl);
      break;
    case "empty":
      show(emptyStateEl);
      break;
    case "list":
      show(gamesListEl);
      break;
    case "error":
      show(errorStateEl);
      break;
  }
}

function showError(message: string): void {
  errorMsgEl.textContent = message;
  showState("error");
}

function firstGameInitial(name: string): string {
  return (name.match(/[A-Za-z0-9]/) ?? ["?"])[0]!.toUpperCase();
}

function svgIcon(children: SVGElement[]): SVGSVGElement {
  const svg = s("svg", {
    attrs: {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2.2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
  });
  children.forEach((child) => svg.appendChild(child));
  return svg;
}

function shareIcon(): SVGSVGElement {
  return svgIcon([
    s("circle", { attrs: { cx: "18", cy: "5", r: "3" } }),
    s("circle", { attrs: { cx: "6", cy: "12", r: "3" } }),
    s("circle", { attrs: { cx: "18", cy: "19", r: "3" } }),
    s("path", { attrs: { d: "M8.59 13.51L15.42 17.49" } }),
    s("path", { attrs: { d: "M15.41 6.51L8.59 10.49" } }),
  ]);
}

function starIcon(active: boolean): SVGSVGElement {
  const svg = svgIcon([
    s("polygon", {
      attrs: {
        points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2",
        fill: active ? "currentColor" : "none",
      },
    }),
  ]);
  svg.setAttribute("stroke-width", "2");
  return svg;
}

function chevronIcon(): SVGSVGElement {
  const svg = svgIcon([s("polyline", { attrs: { points: "6 9 12 15 18 9" } })]);
  svg.classList.add("chevron");
  svg.setAttribute("stroke-width", "2.5");
  svg.removeAttribute("stroke-linejoin");
  return svg;
}

function removeIcon(): SVGSVGElement {
  const svg = svgIcon([
    s("line", { attrs: { x1: "18", y1: "6", x2: "6", y2: "18" } }),
    s("line", { attrs: { x1: "6", y1: "6", x2: "18", y2: "18" } }),
  ]);
  svg.setAttribute("stroke-width", "2.5");
  return svg;
}

function copyIcon(): SVGSVGElement {
  return svgIcon([
    s("rect", { attrs: { x: "9", y: "9", width: "13", height: "13", rx: "2" } }),
    s("path", { attrs: { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" } }),
  ]);
}

function imageIcon(): SVGSVGElement {
  return svgIcon([
    s("rect", { attrs: { x: "3", y: "3", width: "18", height: "18", rx: "2" } }),
    s("circle", { attrs: { cx: "8.5", cy: "8.5", r: "1.5" } }),
    s("polyline", { attrs: { points: "21 15 16 10 5 21" } }),
  ]);
}

function showAutomaticError(): void {
  fetchBarEl.textContent = "Update failed — showing saved data. Retry with Refresh.";
  show(fetchBarEl);
}

async function refresh(automatic = false): Promise<void> {
  if (updating) return;
  updating = true;
  automaticError = false;
  refreshBtn.classList.add("spinning");
  refreshBtn.disabled = true;
  try {
    await requestRefresh(!automatic);
    await init();
  } catch (err) {
    console.error(`[SteamWatch] Refresh failed: ${formatError(err)}`);
    if (automatic && gamesListEl.children.length > 0) {
      automaticError = true;
      showAutomaticError();
    } else {
      showError("Unable to refresh game data. Please retry.");
    }
  } finally {
    updating = false;
    refreshBtn.classList.remove("spinning");
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", () => void refresh());

settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
openOptionsBtn?.addEventListener("click", () => chrome.runtime.openOptionsPage());
retryBtn?.addEventListener("click", () => void refresh());
bindGlobalShareBarClose(document);

startPopupUpdates(
  async () => {
    const [games, cache] = await Promise.all([getGames(), getCache()]);
    if (shouldRefreshGames(games, cache)) await refresh(true);
  },
  () => init(),
);
void init(true);
