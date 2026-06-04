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
import { idbGetSnapshots, idbGetSnapshotsInRange } from "../utils/idb-storage.js";
import { fmtNumber, fmtPct, fmtTimeAgo, computeWindowMin } from "../utils/trend.js";
import {
  downsampleSnapshotsForGraph,
  findNearestPointIndex,
  sparklineColor,
  mapToPoints,
} from "../utils/sparkline.js";
import { buildAllViewModels } from "../utils/card.js";
import { buildShareText, renderShareCanvas } from "../utils/share.js";
import { append, clear, h, mustGet, s, show, hide } from "../utils/html.js";
import { formatError } from "../utils/log.js";
import { bindGlobalShareBarClose } from "./shareBar.js";
import { thumbColor, wireThumbFallback } from "./thumb.js";

import type {
  CardViewModel,
  GraphWindowKey,
  MessageRequest,
  MessageResponse,
  Snapshot,
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

const WINDOW_MS: Readonly<Record<GraphWindowKey, number>> = {
  "24h": 86_400_000,
  "3d": 3 * 86_400_000,
  "7d": 7 * 86_400_000,
  "15d": 15 * 86_400_000,
  "1m": 30 * 86_400_000,
  "all": 0,
};

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

    const vms = await buildAllViewModels(games, cache, idbGetSnapshots, TRACKING_RETENTION_DAYS);
    if (vms.some(needsRichDataHydration)) {
      try {
        await chrome.runtime.sendMessage<MessageRequest, MessageResponse>({ type: "FETCH_NOW" });
        const freshCache = await getCache();
        vms.splice(0, vms.length, ...(await buildAllViewModels(games, freshCache, idbGetSnapshots, TRACKING_RETENTION_DAYS)));
      } catch (err) {
        console.error(`[SteamWatch popup] Rich data hydration failed: ${formatError(err)}`);
      }
    }

    vms.sort((a, b) => (b.current ?? -1) - (a.current ?? -1));
    renderGames(vms, settings.badgeFavoriteAppid);
    updateFetchBar(lastFetch);
    updateHeaderTimestamp(vms);
    showState("list");
  } catch (err) {
    console.error(`[SteamWatch popup] ${formatError(err)}`);
    showError("Failed to load SteamWatch data.");
  }
}

function renderGames(vms: CardViewModel[], favoriteAppid?: string): void {
  clear(gamesListEl);

  vms.forEach((vm, index) => {
    const rankEmoji = vms.length > 1
      ? index === 0 ? "1" : index === 1 ? "2" : index === 2 ? "3" : ""
      : "";
    gamesListEl.appendChild(buildGameItem(vm, rankEmoji, index === 0, favoriteAppid));
    if (index < vms.length - 1) {
      gamesListEl.appendChild(h("li", { className: "game-divider", attrs: { "aria-hidden": "true" } }));
    }
  });

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
  const li = h("li", { className: "game-item" });
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
      attrs: { "aria-label": `${fmtNumber(current)} concurrent players` },
    }),
    h("div", {
      className: "stat-meta",
      children: [
        statRow("24H PK", "24-hour peak", peak24h),
        statRow("ATH", "all-time peak", allTimePeak),
      ],
    }),
  );
  if (displayTrendPct != null) {
    stats.appendChild(h("span", {
      className: `trend-badge ${displayTrendCls}`,
      text: `${displayTrendIcon ? `${displayTrendIcon} ` : ""}${fmtPct(displayTrendPct)}`,
      attrs: { "aria-label": `Trend ${fmtPct(displayTrendPct)}` },
    }));
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

function populatePanel(panel: HTMLDivElement, vm: CardViewModel): void {
  const {
    game,
    current,
    peak24h,
    allTimePeak,
    twitchViewers,
    avg24h,
    gain24h,
    retentionAvg,
    retentionGain,
    retentionWindowLabel,
    availableGraphWindows,
    defaultGraphWindow,
  } = vm;

  clear(panel);
  const availableKeys = new Set(availableGraphWindows.map((window) => window.key));
  if (availableKeys.size > 0) {
    panel.appendChild(buildGraphPills(availableKeys, defaultGraphWindow, panel, vm));
  }

  const sparklinePanel = h("div", { className: "panel-sparkline", attrs: { "aria-hidden": "true" } });
  const recordLowEl = h("div", { className: "panel-record-low" });

  append(
    panel,
    sparklinePanel,
    h("dl", {
      className: "panel-stats",
      children: [
        panelStat("Current", fmtNumber(current)),
        panelStat("24h peak", fmtNumber(peak24h)),
        panelStat("All-time peak", fmtNumber(allTimePeak)),
        panelStat("Twitch viewers", twitchViewers != null ? fmtNumber(twitchViewers) : "—"),
        panelStat("24h average", avg24h != null ? fmtNumber(avg24h) : "—"),
        panelStat("24h gain/loss", gain24h != null ? fmtSignedPlayers(gain24h) : "—"),
        panelStat(`${retentionWindowLabel} average`, retentionAvg != null ? fmtNumber(retentionAvg) : "—"),
        panelStat(`${retentionWindowLabel} gain/loss`, retentionGain != null ? fmtSignedPlayers(retentionGain) : "—"),
      ],
    }),
    recordLowEl,
    h("div", {
      className: "panel-links",
      children: [
        panelLink(`https://store.steampowered.com/app/${game.appid}`, "Steam"),
        panelLink(`https://steamdb.info/app/${game.appid}`, "SteamDB"),
      ],
    }),
  );

  updateRecordLowElement(recordLowEl, defaultGraphWindow ?? "all", vm.recordLow, vm.allTimeLow);
  void renderPanelSparklineFromIdb(panel, game.appid, defaultGraphWindow);
}

function buildGraphPills(
  availableKeys: Set<GraphWindowKey>,
  defaultGraphWindow: GraphWindowKey | null,
  panel: HTMLDivElement,
  vm: CardViewModel,
): HTMLDivElement {
  const allKeys: GraphWindowKey[] = ["24h", "3d", "7d", "15d", "1m", "all"];
  const bar = h("div", { className: "graph-pill-bar", attrs: { role: "group", "aria-label": "Graph time range" } });

  allKeys.forEach((key) => {
    const disabled = key !== "all" && !availableKeys.has(key);
    const active = key === defaultGraphWindow;
    const button = h("button", {
      className: `graph-pill${active ? " graph-pill--active" : ""}${disabled ? " graph-pill--disabled" : ""}`,
      text: key === "all" ? "All" : key,
      attrs: {
        type: "button",
        disabled,
        "aria-disabled": disabled ? "true" : undefined,
      },
      dataset: { window: key },
    });

    if (!disabled) {
      button.addEventListener("click", () => {
        bar.querySelectorAll<HTMLButtonElement>(".graph-pill").forEach((pill) => {
          pill.classList.toggle("graph-pill--active", pill === button);
        });
        void renderPanelSparklineFromIdb(panel, vm.game.appid, key);
        void refreshRecordLow(panel, vm, key);
      });
    }
    bar.appendChild(button);
  });

  return bar;
}

function panelStat(label: string, value: string): HTMLDivElement {
  return h("div", {
    className: "panel-stat",
    children: [
      h("dt", { className: "panel-stat-label", text: label }),
      h("dd", { className: "panel-stat-value", text: value }),
    ],
  });
}

function panelLink(href: string, text: string): HTMLAnchorElement {
  return h("a", {
    className: "panel-link",
    text,
    attrs: {
      href,
      target: "_blank",
      rel: "noopener noreferrer",
    },
  });
}

async function refreshRecordLow(panel: HTMLDivElement, vm: CardViewModel, key: GraphWindowKey): Promise<void> {
  const recordLowEl = panel.querySelector<HTMLDivElement>(".panel-record-low");
  if (!recordLowEl || !vm.allTimeLow) return;

  const snaps = key === "all"
    ? await idbGetSnapshots(vm.game.appid)
    : await idbGetSnapshotsInRange(vm.game.appid, Date.now() - WINDOW_MS[key], Date.now());
  updateRecordLowElement(recordLowEl, key, computeWindowMin(snaps), vm.allTimeLow);
}

function updateRecordLowElement(
  el: HTMLDivElement,
  key: GraphWindowKey,
  windowLow: { value: number; timestamp: number } | null,
  allTimeLow: { value: number; timestamp: number } | null,
): void {
  if (!allTimeLow) {
    el.hidden = true;
    clear(el);
    return;
  }

  el.hidden = false;
  clear(el);
  append(
    el,
    `${key === "all" ? "All" : key} Low: `,
    h("span", { className: "panel-record-low-val", text: windowLow ? fmtNumber(windowLow.value) : "—" }),
    " • All-time Low: ",
    h("span", { className: "panel-record-low-val", text: fmtNumber(allTimeLow.value) }),
  );
}

function needsRichDataHydration(vm: CardViewModel): boolean {
  if (vm.current == null) return false;
  return vm.peak24h == null || vm.allTimePeak == null || vm.twitchViewers == null;
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

  const containerWithCleanup = sparklineEl as HTMLDivElement & { hoverCleanup?: () => void };
  containerWithCleanup.hoverCleanup?.();
  containerWithCleanup.hoverCleanup = undefined;
  clear(sparklineEl);

  const snaps = selectedWindow === null || selectedWindow === "all"
    ? await idbGetSnapshots(appId)
    : await idbGetSnapshotsInRange(appId, Date.now() - WINDOW_MS[selectedWindow], Date.now());

  const graphSnaps = downsampleSnapshotsForGraph([...snaps], 96);
  const result = renderSparkline(graphSnaps, {
    strokeColor: sparklineColor(graphSnaps),
    width: 372,
    height: 56,
    maxPoints: 96,
  });

  sparklineEl.hidden = !result;
  if (!result) return;

  sparklineEl.appendChild(result.svg);
  containerWithCleanup.hoverCleanup = attachSparklineHover(sparklineEl, result.points, graphSnaps);
}

function attachSparklineHover(
  container: HTMLDivElement,
  points: ReadonlyArray<{ x: number; y: number }>,
  snaps: readonly Snapshot[],
): () => void {
  const viewW = 372;
  const viewH = 56;

  const tooltip = h("div", { className: "sparkline-tooltip", attrs: { hidden: true } });
  const hoverLine = h("div", { className: "sparkline-hover-line", attrs: { hidden: true } });
  const hoverDot = h("div", { className: "sparkline-hover-dot", attrs: { hidden: true } });
  append(container, tooltip, hoverLine, hoverDot);

  function onMouseMove(event: MouseEvent): void {
    const rect = container.getBoundingClientRect();
    const domX = event.clientX - rect.left;
    const domW = rect.width;
    if (domW <= 0) return;

    const svgX = (domX / domW) * viewW;
    const index = findNearestPointIndex(svgX, points);
    const snap = snaps[index];
    if (!snap) return;

    const point = points[index]!;
    const pctX = (point.x / viewW) * 100;
    const pctY = (point.y / viewH) * 100;

    tooltip.textContent = fmtNumber(snap.current);
    tooltip.hidden = false;
    hoverLine.hidden = false;
    hoverDot.hidden = false;

    hoverLine.style.left = `${pctX}%`;
    hoverDot.style.left = `${pctX}%`;
    hoverDot.style.top = `${pctY}%`;

    const tooltipW = tooltip.offsetWidth;
    const containerW = container.offsetWidth;
    if (containerW > 0 && tooltipW > 0) {
      const halfTooltipPct = (tooltipW / 2 / containerW) * 100;
      tooltip.style.left = `${Math.max(halfTooltipPct, Math.min(pctX, 100 - halfTooltipPct))}%`;
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

  return () => {
    container.removeEventListener("mousemove", onMouseMove);
    container.removeEventListener("mouseleave", onMouseLeave);
  };
}

function renderSparkline(
  snapshots: readonly Snapshot[],
  opts: { width: number; height: number; maxPoints: number; strokeColor: string },
): { svg: SVGSVGElement; points: ReadonlyArray<{ x: number; y: number }> } | null {
  const sliced = snapshots.slice(-opts.maxPoints);
  if (sliced.length < 2) return null;

  const values = sliced.map((snapshot) => snapshot.current);
  const points = mapToPoints(values, opts.width, opts.height);
  const svg = s("svg", {
    attrs: {
      viewBox: `0 0 ${opts.width} ${opts.height}`,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
      role: "img",
    },
  });

  const fillPoints = [
    ...points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`),
    `${points[points.length - 1]!.x.toFixed(1)},${opts.height}`,
    `${points[0]!.x.toFixed(1)},${opts.height}`,
  ].join(" ");
  svg.appendChild(s("polygon", {
    attrs: {
      points: fillPoints,
      fill: "rgba(0,200,255,0.08)",
    },
  }));

  points.slice(1).forEach((point, index) => {
    const previous = points[index]!;
    svg.appendChild(s("line", {
      attrs: {
        x1: previous.x.toFixed(1),
        y1: previous.y.toFixed(1),
        x2: point.x.toFixed(1),
        y2: point.y.toFixed(1),
        stroke: segmentColor(values[index]!, values[index + 1]!),
        "stroke-width": "1.8",
        "stroke-linecap": "round",
      },
    }));
  });

  svg.appendChild(s("polyline", {
    attrs: {
      points: points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "),
      fill: "none",
      stroke: opts.strokeColor,
      "stroke-width": "0.01",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      opacity: "0",
    },
  }));

  return { svg, points };
}

function segmentColor(prev: number, next: number): string {
  if (prev <= 0) return "#00c8ff";
  const pct = ((next - prev) / prev) * 100;
  if (pct >= 8) return "#16a34a";
  if (pct >= 2) return "#22c55e";
  if (pct <= -8) return "#dc2626";
  if (pct <= -2) return "#ef4444";
  return "#00c8ff";
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
    try {
      await chrome.runtime.sendMessage<MessageRequest, MessageResponse>({ type: "FETCH_NOW" });
    } catch (err) {
      console.warn(`[SteamWatch] Favorite badge refresh failed: ${formatError(err)}`);
    }
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
  show(fetchBarEl);
}

function updateHeaderTimestamp(vms: CardViewModel[]): void {
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

refreshBtn.addEventListener("click", async () => {
  refreshBtn.classList.add("spinning");
  refreshBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage<MessageRequest, MessageResponse>({ type: "FETCH_NOW" });
    await init();
  } catch (err) {
    console.error(`[SteamWatch] Refresh failed: ${formatError(err)}`);
  } finally {
    refreshBtn.classList.remove("spinning");
    refreshBtn.disabled = false;
  }
});

settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
openOptionsBtn?.addEventListener("click", () => chrome.runtime.openOptionsPage());
retryBtn?.addEventListener("click", () => void init());
bindGlobalShareBarClose(document);

void init();
