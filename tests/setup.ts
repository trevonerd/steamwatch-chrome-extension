// tests/setup.ts
// Global Chrome API mock for Vitest (Node environment).
// Provides an in-memory implementation of chrome.storage.local.

import "fake-indexeddb/auto";

import { vi, beforeAll } from "vitest";

// ── In-memory storage ─────────────────────────────────────────────────────────

const store: Record<string, unknown> = {};

const storageMock = {
  local: {
    get: vi.fn(async (key: string | string[] | null) => {
      if (key === null) return { ...store };
      const keys = Array.isArray(key) ? key : [key];
      const result: Record<string, unknown> = {};
      for (const k of keys) {
        if (k in store) result[k] = store[k];
      }
      return result;
    }),

    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    }),

    remove: vi.fn(async (keys: string | string[]) => {
      const ks = Array.isArray(keys) ? keys : [keys];
      for (const k of ks) delete store[k];
    }),

    clear: vi.fn(async () => {
      Object.keys(store).forEach((k) => {
        delete store[k];
      });
    }),
  },
};

// ── Expose on globalThis ──────────────────────────────────────────────────────

Object.defineProperty(globalThis, "chrome", {
  value: {
    storage: storageMock,
    runtime: {
      sendMessage: vi.fn(),
      openOptionsPage: vi.fn(),
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(async () => true),
      onAlarm: { addListener: vi.fn() },
    },
    notifications: {
      create: vi.fn(),
    },
  },
  writable: true,
});

// ── DOM fixtures for happy-dom test environment ───────────────────────────────

if (typeof document !== "undefined") {
  beforeAll(() => {
    const domFixtures: Array<{ id: string; tag: "div" | "img" | "a" }> = [
      { id: "history-peak24h",      tag: "div" },
      { id: "history-alltime-peak", tag: "div" },
      { id: "history-24h-gain",     tag: "div" },
      { id: "history-period-gain",  tag: "div" },
      { id: "history-trend",        tag: "div" },
      { id: "history-latest-change",tag: "div" },
      { id: "history-twitch",       tag: "div" },
      { id: "history-thumbnail",    tag: "img" },
      { id: "history-steam-link",   tag: "a"   },
      { id: "history-steamdb-link", tag: "a"   },
      { id: "history-sale-badge",   tag: "div" },
    ];
    domFixtures.forEach(({ id, tag }) => {
      if (!document.getElementById(id)) {
        const el = document.createElement(tag);
        el.id = id;
        document.documentElement.appendChild(el);
      }
    });
  });
}

// ── Reset storage between tests ───────────────────────────────────────────────

beforeEach(() => {
  Object.keys(store).forEach((k) => {
    delete store[k];
  });
  vi.clearAllMocks();
});
