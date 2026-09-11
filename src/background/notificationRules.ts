export const RULE_KEYS = ["above", "below", "trendUp", "trendDown"] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export interface RuleState { readonly fingerprint: string; readonly lastValue: number; readonly lastObservedAt: number; readonly armed: boolean; readonly crossedAt?: number; readonly observations: number; readonly pendingId?: string; }
export interface EvaluateRuleInput { readonly key: RuleKey; readonly threshold: number; readonly value: number | null; readonly now: number; readonly previous?: RuleState; }
export interface EvaluateRuleResult { readonly state: RuleState | undefined; readonly eventId?: string; }
const MIN_DURATION_MS = 5 * 60_000;
const MAX_GAP_MS = 15 * 60_000;

export function evaluateRule(input: EvaluateRuleInput): EvaluateRuleResult {
  const { key, threshold, value, now, previous } = input;
  if (value === null || (previous && now <= previous.lastObservedAt)) return { state: previous };
  const fingerprint = `${key}:${threshold}`;
  const higher = key === "above" || key === "trendUp";
  const hysteresis = key === "above" || key === "below" ? Math.max(1, Math.abs(threshold) * 0.02) : 5;
  const crossed = higher ? value >= threshold : value <= threshold;
  const safe = higher ? value < threshold - hysteresis : value > threshold + hysteresis;
  if (!previous || previous.fingerprint !== fingerprint) return { state: prime(fingerprint, value, now, safe) };
  if (safe) return { state: prime(fingerprint, value, now, true) };
  if (!crossed) {
    const { crossedAt: _crossedAt, pendingId: _pendingId, ...rest } = previous;
    return { state: { ...rest, lastValue: value, lastObservedAt: now, observations: 0 } };
  }
  if (!previous.armed) return { state: { ...previous, lastValue: value, lastObservedAt: now } };
  const gap = now - previous.lastObservedAt;
  const crossedAt = previous.crossedAt === undefined || gap > MAX_GAP_MS ? now : previous.crossedAt;
  const observations = previous.crossedAt === undefined || gap > MAX_GAP_MS ? 1 : previous.observations + 1;
  const state: RuleState = { ...previous, lastValue: value, lastObservedAt: now, crossedAt, observations };
  if (state.pendingId) return { state, eventId: state.pendingId };
  if (observations < 2 || now - crossedAt < MIN_DURATION_MS) return { state };
  const eventId = `${key}_${crossedAt}`;
  return { state: { ...state, pendingId: eventId }, eventId };
}

export function acknowledgeRule(state: RuleState): RuleState {
  const { pendingId: _pendingId, crossedAt: _crossedAt, ...rest } = state;
  return { ...rest, armed: false, observations: 0 };
}

function prime(fingerprint: string, value: number, now: number, armed: boolean): RuleState {
  return { fingerprint, lastValue: value, lastObservedAt: now, armed, observations: 0 };
}
