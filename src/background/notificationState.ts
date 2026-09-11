import { z } from "zod";
import type { RuleState } from "./notificationRules.js";

const RuleStateSchema = z.object({
  fingerprint: z.string(),
  lastValue: z.number().finite(),
  lastObservedAt: z.number().finite().nonnegative(),
  armed: z.boolean(),
  crossedAt: z.number().finite().nonnegative().optional(),
  observations: z.number().int().nonnegative(),
  pendingId: z.string().optional(),
});
const StateSchema = z.object({
  above: RuleStateSchema.optional(),
  below: RuleStateSchema.optional(),
  trendUp: RuleStateSchema.optional(),
  trendDown: RuleStateSchema.optional(),
});
export type NotificationState = Partial<Record<"above" | "below" | "trendUp" | "trendDown", RuleState>>;
const PREFIX = "sw_notification_state_";
const operations = new Map<string, Promise<void>>();

export async function getNotificationState(appid: string): Promise<NotificationState> {
  const raw = await chrome.storage.local.get(`${PREFIX}${appid}`);
  const parsed = StateSchema.safeParse(raw[`${PREFIX}${appid}`]);
  if (!parsed.success) return {};
  const state: NotificationState = {};
  for (const key of ["above", "below", "trendUp", "trendDown"] as const) {
    const value = parsed.data[key];
    if (value) state[key] = {
      fingerprint: value.fingerprint, lastValue: value.lastValue,
      lastObservedAt: value.lastObservedAt, armed: value.armed,
      observations: value.observations,
      ...(value.crossedAt !== undefined ? { crossedAt: value.crossedAt } : {}),
      ...(value.pendingId !== undefined ? { pendingId: value.pendingId } : {}),
    };
  }
  return state;
}

export async function setNotificationState(appid: string, state: NotificationState): Promise<void> {
  await chrome.storage.local.set({ [`${PREFIX}${appid}`]: state });
}

/** Serializes evaluation, durable pending state, delivery and acknowledgement. */
export async function withNotificationState(
  appid: string,
  operation: (state: NotificationState, save: (next: NotificationState) => Promise<void>) => Promise<void>,
): Promise<void> {
  const run = async (): Promise<void> => operation(await getNotificationState(appid), (next) => setNotificationState(appid, next));
  const previous = operations.get(appid) ?? Promise.resolve();
  const pending = previous.then(run, run);
  operations.set(appid, pending);
  try { await pending; } finally { if (operations.get(appid) === pending) operations.delete(appid); }
}

export async function deleteNotificationState(appid: string): Promise<void> {
  await withNotificationState(appid, async () => { await chrome.storage.local.remove(`${PREFIX}${appid}`); });
}
