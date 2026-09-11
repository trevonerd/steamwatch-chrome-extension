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
import { searchGames } from "../utils/api.js";
import { append, clear, h, mustGet, show, hide } from "../utils/html.js";
import { buildDayMask, maskToDays, DAY_LABELS } from "../utils/quietHours.js";
import { formatError } from "../utils/log.js";
import { requestRefresh } from "../utils/messages.js";
import { wireThumbFallback, thumbColor } from "../popup/thumb.js";
import type { Game, GameSettings } from "../types/index.js";

const gameSearchEl = mustGet<HTMLInputElement>("gameSearch");
const acListEl = mustGet<HTMLUListElement>("autocompleteList");
const gamesRowsEl = mustGet<HTMLUListElement>("gamesRows");
const noGamesHint = mustGet<HTMLLIElement>("noGamesHint");
const countBadge = mustGet<HTMLSpanElement>("gameCountBadge");

function setupNavigation(): void {
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.dataset["section"];
      if (!section) return;

      document.querySelectorAll(".nav-item").forEach((navItem) => {
        navItem.classList.remove("active");
        navItem.removeAttribute("aria-current");
      });
      document.querySelectorAll<HTMLElement>(".section").forEach((sectionEl) => {
        sectionEl.classList.remove("active");
        sectionEl.hidden = true;
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
}

async function renderGames(): Promise<void> {
  const games = await getGames();
  countBadge.textContent = `${games.length} / ${MAX_GAMES}`;

  gamesRowsEl.querySelectorAll(".game-row").forEach((row) => row.remove());

  if (games.length === 0) {
    show(noGamesHint);
    return;
  }

  hide(noGamesHint);
  const rows = await Promise.all(
    games.map(async (game) => buildGameRow(game, await getGameSettings(game.appid))),
  );
  rows.forEach((row) => gamesRowsEl.appendChild(row));
}

function buildGameRow(game: Game, gs: GameSettings): HTMLLIElement {
  const li = h("li", {
    className: "game-row",
    dataset: { appid: game.appid },
  });

  const thumbWrap = h("span", { className: "game-row-thumb-wrap" });
  const img = h("img", {
    className: "game-row-thumb",
    attrs: {
      src: game.image,
      alt: game.name,
      loading: "lazy",
    },
  });
  const placeholder = h("span", {
    className: "game-row-placeholder",
    text: firstGameInitial(game.name),
    attrs: {
      "aria-hidden": "true",
      style: `--thumb-color:${thumbColor(game.appid)}`,
    },
  });
  append(thumbWrap, img, placeholder);
  wireThumbFallback(img, thumbWrap, game.appid);

  const expandBtn = h("button", {
    className: "btn-expand",
    attrs: {
      type: "button",
      "aria-expanded": "false",
      "aria-label": `Toggle settings for ${game.name}`,
    },
    children: [chevronIcon()],
  });
  expandBtn.addEventListener("click", () => {
    const isOpen = li.classList.toggle("open");
    expandBtn.setAttribute("aria-expanded", String(isOpen));
  });

  const removeBtn = h("button", {
    className: "btn-del",
    text: "Remove",
    attrs: {
      type: "button",
      "data-appid": game.appid,
      "aria-label": `Remove ${game.name}`,
    },
  });
  removeBtn.addEventListener("click", () => void handleRemoveGame(game));

  const header = h("div", {
    className: "game-row-header",
    children: [
      thumbWrap,
      h("span", { className: "game-row-name", text: game.name, attrs: { title: game.name } }),
      h("span", { className: "game-row-appid", text: `appid: ${game.appid}` }),
      expandBtn,
      removeBtn,
    ],
  });

  append(li, header, buildPerGameSettings(game, gs, li));
  return li;
}

function buildPerGameSettings(game: Game, gs: GameSettings, row: HTMLLIElement): HTMLDivElement {
  const riseInput = numberInput(`gs-up-${game.appid}`, "thresholdUp", gs.thresholdUp ?? "", "Global default");
  const dropInput = numberInput(
    `gs-down-${game.appid}`,
    "thresholdDown",
    gs.thresholdDown != null ? Math.abs(gs.thresholdDown) : "",
    "Global default",
  );
  const absoluteInput = numberInput(
    `gs-abs-${game.appid}`,
    "notifyThresholdPlayers",
    gs.notifyThresholdPlayers ?? "",
    "e.g. 100000",
  );
  absoluteInput.min = "0";
  absoluteInput.removeAttribute("max");
  const belowInput = numberInput(`gs-below-${game.appid}`, "notifyBelowPlayers", gs.notifyBelowPlayers ?? "", "e.g. 1000");
  belowInput.min = "0";
  belowInput.removeAttribute("max");

  const notifyInput = h("input", {
    attrs: {
      type: "checkbox",
      name: "notificationsEnabled",
      checked: gs.notificationsEnabled !== false,
    },
  });
  const saveBtn = h("button", {
    className: "btn-save small",
    text: "Save",
    attrs: {
      type: "button",
      "data-save-game": game.appid,
    },
  });
  saveBtn.addEventListener("click", () => void savePerGameSettings(game.appid, row, saveBtn));

  return h("div", {
    className: "game-row-settings",
    attrs: { "aria-label": "Per-game settings" },
    children: [
      h("div", {
        className: "settings-grid",
        children: [
          settingGroup(`Rise threshold (%)`, riseInput, "Overrides global rise alert %."),
          settingGroup(`Drop threshold (%)`, dropInput, "Overrides global drop alert %."),
          settingGroup("Above player count", absoluteInput, "Notify after crossing above and remaining there for 5 minutes."),
          settingGroup("Below player count", belowInput, "Notify after crossing below and remaining there for 5 minutes."),
        ],
      }),
      h("div", {
        className: "per-game-actions",
        children: [
          h("label", {
            className: "toggle",
            attrs: { "aria-label": "Notifications for this game" },
            children: [notifyInput, h("span", { className: "toggle-slider" })],
          }),
          h("span", {
            className: "setting-label inline-label",
            text: "Notifications for this game",
          }),
          saveBtn,
        ],
      }),
    ],
  });
}

function numberInput(id: string, name: string, value: string | number, placeholder: string): HTMLInputElement {
  return h("input", {
    className: "input-sm",
    attrs: {
      type: "number",
      id,
      name,
      placeholder,
      min: "1",
      max: "200",
      value,
    },
  });
}

function settingGroup(label: string, input: HTMLInputElement, hint: string): HTMLDivElement {
  return h("div", {
    className: "setting-group",
    children: [
      h("label", {
        className: "setting-label",
        text: label,
        attrs: { for: input.id },
      }),
      input,
      h("span", { className: "setting-hint", text: hint }),
    ],
  });
}

async function savePerGameSettings(appid: string, row: HTMLLIElement, saveBtn: HTMLButtonElement): Promise<void> {
  for (const input of Array.from(row.querySelectorAll<HTMLInputElement>("input[type=number]"))) {
    if (!input.reportValidity()) return;
  }
  const partial: GameSettings = {};
  const upVal = row.querySelector<HTMLInputElement>("[name='thresholdUp']")?.value ?? "";
  const downVal = row.querySelector<HTMLInputElement>("[name='thresholdDown']")?.value ?? "";
  const absVal = row.querySelector<HTMLInputElement>("[name='notifyThresholdPlayers']")?.value ?? "";
  const belowVal = row.querySelector<HTMLInputElement>("[name='notifyBelowPlayers']")?.value ?? "";
  const notifOn = row.querySelector<HTMLInputElement>("[name='notificationsEnabled']")?.checked ?? true;

  if (upVal) partial.thresholdUp = Number(upVal);
  if (downVal) partial.thresholdDown = -Math.abs(Number(downVal));
  if (absVal) partial.notifyThresholdPlayers = Number(absVal);
  if (belowVal) partial.notifyBelowPlayers = Number(belowVal);
  partial.notificationsEnabled = notifOn;

  try {
    await saveGameSettings(appid, partial);
    flashSaveButton(saveBtn);
  } catch (err) {
    alert(`Error saving settings: ${formatError(err)}`);
  }
}

async function handleRemoveGame(game: Game): Promise<void> {
  if (!confirm(`Remove "${game.name}" from SteamWatch?`)) return;

  try {
    await removeGame(game.appid);
    await renderGames();
  } catch (err) {
    alert(`Error removing game: ${formatError(err)}`);
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;

function setupAutocomplete(): void {
  gameSearchEl.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    const query = gameSearchEl.value.trim();

    if (query.length < 2) {
      acListEl.hidden = true;
      clear(acListEl);
      return;
    }

    acListEl.hidden = false;
    clear(acListEl);
    acListEl.appendChild(h("li", {
      className: "ac-status",
      text: "Searching...",
      attrs: { role: "status" },
    }));
    searchTimer = setTimeout(() => void runSearch(query), 300);
  });

  document.addEventListener("click", (event) => {
    if (!gameSearchEl.closest(".search-wrap")?.contains(event.target as Node)) {
      acListEl.hidden = true;
    }
  });

  gameSearchEl.addEventListener("keydown", (event) => {
    const items = acListEl.querySelectorAll<HTMLLIElement>(".autocomplete-item");
    const focused = acListEl.querySelector<HTMLLIElement>("[aria-selected='true']");

    if (event.key === "Escape") {
      acListEl.hidden = true;
      return;
    }
    if (!items.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = focused ? (focused.nextElementSibling as HTMLLIElement | null) : items[0];
      focused?.removeAttribute("aria-selected");
      next?.setAttribute("aria-selected", "true");
      next?.scrollIntoView({ block: "nearest" });
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = focused?.previousElementSibling as HTMLLIElement | null;
      focused?.removeAttribute("aria-selected");
      prev?.setAttribute("aria-selected", "true");
      prev?.scrollIntoView({ block: "nearest" });
    }

    if (event.key === "Enter" && focused) {
      event.preventDefault();
      focused.click();
    }
  });
}

async function runSearch(query: string): Promise<void> {
  const results = await searchGames(query);
  clear(acListEl);

  if (results.length === 0) {
    acListEl.appendChild(h("li", {
      className: "ac-status",
      text: `No games found for "${query}".`,
    }));
    return;
  }

  for (const result of results) {
    const li = h("li", {
      className: "autocomplete-item",
      attrs: {
        role: "option",
        tabindex: "-1",
      },
    });

    const thumbWrap = h("div", { className: "autocomplete-thumb-wrap" });
    const img = h("img", {
      className: "autocomplete-thumb",
      attrs: {
        src: result.image,
        alt: "",
        loading: "lazy",
      },
    });
    append(
      thumbWrap,
      img,
      h("div", {
        className: "thumb-placeholder",
        text: firstGameInitial(result.name),
        attrs: {
          style: `--thumb-color:${thumbColor(result.appid)}`,
          "aria-hidden": "true",
        },
      }),
    );
    wireThumbFallback(img, thumbWrap, result.appid);

    append(
      li,
      thumbWrap,
      h("span", { className: "autocomplete-name", text: result.name }),
      h("span", { className: "autocomplete-id", text: `#${result.appid}` }),
    );

    li.addEventListener("click", () => void addSearchResult(result));
    acListEl.appendChild(li);
  }
}

async function addSearchResult(result: Game): Promise<void> {
  acListEl.hidden = true;
  gameSearchEl.value = "";

  try {
    await addGame({ appid: result.appid, name: result.name, image: result.image });
    await renderGames();
    void requestRefresh().catch((err: unknown) => {
      console.warn(`[SteamWatch options] Background fetch after add failed: ${formatError(err)}`);
    });
  } catch (err) {
    alert(formatError(err));
  }
}

async function initNotifications(): Promise<void> {
  const settings = await getSettings();

  mustGet<HTMLInputElement>("notificationsEnabled").checked = settings.notificationsEnabled;

  const upEl = mustGet<HTMLInputElement>("globalThresholdUp");
  const upVal = mustGet<HTMLSpanElement>("thresholdUpVal");
  upEl.value = String(settings.globalThresholdUp);
  upVal.textContent = `+${settings.globalThresholdUp}%`;
  upEl.addEventListener("input", () => {
    upVal.textContent = `+${upEl.value}%`;
  });

  const downEl = mustGet<HTMLInputElement>("globalThresholdDown");
  const downVal = mustGet<HTMLSpanElement>("thresholdDownVal");
  downEl.value = String(Math.abs(settings.globalThresholdDown));
  downVal.textContent = `-${Math.abs(settings.globalThresholdDown)}%`;
  downEl.addEventListener("input", () => {
    downVal.textContent = `-${downEl.value}%`;
  });
}

async function initQuietHours(): Promise<void> {
  const settings = await getSettings();

  mustGet<HTMLInputElement>("quietHoursEnabled").checked = settings.quietHoursEnabled;
  mustGet<HTMLInputElement>("quietStart").value = settings.quietStart;
  mustGet<HTMLInputElement>("quietEnd").value = settings.quietEnd;

  const grid = mustGet<HTMLDivElement>("quietDaysGrid");
  const activeDays = maskToDays(settings.quietDays);
  clear(grid);

  DAY_LABELS.forEach((label, dayIndex) => {
    const active = activeDays.includes(dayIndex);
    const btn = h("button", {
      className: `day-btn${active ? " active" : ""}`,
      text: label,
      attrs: {
        type: "button",
        "aria-pressed": String(active),
        "aria-label": label,
      },
      dataset: { day: dayIndex },
    });
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      btn.setAttribute("aria-pressed", String(btn.classList.contains("active")));
    });
    grid.appendChild(btn);
  });
}

function setupNotificationSave(): void {
  mustGet<HTMLButtonElement>("saveNotifs").addEventListener("click", async () => {
    try {
      const activeDays = Array.from(document.querySelectorAll<HTMLButtonElement>(".day-btn"))
        .filter((btn) => btn.classList.contains("active"))
        .map((btn) => Number(btn.dataset["day"] ?? 0));

      await saveSettings({
        notificationsEnabled: mustGet<HTMLInputElement>("notificationsEnabled").checked,
        globalThresholdUp: Number(mustGet<HTMLInputElement>("globalThresholdUp").value),
        globalThresholdDown: -Math.abs(Number(mustGet<HTMLInputElement>("globalThresholdDown").value)),
        quietHoursEnabled: mustGet<HTMLInputElement>("quietHoursEnabled").checked,
        quietStart: mustGet<HTMLInputElement>("quietStart").value,
        quietEnd: mustGet<HTMLInputElement>("quietEnd").value,
        quietDays: buildDayMask(activeDays),
      });
      showToast("savedNotifs");
    } catch (err) {
      alert(`Error saving: ${formatError(err)}`);
    }
  });
}

function setupClearData(): void {
  mustGet<HTMLButtonElement>("clearDataBtn").addEventListener("click", async () => {
    const confirmed = confirm(
      "This will delete ALL SteamWatch data: tracked games, snapshots, and settings.\n\nThis cannot be undone. Continue?",
    );
    if (!confirmed) return;

    try {
      await clearAllData();
      await renderGames();
      await initNotifications();
      await initQuietHours();
      alert("All SteamWatch data has been cleared.");
    } catch (err) {
      alert(`Error clearing data: ${formatError(err)}`);
    }
  });
}

function showToast(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}

function flashSaveButton(btn: HTMLButtonElement): void {
  const original = btn.textContent ?? "Save";
  btn.textContent = "Saved";
  btn.style.background = "rgba(34,197,94,.15)";
  btn.style.color = "#22c55e";
  setTimeout(() => {
    btn.textContent = original;
    btn.style.background = "";
    btn.style.color = "";
  }, 1800);
}

function firstGameInitial(name: string): string {
  return (name.match(/[A-Za-z0-9]/) ?? ["?"])[0]!.toUpperCase();
}

function chevronIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "6 9 12 15 18 9");
  svg.appendChild(polyline);
  return svg;
}

async function init(): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const version = manifest.version_name ?? manifest.version;
  const sidebarVersionEl = document.getElementById("sidebarVersion");
  const aboutVersionEl = document.getElementById("aboutVersion");
  if (sidebarVersionEl) sidebarVersionEl.textContent = `v${version}`;
  if (aboutVersionEl) aboutVersionEl.textContent = version;

  setupNavigation();
  setupAutocomplete();
  setupNotificationSave();
  setupClearData();

  await Promise.all([renderGames(), initNotifications(), initQuietHours()]);
}

void init();
