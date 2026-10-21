import type { CardViewModel, FieldFreshness, GraphWindowKey, Snapshot } from "../types/index.js";
import { append, clear, h, s } from "../utils/html.js";
import { HOUR_MS, normalizeHourly } from "../utils/series.js";
import { buildGraphSeries, colorGraphSegments, findNearestPointIndex } from "../utils/sparkline.js";
import {
  computeRetentionAvgFromHourly,
  computeRetentionGainFromHourly,
  fmtNumber,
  fmtTimeAgo,
} from "../utils/trend.js";

const WINDOW_MS: Readonly<Record<GraphWindowKey, number>> = {
  "24h": 86_400_000,
  "3d": 3 * 86_400_000,
  "7d": 7 * 86_400_000,
  "15d": 15 * 86_400_000,
  "1m": 30 * 86_400_000,
  all: 0,
};

export function populatePanel(panel: HTMLDivElement, vm: CardViewModel): void {
  const { game, current, peak24h, allTimePeak, twitchViewers, availableGraphWindows, defaultGraphWindow } = vm;

  clear(panel);
  const availableKeys = new Set(availableGraphWindows.map((window) => window.key));
  panel.appendChild(buildGraphPills(availableKeys, defaultGraphWindow, panel, vm));
  const sparklinePanel = h("div", { className: "panel-sparkline" });

  append(
    panel,
    sparklinePanel,
    h("dl", {
      className: "panel-stats",
      children: [
        panelStat("Current", fmtNumber(current), vm.freshness?.current),
        panelStat("24h peak", fmtNumber(peak24h), vm.freshness?.peak24h),
        panelStat(
          allTimePeak === null ? "Observed peak" : "All-time peak",
          fmtNumber(allTimePeak ?? vm.observedPeak ?? null),
          allTimePeak === null ? undefined : athTitle(vm),
        ),
        panelStat(
          "Twitch viewers",
          twitchViewers != null ? fmtNumber(twitchViewers) : "—",
          vm.freshness?.twitchViewers,
        ),
      ],
    }),
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
  const acquired =
    freshness.acquiredAt === undefined ? "Update time unknown" : `Acquired ${fmtTimeAgo(freshness.acquiredAt)}`;
  return `${freshness.source} · ${acquired}${freshness.status === "error" ? " · Latest request failed" : ""}`;
}

function panelStat(label: string, value: string, context?: FieldFreshness | string): HTMLDivElement {
  return h("div", {
    className: "panel-stat",
    children: [
      h("dt", { className: "panel-stat-label", text: label }),
      h("dd", {
        className: "panel-stat-value",
        text: value,
        attrs: { title: typeof context === "string" ? context : context ? freshnessTitle(context) : undefined },
      }),
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
  const result = renderSparkline(vm.snaps, { width: 372, height: 56, maxPoints: 200, windowMs, now });
  container.hidden = !result;
  if (result) {
    container.appendChild(result.svg);
    cleanup.hoverCleanup = attachSparklineHover(container, result.points, result.points);
  }
  const hourly = normalizeHourly(vm.snaps, now);
  const completedHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const windowStart = windowMs === 0 ? Number.NEGATIVE_INFINITY : completedHour - windowMs;
  const completed = hourly.filter((point) => point.hour >= windowStart && point.hour < completedHour);
  const first = completed[0];
  const last = completed.at(-1);
  const availableSummary =
    first && last && completed.length >= 2 && completed.length / ((last.hour - first.hour) / HOUR_MS + 1) >= 0.8
      ? {
          average: Math.round(completed.reduce((sum, point) => sum + point.value, 0) / completed.length),
          change: last.value - first.value,
          title: `Available observed hours. Missing hours excluded. First observation: ${new Date(first.observedAt).toISOString()} · Last observation: ${new Date(last.observedAt).toISOString()} (UTC).`,
        }
      : null;
  const days = windowMs / 86_400_000;
  const avg = windowMs === 0 ? availableSummary?.average : computeRetentionAvgFromHourly(hourly, days, now);
  const gain = windowMs === 0 ? availableSummary?.change : computeRetentionGainFromHourly(hourly, days, now);
  const summaryTitle = windowMs === 0 ? availableSummary?.title : undefined;
  let stats = panel.querySelector<HTMLDListElement>(".period-stats");
  if (!stats) {
    stats = h("dl", { className: "panel-stats period-stats" });
    panel.querySelector(".panel-stats")?.after(stats);
  }
  clear(stats);
  const label = key === "all" || key === null ? "All" : key;
  // Hourly medians, same series as average: a single outlier sample cannot set the extremes.
  const values = completed.map((point) => Math.round(point.value));
  const low = values.length ? Math.min(...values) : null;
  const peak = values.length ? Math.max(...values) : null;
  append(
    stats,
    panelStat(`${label} average`, avg == null ? "—" : fmtNumber(avg), summaryTitle),
    panelStat(`${label} change`, gain == null ? "—" : fmtSignedPlayers(gain), summaryTitle),
    panelStat(`${label} minimum`, fmtNumber(low), lowTitle(vm)),
    panelStat(`${label} maximum`, fmtNumber(peak)),
  );
  const fallbackCredit = completed.some((point) => point.source === "games-popularity") ? " · Games Popularity" : "";
  // Source note lives on the stats, not the graph, so it never overlaps the hover tooltip.
  stats.title = result
    ? `${new Date(result.startTs).toLocaleString()} – ${new Date(result.endTs).toLocaleString()} · ${Math.round(result.coverage * 100)}% hourly coverage overall${fallbackCredit}${last ? ` · History ${fmtTimeAgo(last.observedAt, now)}` : ""}`
    : "Waiting for qualified player observations.";
}

function athTitle(vm: CardViewModel): string {
  const source = freshnessTitle(vm.freshness?.allTimePeak);
  return vm.allTimePeakLabel ? `Reached ${vm.allTimePeakLabel} · ${source}` : source;
}

function lowTitle(vm: CardViewModel): string | undefined {
  const low = vm.allTimeLow;
  return low ? `Lowest tracked: ${fmtNumber(low.value)} on ${new Date(low.timestamp).toLocaleDateString()}` : undefined;
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
    const pctX = ((rect.left - outer.left + (point.x / viewW) * rect.width) / outer.width) * 100;
    const pctY = ((rect.top - outer.top + (point.y / viewH) * rect.height) / outer.height) * 100;

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
  opts: { width: number; height: number; maxPoints: number; windowMs?: number; now?: number },
) {
  const series = buildGraphSeries(
    snapshots,
    opts.windowMs ?? WINDOW_MS["24h"],
    opts.now ?? Date.now(),
    opts.width,
    opts.height,
    opts.maxPoints,
  );
  const points = series.segments.flatMap((segment) => [...segment.points]);
  if (!points.length) return null;
  const svg = s("svg", {
    attrs: {
      viewBox: `0 0 ${opts.width} ${opts.height}`,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": "Steam player observations; gaps indicate missing data",
    },
  });
  svg.appendChild(
    s("title", {
      text: "Player counts: green rises, red falls, cyan changes under 2% between plotted observations. Gaps mean missing data. Seasonal trend is shown separately in the badge.",
    }),
  );
  for (const segment of colorGraphSegments(series)) {
    if (segment.points.length === 1) {
      const point = segment.points[0]!;
      svg.appendChild(s("circle", { attrs: { cx: point.x, cy: point.y, r: 1.5, fill: segment.color } }));
    } else {
      svg.appendChild(
        s("polyline", {
          attrs: {
            points: segment.points.map((point) => `${point.x},${point.y}`).join(" "),
            fill: "none",
            stroke: segment.color,
            "stroke-width": 1.8,
            "stroke-linejoin": "round",
            "stroke-linecap": "round",
          },
        }),
      );
    }
  }
  return { svg, points, startTs: series.startTs, endTs: series.endTs, coverage: series.coverage };
}
