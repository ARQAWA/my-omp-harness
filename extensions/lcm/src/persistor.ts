/**
 * Message persistor: hooks into message_end to store every message in SQLite.
 */

import type { LcmStore } from "./db/store.js";

export interface PersistorState {
  store: LcmStore | null;
  conversationId: string | null;
}

/**
 * Handle a message_end event by persisting the message to the store.
 * Returns true when the message was stored, false when it was skipped (duplicate/not initialized).
 */
export function persistMessage(
  state: PersistorState,
  message: any,
  entryId: string | null,
): boolean {
  if (!state.store || !state.conversationId) return false;

  // Skip messages without a role
  if (!message || !message.role) return false;

  const stored = state.store.appendMessage(state.conversationId, entryId, message);
  return stored !== null;
}
