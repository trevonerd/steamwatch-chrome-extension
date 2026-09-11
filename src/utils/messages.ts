import { MessageResponseSchema, type MessageRequest } from "../types/index.js";

export class RefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshError";
  }
}

export async function requestRefresh(retryHistory = false): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage<MessageRequest, unknown>({ type: "FETCH_NOW", ...(retryHistory ? { retryHistory: true } : {}) });
  const parsed = MessageResponseSchema.safeParse(response);
  if (!parsed.success) throw new RefreshError("The background refresh returned an invalid response.");
  if (!parsed.data.ok) throw new RefreshError(parsed.data.error ?? "The background refresh failed.");
}
