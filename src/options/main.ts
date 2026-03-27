// SteamWatch — src/options/main.ts
import {
  getGames,
  addGame,
  removeGame,
  getSettings,
  saveSettings,
  getGameSettings,
  saveGameSettings,
  clearAllData,
  MAX_GAMES,
} from "../utils/storage.js";
import { idbGetSnapshots } from "../utils/idb-storage.js";
import { searchGames } from "../utils/api.js";
import { esc, mustGet, show, hide } from "../utils/html.js";
import type { Game, GameSettings, MessageRequest, MessageResponse } from "../types/index.js";
import { buildExportRows, rowsToJSON, rowsToCSV, downloadFile, exportFilename } from "../utils/exporter.js";
import { buildDayMask, maskToDays, DAY_LABELS } from "../utils/quietHours.js";
import { wireThumbFallback } from "../popup/thumb.js";
import {
  filterSnapshotsByWindow,
  downsampleSnapshotsForGraph,
  mapToPoints,
  buildAvailableGraphWindows,
  sparklineColor,
} from "../utils/sparkline.js";
import { fmtNumber, compute24hAvg, computeRetentionAvg, computeLocalPeak } from "../utils/trend.js";


// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const section = btn.dataset["section"];
    if (!section) return;

    document.querySelectorAll(".nav-item").forEach((n) => {
      n.classList.remove("active");
      n.removeAttribute("aria-current");
    });
    document.querySelectorAll<HTMLElement>(".section").forEach((s) => {
      s.classList.remove("active");
      s.hidden = true;
    });

    btn.classList.add("active");
    btn.setAttribute("aria-current", "page");

    const secEl = document.getElementById(`sec-${section}`);
    if (secEl) {
      secEl.classList.add("active");
      secEl.hidden = false;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GAMES SECTION
// ══════════════════════════════════════════════════════════════════════════════

const gameSearchEl = mustGet<HTMLInputElement>("gameSearch");
const acListEl     = mustGet<HTMLUListElement>("autocompleteList");
const gamesRowsEl  = mustGet<HTMLUListElement>("gamesRows");
const noGamesHint  = mustGet<HTMLLIElement>("noGamesHint");
const countBadge   = mustGet<HTMLSpanElement>("gameCountBadge");

// ── Render tracked games ──────────────────────────────────────────────────────

async function renderGames(): Promise<void> {
  const games = await getGames();
  countBadge.textContent = `${games.length} / ${MAX_GAMES}`;

  // Clear existing rows (keep the no-games hint in the DOM)
  const existingRows = gamesRowsEl.querySelectorAll(".game-row");
  existingRows.forEach((r) => r.remove());

  if (games.length === 0) {
    show(noGamesHint);
    return;
  }
  hide(noGamesHint);

  for (const game of games) {
    const gs = await getGameSettings(game.appid);
    gamesRowsEl.appendChild(buildGameRow(game, gs));
  }
}

function buildGameRow(game: Game, gs: GameSettings): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "game-row";
  li.dataset["appid"] = game.appid;

  li.innerHTML = `
    <div class="game-row-header">
      <img class="game-row-thumb" src="${esc(game.image)}" alt="${esc(game.name)}" loading="lazy">
      <span class="game-row-name" title="${esc(game.name)}">${esc(game.name)}</span>
      <span class="game-row-appid">appid: ${esc(game.appid)}</span>
      <button class="btn-expand" aria-expanded="false" aria-label="Toggle settings for ${esc(game.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <button class="btn-del" data-appid="${esc(game.appid)}" aria-label="Remove ${esc(game.name)}">Remove</button>
    </div>

    <div class="game-row-settings" aria-label="Per-game settings">
      <div class="settings-grid">
        <div class="setting-group">
          <label class="setting-label" for="gs-up-${esc(game.appid)}">📈 Rise threshold (%)</label>
          <input class="input-sm" type="number" id="gs-up-${esc(game.appid)}" name="thresholdUp"
                 placeholder="Global default" min="1" max="200" value="${gs.thresholdUp ?? ""}">
          <span class="setting-hint">Overrides global rise alert %.</span>
        </div>
        <div class="setting-group">
          <label class="setting-label" for="gs-down-${esc(game.appid)}">📉 Drop threshold (%)</label>
          <input class="input-sm" type="number" id="gs-down-${esc(game.appid)}" name="thresholdDown"
                 placeholder="Global default" min="1" max="200" value="${gs.thresholdDown != null ? Math.abs(gs.thresholdDown) : ""}">
          <span class="setting-hint">Overrides global drop alert %.</span>
        </div>
        <div class="setting-group">
          <label class="setting-label" for="gs-crash-${esc(game.appid)}">💀 Crash threshold (%)</label>
          <input class="input-sm" type="number" id="gs-crash-${esc(game.appid)}" name="crashThreshold"
                 placeholder="Global default" min="1" max="200" value="${gs.crashThreshold != null ? Math.abs(gs.crashThreshold) : ""}">
          <span class="setting-hint">Overrides global crash alert %.</span>
        </div>
        <div class="setting-group">
          <label class="setting-label" for="gs-abs-${esc(game.appid)}">🎯 Absolute player alert</label>
          <input class="input-sm" type="number" id="gs-abs-${esc(game.appid)}" name="notifyThresholdPlayers"
                 placeholder="e.g. 100000" min="0" value="${gs.notifyThresholdPlayers ?? ""}">
          <span class="setting-hint">Alert when concurrent players hit this number.</span>
        </div>
      </div>
      <div class="per-game-actions">
        <label class="toggle" aria-label="Notifications for this game">
          <input type="checkbox" name="notificationsEnabled"
                 ${gs.notificationsEnabled !== false ? "checked" : ""}>
          <span class="toggle-slider"></span>
        </label>
        <span class="setting-label" style="margin:0;">Notifications for this game</span>
        <button class="btn-save small" style="margin-left:auto;" data-save-game="${esc(game.appid)}">Save</button>
      </div>
    </div>
  `;

  // ── Image: CSP-safe error handler (inline onerror blocked by MV3)
  const rowImg = li.querySelector<HTMLImageElement>(".game-row-thumb")!;
  wireThumbFallback(rowImg, rowImg, game.appid);
  rowImg.addEventListener("error", () => {
    if (rowImg.src.includes("header.jpg")) {
      rowImg.style.display = "none";
    }
  });

  // ── Expand/collapse
  const expandBtn = li.querySelector<HTMLButtonElement>(".btn-expand")!;
  expandBtn.addEventListener("click", () => {
    const isOpen = li.classList.toggle("open");
    expandBtn.setAttribute("aria-expanded", String(isOpen));
  });

  // ── Remove
  li.querySelector<HTMLButtonElement>(".btn-del")!.addEventListener("click", async () => {
    if (confirm(`Remove "${game.name}" from SteamWatch?`)) {
      try {
        await removeGame(game.appid);
        await renderGames();
      } catch (err) {
        alert(`Error removing game: ${String(err)}`);
      }
    }
  });

  // ── Save per-game settings
  li.querySelector<HTMLButtonElement>(`[data-save-game]`)!.addEventListener("click", async () => {
    const partial: GameSettings = {};

    const upVal    = li.querySelector<HTMLInputElement>("[name='thresholdUp']")!.value;
    const downVal  = li.querySelector<HTMLInputElement>("[name='thresholdDown']")!.value;
    const crashVal = li.querySelector<HTMLInputElement>("[name='crashThreshold']")!.value;
    const absVal   = li.querySelector<HTMLInputElement>("[name='notifyThresholdPlayers']")!.value;
    const notifOn  = li.querySelector<HTMLInputElement>("[name='notificationsEnabled']")!.checked;

    if (upVal)    partial.thresholdUp = Number(upVal);
    if (downVal)  partial.thresholdDown = -Math.abs(Number(downVal));
    if (crashVal) partial.crashThreshold = -Math.abs(Number(crashVal));
    if (absVal)   partial.notifyThresholdPlayers = Number(absVal);
    partial.notificationsEnabled = notifOn;

    try {
      await saveGameSettings(game.appid, partial);
      flashSaveButton(li.querySelector<HTMLButtonElement>("[data-save-game]")!);
    } catch (err) {
      alert(`Error saving settings: ${String(err)}`);
    }
  });

  return li;
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

let searchTimer: ReturnType<typeof setTimeout> | null = null;

gameSearchEl.addEventListener("input", () => {
  if (searchTimer) clearTimeout(searchTimer);
  const query = gameSearchEl.value.trim();

  if (query.length < 2) {
    acListEl.hidden = true;
    acListEl.innerHTML = "";
    return;
  }

  acListEl.hidden = false;
  acListEl.innerHTML = `<li class="ac-status" role="status">Searching…</li>`;
  searchTimer = setTimeout(() => void runSearch(query), 300);
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  if (!gameSearchEl.closest(".search-wrap")?.contains(e.target as Node)) {
    acListEl.hidden = true;
  }
});

// Keyboard navigation in autocomplete
gameSearchEl.addEventListener("keydown", (e) => {
  const items = acListEl.querySelectorAll<HTMLLIElement>(".autocomplete-item");
  const focused = acListEl.querySelector<HTMLLIElement>("[aria-selected='true']");

  if (e.key === "Escape") {
    acListEl.hidden = true;
    return;
  }
  if (!items.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = focused ? (focused.nextElementSibling as HTMLLIElement | null) : items[0];
    focused?.removeAttribute("aria-selected");
    next?.setAttribute("aria-selected", "true");
    next?.scrollIntoView({ block: "nearest" });
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = focused?.previousElementSibling as HTMLLIElement | null;
    focused?.removeAttribute("aria-selected");
    prev?.setAttribute("aria-selected", "true");
    prev?.scrollIntoView({ block: "nearest" });
  }

  if (e.key === "Enter" && focused) {
    e.preventDefault();
    focused.click();
  }
});

async function runSearch(query: string): Promise<void> {
  const results = await searchGames(query);

  if (results.length === 0) {
    acListEl.innerHTML = `<li class="ac-status">No games found for "${esc(query)}".</li>`;
    return;
  }

  acListEl.innerHTML = "";

  for (const result of results) {
    const li = document.createElement("li");
    li.className = "autocomplete-item";
    li.setAttribute("role", "option");
    li.setAttribute("tabindex", "-1");
    li.innerHTML = `
      <img class="autocomplete-thumb" src="${esc(result.image)}" alt="" loading="lazy">
      <span class="autocomplete-name">${esc(result.name)}</span>
      <span class="autocomplete-id">#${esc(result.appid)}</span>
    `;

    // CSP-safe image error handler
    const acImg = li.querySelector<HTMLImageElement>(".autocomplete-thumb")!;
    wireThumbFallback(acImg, acImg, result.appid);
    acImg.addEventListener("error", () => {
      if (acImg.src.includes("header.jpg")) {
        acImg.style.display = "none";
      }
    });

    li.addEventListener("click", async () => {
      acListEl.hidden = true;
      gameSearchEl.value = "";

      try {
        await addGame({ appid: result.appid, name: result.name, image: result.image });
        await renderGames();
        // Trigger a background fetch for the new game immediately
        chrome.runtime.sendMessage<MessageRequest, MessageResponse>({ type: "FETCH_NOW" }).catch(() => {
          // Background may not be awake yet — non-critical
        });
      } catch (err) {
        alert(String(err));
      }
    });

    acListEl.appendChild(li);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TRACKING SECTION
// ══════════════════════════════════════════════════════════════════════════════

async function initTracking(): Promise<void> {
  const s = await getSettings();
  mustGet<HTMLInputElement>("trendEnabled").checked = s.trendEnabled;

  const intervalEl = mustGet<HTMLInputElement>("fetchInterval");
  const intervalVal= mustGet<HTMLSpanElement>("intervalVal");
  intervalEl.value = String(s.fetchIntervalMinutes);
  intervalVal.textContent = `${s.fetchIntervalMinutes} min`;
  intervalEl.addEventListener("input", () => {
    intervalVal.textContent = `${intervalEl.value} min`;
  });

  const purgeEl  = mustGet<HTMLInputElement>("purgeAfterDays");
  const purgeVal = mustGet<HTMLSpanElement>("purgeVal");
  purgeEl.value = String(s.purgeAfterDays);
  purgeVal.textContent = `${s.purgeAfterDays} days`;
  purgeEl.addEventListener("input", () => {
    purgeVal.textContent = `${purgeEl.value} days`;
  });
}

mustGet<HTMLButtonElement>("saveTracking").addEventListener("click", async () => {
  try {
    await saveSettings({
      trendEnabled: mustGet<HTMLInputElement>("trendEnabled").checked,
      fetchIntervalMinutes: Number(mustGet<HTMLInputElement>("fetchInterval").value),
      purgeAfterDays: Number(mustGet<HTMLInputElement>("purgeAfterDays").value),
    });
    chrome.runtime.sendMessage<MessageRequest, MessageResponse>({ type: "RESET_ALARM" }).catch(() => {});
    showToast("savedTracking");
  } catch (err) {
    alert(`Error saving: ${String(err)}`);
  }
});

mustGet<HTMLButtonElement>("clearDataBtn").addEventListener("click", async () => {
  const confirmed = confirm(
    "This will delete ALL SteamWatch data: tracked games, snapshots, and settings.\n\nThis cannot be undone. Continue?"
  );
  if (!confirmed) return;

  try {
    await clearAllData();
    await init();
    alert("All SteamWatch data has been cleared.");
  } catch (err) {
    alert(`Error clearing data: ${String(err)}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS SECTION
// ══════════════════════════════════════════════════════════════════════════════

async function initNotifications(): Promise<void> {
  const s = await getSettings();

  mustGet<HTMLInputElement>("notificationsEnabled").checked = s.notificationsEnabled;
  mustGet<HTMLInputElement>("spikeDetection").checked       = s.spikeDetection;

  const upEl  = mustGet<HTMLInputElement>("globalThresholdUp");
  const upVal = mustGet<HTMLSpanElement>("thresholdUpVal");
  upEl.value  = String(s.globalThresholdUp);
  upVal.textContent = `+${s.globalThresholdUp}%`;
  upEl.addEventListener("input", () => { upVal.textContent = `+${upEl.value}%`; });

  const downEl  = mustGet<HTMLInputElement>("globalThresholdDown");
  const downVal = mustGet<HTMLSpanElement>("thresholdDownVal");
  downEl.value  = String(Math.abs(s.globalThresholdDown));
  downVal.textContent = `-${Math.abs(s.globalThresholdDown)}%`;
  downEl.addEventListener("input", () => { downVal.textContent = `-${downEl.value}%`; });

  const crashEl  = mustGet<HTMLInputElement>("crashThreshold");
  const crashVal = mustGet<HTMLSpanElement>("crashThresholdVal");
  crashEl.value  = String(Math.abs(s.crashThreshold));
  crashVal.textContent = `-${Math.abs(s.crashThreshold)}%`;
  crashEl.addEventListener("input", () => { crashVal.textContent = `-${crashEl.value}%`; });

  mustGet<HTMLInputElement>("priceAlertsEnabled").checked = s.priceAlertsEnabled;

  const priceEl  = mustGet<HTMLInputElement>("priceDropMinPct");
  const priceVal = mustGet<HTMLSpanElement>("priceDropMinPctVal");
  priceEl.value  = String(s.priceDropMinPct);
  priceVal.textContent = `${s.priceDropMinPct}%`;
  priceEl.addEventListener("input", () => { priceVal.textContent = `${priceEl.value}%`; });
}

async function initQuietHours(): Promise<void> {
  const s = await getSettings();

  mustGet<HTMLInputElement>("quietHoursEnabled").checked = s.quietHoursEnabled;

  const startEl = mustGet<HTMLInputElement>("quietStart");
  const endEl   = mustGet<HTMLInputElement>("quietEnd");
  startEl.value = s.quietStart;
  endEl.value   = s.quietEnd;

  // Render day buttons
  const grid = mustGet<HTMLDivElement>("quietDaysGrid");
  const activeDays = maskToDays(s.quietDays);
  grid.innerHTML = "";

  DAY_LABELS.forEach((label, dayIndex) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `day-btn${activeDays.includes(dayIndex) ? " active" : ""}`;
    btn.textContent = label;
    btn.dataset["day"] = String(dayIndex);
    btn.setAttribute("aria-pressed", String(activeDays.includes(dayIndex)));
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      const pressed = btn.classList.contains("active");
      btn.setAttribute("aria-pressed", String(pressed));
    });
    grid.appendChild(btn);
  });
}

async function initRanking(): Promise<void> {
  const s = await getSettings();
  const el = document.getElementById("rankByPlayers") as HTMLInputElement | null;
  if (el) el.checked = s.rankByPlayers ?? true;

  document.getElementById("saveGamesDisplay")?.addEventListener("click", async () => {
    const val = (document.getElementById("rankByPlayers") as HTMLInputElement | null)?.checked ?? true;
    try {
      await saveSettings({ rankByPlayers: val });
      showToast("savedGamesDisplay");
    } catch (err) {
      alert(`Error saving: ${String(err)}`);
    }
  });
}

mustGet<HTMLButtonElement>("saveNotifs").addEventListener("click", async () => {
  try {
    // Collect active quiet-hours days from button state
    const dayBtns = document.querySelectorAll<HTMLButtonElement>(".day-btn");
    const activeDays: number[] = [];
    dayBtns.forEach((btn) => {
      if (btn.classList.contains("active")) {
        activeDays.push(Number(btn.dataset["day"] ?? 0));
      }
    });

    await saveSettings({
      notificationsEnabled: mustGet<HTMLInputElement>("notificationsEnabled").checked,
      spikeDetection:       mustGet<HTMLInputElement>("spikeDetection").checked,
      globalThresholdUp:    Number(mustGet<HTMLInputElement>("globalThresholdUp").value),
      globalThresholdDown: -Math.abs(Number(mustGet<HTMLInputElement>("globalThresholdDown").value)),
      crashThreshold:      -Math.abs(Number(mustGet<HTMLInputElement>("crashThreshold").value)),
      quietHoursEnabled:   mustGet<HTMLInputElement>("quietHoursEnabled").checked,
      quietStart:          mustGet<HTMLInputElement>("quietStart").value,
      quietEnd:            mustGet<HTMLInputElement>("quietEnd").value,
      quietDays:           buildDayMask(activeDays),
      priceAlertsEnabled:  mustGet<HTMLInputElement>("priceAlertsEnabled").checked,
      priceDropMinPct:     Number(mustGet<HTMLInputElement>("priceDropMinPct").value),
    });
    showToast("savedNotifs");
  } catch (err) {
    alert(`Error saving: ${String(err)}`);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function showToast(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}

function flashSaveButton(btn: HTMLButtonElement): void {
  const orig = btn.textContent ?? "Save";
  btn.textContent = "✓ Saved";
  btn.style.background = "rgba(34,197,94,.15)";
  btn.style.color = "#22c55e";
  setTimeout(() => {
    btn.textContent = orig;
    btn.style.background = "";
    btn.style.color = "";
  }, 1800);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  await Promise.all([renderGames(), initTracking(), initNotifications()]);
  void initExport();
  void initQuietHours();
  void initRanking();
  void initHistory();
}


// ══════════════════════════════════════════════════════════════════════════════
// HISTORY SECTION
// ══════════════════════════════════════════════════════════════════════════════

async function initHistory(): Promise<void> {
  const selectEl  = document.getElementById("historyGameSelect")  as HTMLSelectElement | null;
  const tabsEl    = document.getElementById("historyWindowTabs")  as HTMLDivElement    | null;
  const chartEl   = document.getElementById("historyChart")       as SVGSVGElement     | null;
  const emptyEl   = document.getElementById("historyEmpty")       as HTMLParagraphElement | null;
  const noGameEl  = document.getElementById("historyNoGame")      as HTMLParagraphElement | null;
  const statsEl   = document.getElementById("historyStats")       as HTMLDivElement    | null;
  const hCurrent  = document.getElementById("hStatCurrent")  as HTMLDivElement | null;
  const h24hAvg   = document.getElementById("hStat24hAvg")   as HTMLDivElement | null;
  const hPeriodAvg= document.getElementById("hStatPeriodAvg")as HTMLDivElement | null;
  const hPeak     = document.getElementById("hStatPeak")     as HTMLDivElement | null;
  if (!selectEl || !tabsEl || !chartEl || !emptyEl || !noGameEl || !statsEl) return;

  const settings = await getSettings();
  const games    = await getGames();

  // Populate game selector
  games.forEach((game) => {
    const opt = document.createElement("option");
    opt.value = game.appid;
    opt.textContent = game.name;
    selectEl.appendChild(opt);
  });

  // Build window tabs
  const windows = buildAvailableGraphWindows(settings.purgeAfterDays);
  let activeWindow = windows[0]?.windowMs ?? 86_400_000;

  function buildTabs(): void {
    tabsEl!.innerHTML = "";
    windows.forEach((w) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `panel-window-btn${w.windowMs === activeWindow ? " active" : ""}`;
      btn.textContent = w.label;
      btn.dataset["windowMs"] = String(w.windowMs);
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(w.windowMs === activeWindow));
      btn.addEventListener("click", () => {
        activeWindow = w.windowMs;
        tabsEl!.querySelectorAll<HTMLButtonElement>("[data-window-ms]").forEach((b) => {
          const active = b === btn;
          b.classList.toggle("active", active);
          b.setAttribute("aria-selected", String(active));
        });
        void renderHistory(selectEl!.value);
      });
      tabsEl!.appendChild(btn);
    });
  }
  buildTabs();

  async function renderHistory(appid: string): Promise<void> {
    if (!appid) {
      if (noGameEl) noGameEl.hidden = false;
      if (emptyEl)  emptyEl.hidden = true;
      if (statsEl)  hide(statsEl);
      chartEl!.innerHTML = "";
      return;
    }
    if (noGameEl) noGameEl.hidden = true;

    const allSnaps  = await idbGetSnapshots(appid);
    const filtered  = filterSnapshotsByWindow(allSnaps, activeWindow);
    const downsampled = downsampleSnapshotsForGraph(filtered, 120);

    if (downsampled.length < 2) {
      if (emptyEl) emptyEl.hidden = false;
      if (statsEl) hide(statsEl);
      chartEl!.innerHTML = "";
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    if (statsEl) show(statsEl);

    // ── Render SVG chart ──
    const W = 600; const H = 160;
    const padX = 52; const padY = 16;
    const values = downsampled.map((s) => s.current);
    const pts = mapToPoints(values, W - padX * 2, H - padY * 2, padX, padY);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const midVal = Math.round((maxVal + minVal) / 2);
    const color = sparklineColor(downsampled);

    // Y-axis grid lines + labels
    const gridLines = [
      { y: padY,        label: fmtNumber(maxVal) },
      { y: padY + (H - padY * 2) / 2, label: fmtNumber(midVal) },
      { y: H - padY,    label: fmtNumber(minVal) },
    ];

    // X-axis labels
    const firstTs = downsampled[0]!.ts;
    const lastTs  = downsampled[downsampled.length - 1]!.ts;
    const fmtTime = (ts: number): string => {
      const d = new Date(ts);
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    };

    // Polyline points string
    const polylinePoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    // Fill path: close bottom
    const fillPath = `M${pts[0]!.x.toFixed(1)},${(H - padY).toFixed(1)} ` +
      pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
      ` L${pts[pts.length - 1]!.x.toFixed(1)},${(H - padY).toFixed(1)} Z`;

    const lastPt = pts[pts.length - 1]!;

    chartEl!.innerHTML = `
      <defs>
        <linearGradient id="hGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${esc(color)}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${esc(color)}" stop-opacity="0.01"/>
        </linearGradient>
      </defs>
      ${gridLines.map((g) => `
        <line x1="${padX}" y1="${g.y.toFixed(1)}" x2="${W - padX / 2}" y2="${g.y.toFixed(1)}"
              stroke="rgba(255,255,255,.06)" stroke-width="1"/>
        <text x="${(padX - 4).toFixed(1)}" y="${(g.y + 4).toFixed(1)}"
              fill="rgba(148,163,184,.7)" font-size="10" text-anchor="end"
              font-family="JetBrains Mono,monospace">${esc(g.label)}</text>
      `).join("")}
      <text x="${padX}" y="${(H - 2).toFixed(1)}"
            fill="rgba(84,106,128,.8)" font-size="9.5" text-anchor="start"
            font-family="JetBrains Mono,monospace">${esc(fmtTime(firstTs))}</text>
      <text x="${(W - padX / 2).toFixed(1)}" y="${(H - 2).toFixed(1)}"
            fill="rgba(84,106,128,.8)" font-size="9.5" text-anchor="end"
            font-family="JetBrains Mono,monospace">${esc(fmtTime(lastTs))}</text>
      <path d="${esc(fillPath)}" fill="url(#hGrad)"/>
      <polyline points="${esc(polylinePoints)}" fill="none" stroke="${esc(color)}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="3"
              fill="${esc(color)}" stroke="var(--bg-surface)" stroke-width="1.5"/>
    `;

    // ── Stats row ──
    const game = games.find((g) => g.appid === appid);
    const current = game ? (await getSettings(), allSnaps[allSnaps.length - 1]?.current ?? null) : null;
    const avg24h   = compute24hAvg(allSnaps);
    const periodAvg = computeRetentionAvg(filtered.length > 0 ? filtered : allSnaps, settings.purgeAfterDays);
    const peak     = computeLocalPeak(allSnaps);
    if (hCurrent)   hCurrent.textContent   = fmtNumber(current);
    if (h24hAvg)    h24hAvg.textContent    = fmtNumber(avg24h);
    if (hPeriodAvg) hPeriodAvg.textContent = fmtNumber(periodAvg);
    if (hPeak)      hPeak.textContent      = fmtNumber(peak);
  }

  selectEl.addEventListener("change", () => void renderHistory(selectEl.value));
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT SECTION
// ══════════════════════════════════════════════════════════════════════════════

async function initExport(): Promise<void> {
  const exportJsonBtn = document.getElementById("exportJsonBtn") as HTMLButtonElement | null;
  const exportCsvBtn  = document.getElementById("exportCsvBtn")  as HTMLButtonElement | null;
  const exportMeta    = document.getElementById("exportMeta");

  async function runExport(format: "json" | "csv"): Promise<void> {
    if (exportMeta) {
      exportMeta.textContent = "Building export…";
      exportMeta.className = "export-meta";
    }

    try {
      const games = await getGames();

      if (games.length === 0) {
        if (exportMeta) {
          exportMeta.textContent = "⚠ No games tracked yet — nothing to export.";
          exportMeta.className = "export-meta empty";
        }
        return;
      }

      const snapshotsByAppid: Record<string, import("../types/index.js").Snapshot[]> = {};
      await Promise.all(
        games.map(async (g) => {
          snapshotsByAppid[g.appid] = await idbGetSnapshots(g.appid);
        })
      );

      const rows    = buildExportRows(games, snapshotsByAppid);
      const content = format === "json" ? rowsToJSON(rows) : rowsToCSV(rows);
      const filename = exportFilename(format);

      downloadFile(content, filename, format === "json" ? "application/json" : "text/csv");

      if (exportMeta) {
        const total = rows.length.toLocaleString("en-US");
        exportMeta.textContent = `✓ Exported ${total} rows across ${games.length} game${games.length !== 1 ? "s" : ""} — ${filename}`;
        exportMeta.className = "export-meta ready";
      }
    } catch (err) {
      if (exportMeta) {
        exportMeta.textContent = `Error during export: ${String(err)}`;
        exportMeta.className = "export-meta empty";
      }
    }
  }

  exportJsonBtn?.addEventListener("click", () => void runExport("json"));
  exportCsvBtn?.addEventListener("click",  () => void runExport("csv"));
}

void init();
