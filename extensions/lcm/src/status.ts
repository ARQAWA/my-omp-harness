/**
 * Footer status widget showing LCM stats.
 * Keep it SHORT — Pi crashes if status text exceeds terminal width.
 */

import type { LcmStore } from "./db/store.js";

export function updateStatus(
  store: LcmStore | null,
  conversationId: string | null,
  ctx: any,
): void {
  if (!store || !conversationId) {
    ctx.ui.setStatus("lcm", "");
    return;
  }

  try {
    const stats = store.getStats(conversationId);
    // Short text: the status line has little room.
    ctx.ui.setStatus("lcm", `${stats.messages} msgs · ${stats.summaries} summaries`);
  } catch {
    ctx.ui.setStatus("lcm", "");
  }
}
