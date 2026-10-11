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
    const body = ctx.ui.theme.fg("muted", `${stats.messages} \uF27A / ${stats.summaries} \uF15C`);
    ctx.ui.setStatus("lcm", ctx.ui.theme.bg("customMessageBg", ` ${body} `));
  } catch {
    ctx.ui.setStatus("lcm", "");
  }
}
