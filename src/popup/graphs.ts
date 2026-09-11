import type { CardViewModel, FieldFreshness, GraphWindowKey, Snapshot } from "../types/index.js";
import { append, clear, h, s } from "../utils/html.js";
import { fmtNumber, fmtTimeAgo, computeWindowMin, computeRetentionAvg, computeRetentionGain } from "../utils/trend.js";
import { buildGraphSeries, colorGraphSegments, findNearestPointIndex, filterSnapshotsByWindow } from "../utils/sparkline.js";

const WINDOW_MS: Readonly<Record<GraphWindowKey, number>> = {
  "24h": 86_400_000,
  "3d": 3 * 86_400_000,
  "7d": 7 * 86_400_000,
  "15d": 15 * 86_400_000,
  "1m": 30 * 86_400_000,
  "all": 0,
};

export function populatePanel(panel: HTMLDivElement, vm: CardViewModel): void {
  const {
    game,
    current,
    peak24h,
    allTimePeak,
    twitchViewers,
    availableGraphWindows,
    defaultGraphWindow,
  } = vm;

  clear(panel);
  const availableKeys = new Set(availableGraphWindows.map((window) => window.key));
  panel.appendChild(buildGraphPills(availableKeys, defaultGraphWindow, panel, vm));
  if (availableKeys.size < 6) {
    panel.appendChild(h("p", {
      className: "history-notice",
      text: vm.historyLoading ? "Loading available history…" : vm.historyStatus?.state === "unavailable"
        ? "No history is available from the connected providers. Only available local observations can be shown."
        : vm.historyStatus?.state === "retry"
          ? "History download failed. Refresh retries the download; periods need enough coverage."
          : "Some periods lack enough observations. Legacy data and monthly peaks are excluded from player-count graphs.",
      attrs: { role: "status" },
    }));
  }

  const sparklinePanel = h("div", { className: "panel-sparkline" });
  const recordLowEl = h("div", { className: "panel-record-low" });

  append(
    panel,
    sparklinePanel,
    h("dl", {
      className: "panel-stats",
      children: [
        panelStat("Current", fmtNumber(current), vm.freshness?.current),
        panelStat("24h peak", fmtNumber(peak24h), vm.freshness?.peak24h),
        panelStat(allTimePeak === null ? "Observed peak" : "All-time peak", fmtNumber(allTimePeak ?? vm.observedPeak ?? null), allTimePeak === null ? undefined : vm.freshness?.allTimePeak),
        panelStat("Twitch viewers", twitchViewers != null ? fmtNumber(twitchViewers) : "—", vm.freshness?.twitchViewers),
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

  renderPanelGraph(panel, vm, defaultGraphWindow);
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
    const disabled = !availableKeys.has(key);
    const active = key === defaultGraphWindow;
    const button = h("button", {
      className: `graph-pill${active ? " graph-pill--active" : ""}${disabled ? " graph-pill--disabled" : ""}`,
      text: key === "all" ? "All" : key,
      attrs: {
        type: "button",
        disabled,
        "aria-disabled": disabled ? "true" : undefined,
        "aria-pressed": String(active),
        title: disabled ? "Not enough history to display this period." : undefined,
      },
      dataset: { window: key },
    });

    if (!disabled) {
      button.addEventListener("click", () => {
        bar.querySelectorAll<HTMLButtonElement>(".graph-pill").forEach((pill) => {
          pill.classList.toggle("graph-pill--active", pill === button);
          pill.setAttribute("aria-pressed", String(pill === button));
        });
        renderPanelGraph(panel, vm, key);
      });
    }
    bar.appendChild(button);
  });

  return bar;
}

export function freshnessTitle(freshness: FieldFreshness | undefined): string {
  if (!freshness) return "Source update time unknown";
  if (freshness.status === "unavailable") return `Not available from ${freshness.source}`;
  const acquired = freshness.acquiredAt === undefined ? "Update time unknown" : `Acquired ${fmtTimeAgo(freshness.acquiredAt)}`;
  return `${freshness.source} · ${acquired}${freshness.status === "error" ? " · Latest request failed" : ""}`;
}

function panelStat(label: string, value: string, freshness?: FieldFreshness): HTMLDivElement {
  return h("div", {
    className: "panel-stat",
    children: [
      h("dt", { className: "panel-stat-label", text: label }),
      h("dd", { className: "panel-stat-value", text: value, attrs: { title: freshness ? freshnessTitle(freshness) : undefined } }),
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

function fmtSignedPlayers(value: number): string {
  const abs = fmtNumber(Math.abs(value));
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return "0";
}

function renderPanelGraph(panel: HTMLDivElement, vm: CardViewModel, key: GraphWindowKey | null): void {
  const container = panel.querySelector<HTMLDivElement>(".panel-sparkline");
  if (!container) return;
  const cleanup = container as HTMLDivElement & { hoverCleanup?: () => void };
  cleanup.hoverCleanup?.();
  delete cleanup.hoverCleanup;
  clear(container);
  const now = vm.evaluatedAt ?? Date.now();
  const windowMs = key ? WINDOW_MS[key] : 0;
  const result = renderSparkline(vm.snaps, { width: 372, height: 56, maxPoints: 200, strokeColor: "#00c8ff", windowMs, now });
  container.hidden = !result;
  if (result) {
    container.appendChild(result.svg);
    cleanup.hoverCleanup = attachSparklineHover(container, result.points, result.points);
  }
  const selected = filterSnapshotsByWindow(vm.snaps, windowMs, now);
  const days = (windowMs || (now - (selected[0]?.ts ?? now))) / 86_400_000;
  const avg = days > 0 ? computeRetentionAvg(selected, days, now) : undefined;
  const gain = days > 0 ? computeRetentionGain(selected, days, now) : undefined;
  let stats = panel.querySelector<HTMLDListElement>(".period-stats");
  if (!stats) {
    stats = h("dl", { className: "panel-stats period-stats" });
    panel.querySelector(".panel-stats")?.after(stats);
  }
  clear(stats);
  const label = key === "all" || key === null ? "Available" : key;
  const low = computeWindowMin(selected);
  const peak = selected.length ? Math.max(...selected.map((point) => point.current)) : null;
  append(stats,
    panelStat(`${label} average`, avg == null ? "—" : fmtNumber(avg)),
    panelStat(`${label} change`, gain == null ? "—" : fmtSignedPlayers(gain)),
    panelStat("Observed minimum", low ? fmtNumber(low.value) : "—"),
    panelStat("Observed maximum", peak === null ? "—" : fmtNumber(peak)),
  );
  const caption = panel.querySelector<HTMLDivElement>(".panel-record-low");
  if (caption) {
    caption.hidden = false;
    const fallbackCredit = selected.some((point) => point.source === "games-popularity") ? " · Games Popularity" : "";
    caption.textContent = result
      ? `${new Date(result.startTs).toLocaleString()} – ${new Date(result.endTs).toLocaleString()} · ${Math.round(result.coverage * 100)}% hourly coverage${fallbackCredit}`
      : "Waiting for qualified player observations.";
  }
}

function attachSparklineHover(
  container: HTMLDivElement,
  points: ReadonlyArray<{ x: number; y: number }>,
  snaps: readonly { ts: number; current: number }[],
): () => void {
  const viewW = 372;
  const viewH = 56;

  const tooltip = h("div", { className: "sparkline-tooltip", attrs: { hidden: true } });
  const hoverLine = h("div", { className: "sparkline-hover-line", attrs: { hidden: true } });
  const hoverDot = h("div", { className: "sparkline-hover-dot", attrs: { hidden: true } });
  append(container, tooltip, hoverLine, hoverDot);

  function onMouseMove(event: MouseEvent): void {
    const rect = (container.querySelector("svg") ?? container).getBoundingClientRect();
    const domX = event.clientX - rect.left;
    const domW = rect.width;
    if (domW <= 0) return;

    const svgX = (domX / domW) * viewW;
    const index = findNearestPointIndex(svgX, points);
    const snap = snaps[index];
    if (!snap) return;

    const point = points[index]!;
    const outer = container.getBoundingClientRect();
    const pctX = ((rect.left - outer.left + point.x / viewW * rect.width) / outer.width) * 100;
    const pctY = ((rect.top - outer.top + point.y / viewH * rect.height) / outer.height) * 100;

    tooltip.textContent = `${fmtNumber(snap.current)} · ${new Date(snap.ts).toLocaleString()}`;
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

export function renderSparkline(
  snapshots: readonly Snapshot[],
  opts: { width: number; height: number; maxPoints: number; strokeColor: string; windowMs?: number; now?: number },
) {
  const series = buildGraphSeries(snapshots, opts.windowMs ?? WINDOW_MS["24h"], opts.now ?? Date.now(), opts.width, opts.height, opts.maxPoints);
  const points = series.segments.flatMap((segment) => [...segment.points]);
  if (!points.length) return null;
  const svg = s("svg", { attrs: { viewBox: `0 0 ${opts.width} ${opts.height}`, preserveAspectRatio: "none", role: "img", "aria-label": "Steam player observations; gaps indicate missing data" } });
  svg.appendChild(s("title", { text: "Player counts: green rises, red falls, cyan changes under 2% between plotted observations. Gaps mean missing data. Seasonal trend is shown separately in the badge." }));
  for (const segment of colorGraphSegments(series)) {
    if (segment.points.length === 1) {
      const point = segment.points[0]!;
      svg.appendChild(s("circle", { attrs: { cx: point.x, cy: point.y, r: 1.5, fill: segment.color } }));
    } else {
      svg.appendChild(s("polyline", { attrs: { points: segment.points.map((point) => `${point.x},${point.y}`).join(" "), fill: "none", stroke: segment.color, "stroke-width": 1.8, "stroke-linejoin": "round", "stroke-linecap": "round" } }));
    }
  }
  return { svg, points, startTs: series.startTs, endTs: series.endTs, coverage: series.coverage };
}
