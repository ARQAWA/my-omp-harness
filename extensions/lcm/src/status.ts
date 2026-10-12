/**
 * Footer status widget showing LCM stats.
 * Keep it SHORT — Pi crashes if status text exceeds terminal width.
 */

import type { LcmStore } from "./db/store.js";

// The counter text, without its background, for the status bar.
const LCM_STATUS = Symbol.for("my-omp-harness.lcm-status");

export function updateStatus(
  store: LcmStore | null,
  conversationId: string | null,
  ctx: any,
): void {
  if (!store || !conversationId) {
    (globalThis as Record<symbol, unknown>)[LCM_STATUS] = "";
    ctx.ui.setStatus("lcm", "");
    return;
  }

  try {
    const stats = store.getStats(conversationId);
    // Short text: the status line has little room.
    const body = ctx.ui.theme.fg("muted", `${stats.messages} \uF27A / ${stats.summaries} \uF15C`);
    (globalThis as Record<symbol, unknown>)[LCM_STATUS] = body;
    ctx.ui.setStatus("lcm", ctx.ui.theme.bg("customMessageBg", ` ${body} `));
  } catch {
    (globalThis as Record<symbol, unknown>)[LCM_STATUS] = "";
    ctx.ui.setStatus("lcm", "");
  }
}
