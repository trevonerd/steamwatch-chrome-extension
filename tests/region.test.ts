// tests/region.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { detectRegion, getEffectiveRegion } from "../src/utils/storage.js";
import type { Settings } from "../src/types/index.js";

// ── detectRegion tests ────────────────────────────────────────────────────────

describe("detectRegion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'US' when Intl.DateTimeFormat is not available", () => {
    const originalIntl = globalThis.Intl;
    // @ts-ignore
    globalThis.Intl = undefined;
    try {
      expect(detectRegion()).toBe("US");
    } finally {
      globalThis.Intl = originalIntl;
    }
  });

  it("extracts region from locale string like 'it-IT'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "it-IT",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Rome",
    } as any);
    expect(detectRegion()).toBe("IT");
  });

  it("extracts region from locale string like 'en-US'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "en-US",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "America/New_York",
    } as any);
    expect(detectRegion()).toBe("US");
  });

  it("maps language-only locale 'de' to 'DE'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "de",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Berlin",
    } as any);
    expect(detectRegion()).toBe("DE");
  });

  it("maps language-only locale 'fr' to 'FR'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "fr",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Paris",
    } as any);
    expect(detectRegion()).toBe("FR");
  });

  it("maps language-only locale 'es' to 'ES'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "es",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Madrid",
    } as any);
    expect(detectRegion()).toBe("ES");
  });

  it("maps language-only locale 'pt' to 'PT'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "pt",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Lisbon",
    } as any);
    expect(detectRegion()).toBe("PT");
  });

  it("maps language-only locale 'nl' to 'NL'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "nl",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Amsterdam",
    } as any);
    expect(detectRegion()).toBe("NL");
  });

  it("maps language-only locale 'pl' to 'PL'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "pl",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Warsaw",
    } as any);
    expect(detectRegion()).toBe("PL");
  });

  it("maps language-only locale 'ru' to 'RU'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "ru",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Moscow",
    } as any);
    expect(detectRegion()).toBe("RU");
  });

  it("maps language-only locale 'ko' to 'KR'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "ko",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Asia/Seoul",
    } as any);
    expect(detectRegion()).toBe("KR");
  });

  it("maps language-only locale 'zh' to 'CN'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "zh",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Asia/Shanghai",
    } as any);
    expect(detectRegion()).toBe("CN");
  });

  it("maps language-only locale 'ja' to 'JP'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "ja",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Asia/Tokyo",
    } as any);
    expect(detectRegion()).toBe("JP");
  });

  it("handles case-insensitive language codes", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "IT-it",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Rome",
    } as any);
    expect(detectRegion()).toBe("IT");
  });

  it("returns 'US' for unknown language code", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "xx",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "UTC",
    } as any);
    expect(detectRegion()).toBe("US");
  });

  it("returns 'US' when resolvedOptions throws", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
      () => {
        throw new Error("Intl error");
      }
    );
    expect(detectRegion()).toBe("US");
  });

  it("handles locale with script code like 'zh-Hans-CN'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "zh-Hans-CN",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Asia/Shanghai",
    } as any);
    expect(detectRegion()).toBe("CN");
  });
});

// ── getEffectiveRegion tests ──────────────────────────────────────────────────

describe("getEffectiveRegion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns detected region when regionCode is 'auto'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "it-IT",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Rome",
    } as any);

    const settings: Settings = {
      trendEnabled: true,
      purgeAfterDays: 7,
      notificationsEnabled: true,
      spikeDetection: true,
      globalThresholdUp: 30,
      globalThresholdDown: -25,
      crashThreshold: -50,
      fetchIntervalMinutes: 15,
      quietHoursEnabled: false,
      quietStart: "23:00",
      quietEnd: "07:00",
      quietDays: 0b1111111,
      rankByPlayers: true,
      priceAlertsEnabled: true,
      priceDropMinPct: 30,
      regionCode: "auto",
    };

    expect(getEffectiveRegion(settings)).toBe("IT");
  });

  it("returns explicit regionCode when not 'auto'", () => {
    const settings: Settings = {
      trendEnabled: true,
      purgeAfterDays: 7,
      notificationsEnabled: true,
      spikeDetection: true,
      globalThresholdUp: 30,
      globalThresholdDown: -25,
      crashThreshold: -50,
      fetchIntervalMinutes: 15,
      quietHoursEnabled: false,
      quietStart: "23:00",
      quietEnd: "07:00",
      quietDays: 0b1111111,
      rankByPlayers: true,
      priceAlertsEnabled: true,
      priceDropMinPct: 30,
      regionCode: "DE",
    };

    expect(getEffectiveRegion(settings)).toBe("DE");
  });

  it("returns detected region when regionCode is undefined", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "fr-FR",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "Europe/Paris",
    } as any);

    const settings: Settings = {
      trendEnabled: true,
      purgeAfterDays: 7,
      notificationsEnabled: true,
      spikeDetection: true,
      globalThresholdUp: 30,
      globalThresholdDown: -25,
      crashThreshold: -50,
      fetchIntervalMinutes: 15,
      quietHoursEnabled: false,
      quietStart: "23:00",
      quietEnd: "07:00",
      quietDays: 0b1111111,
      rankByPlayers: true,
      priceAlertsEnabled: true,
      priceDropMinPct: 30,
    };

    expect(getEffectiveRegion(settings)).toBe("FR");
  });

  it("returns 'US' fallback when detection fails and regionCode is 'auto'", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "xx",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "UTC",
    } as any);

    const settings: Settings = {
      trendEnabled: true,
      purgeAfterDays: 7,
      notificationsEnabled: true,
      spikeDetection: true,
      globalThresholdUp: 30,
      globalThresholdDown: -25,
      crashThreshold: -50,
      fetchIntervalMinutes: 15,
      quietHoursEnabled: false,
      quietStart: "23:00",
      quietEnd: "07:00",
      quietDays: 0b1111111,
      rankByPlayers: true,
      priceAlertsEnabled: true,
      priceDropMinPct: 30,
      regionCode: "auto",
    };

    expect(getEffectiveRegion(settings)).toBe("US");
  });
});
