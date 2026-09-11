import { describe, expect, it } from "vitest";
import { acknowledgeRule, evaluateRule } from "../src/background/notificationRules.js";

function step(value: number | null, now: number, previous?: ReturnType<typeof evaluateRule>["state"]) {
  return evaluateRule({ key: "above", threshold: 100, value, now, ...(previous ? { previous } : {}) });
}
function stateOrThrow(state: ReturnType<typeof evaluateRule>["state"]) {
  if (!state) throw new Error("Expected rule state");
  return state;
}

describe("evaluateRule", () => {
  it("primes initial unsafe observations and fires only after two qualified crossings", () => {
    const first = step(120, 0);
    const armed = step(90, 60_000, first.state);
    const crossing = step(100, 120_000, armed.state);
    const ready = step(110, 420_000, crossing.state);
    expect(first.eventId).toBeUndefined();
    expect(ready.eventId).toBe("above_120000");
  });

  it("uses inverse crossing and hysteresis for below rules", () => {
    const initial = evaluateRule({ key: "below", threshold: 100, value: 110, now: 0 });
    const crossing = evaluateRule({ key: "below", threshold: 100, value: 100, now: 60_000, previous: stateOrThrow(initial.state) });
    const ready = evaluateRule({ key: "below", threshold: 100, value: 90, now: 360_000, previous: stateOrThrow(crossing.state) });
    expect(ready.eventId).toBe("below_60000");
    expect(evaluateRule({ key: "below", threshold: 100, value: 101, now: 420_000, previous: stateOrThrow(ready.state) }).state?.armed).toBe(true);
  });

  it("ignores missing, duplicate, stale-gap, and threshold-changed observations", () => {
    const initial = step(90, 0);
    expect(step(null, 60_000, initial.state).state).toEqual(initial.state);
    expect(step(100, 0, initial.state).state).toEqual(initial.state);
    const crossing = step(100, 60_000, initial.state);
    const gap = step(110, 1_000_000, crossing.state);
    expect(gap.eventId).toBeUndefined();
    expect(evaluateRule({ key: "above", threshold: 200, value: 210, now: 1_060_000, previous: stateOrThrow(gap.state) }).eventId).toBeUndefined();
  });

  it("does not repeat after acknowledgement until hysteresis recovery", () => {
    const a = step(90, 0);
    const b = step(100, 60_000, a.state);
    const fired = step(110, 360_000, b.state);
    const acknowledged = acknowledgeRule(fired.state!);
    expect(step(120, 420_000, acknowledged).eventId).toBeUndefined();
    const rearmed = step(90, 480_000, acknowledged);
    expect(rearmed.state?.armed).toBe(true);
  });

  it("restarts qualification after a gap longer than fifteen minutes", () => {
    const armed = step(90, 0);
    const first = step(100, 60_000, armed.state);
    const restarted = step(110, 1_000_000, first.state);
    const tooSoon = step(110, 1_060_000, restarted.state);
    expect(restarted.state?.crossedAt).toBe(1_000_000);
    expect(tooSoon.eventId).toBeUndefined();
  });

  it("cancels an in-progress crossing when value dips below the threshold", () => {
    const armed = step(90, 0);
    const crossing = step(100, 60_000, armed.state);
    const dip = step(99, 120_000, crossing.state);
    const renewed = step(110, 420_000, dip.state);
    expect(dip.state?.crossedAt).toBeUndefined();
    expect(renewed.eventId).toBeUndefined();
  });

  it("returns an existing pending id for delivery retry", () => {
    const armed = step(90, 0);
    const crossing = step(100, 60_000, armed.state);
    const pending = step(110, 360_000, crossing.state);
    const retry = step(120, 420_000, pending.state);
    expect(retry.eventId).toBe(pending.eventId);
  });
});
