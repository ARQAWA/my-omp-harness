export const ORDER = ["off", "low", "medium", "high", "xhigh", "max"];

// off exists for Sonnet 5.5 (between_tools) and Haiku 5.5 (thinking disabled).
export function levelsFor(model) {
  return ORDER.filter(level =>
    level === "off"
      ? model?.compat?.supportsBetweenToolsThinking === true ||
        (model?.provider === "anthropic" && model?.id === "claude-haiku-5-5")
      : model?.thinking?.efforts?.includes(level),
  );
}

export default function (pi) {
  for (const [key, direction] of [["ctrl+left", -1], ["ctrl+right", 1]]) {
    pi.registerShortcut(key, {
      description: direction < 0 ? "Decrease reasoning effort" : "Increase reasoning effort",
      handler(ctx) {
        const levels = levelsFor(ctx.model);
        if (!levels.length) return;
        const current = ORDER.indexOf(pi.getThinkingLevel());
        const next = direction > 0
          ? levels.find(level => ORDER.indexOf(level) > current) ?? levels.at(-1)
          : levels.findLast(level => ORDER.indexOf(level) < current) ?? levels[0];
        pi.setThinkingLevel(next);
      },
    });
  }
  // On off Haiku gets thinking disabled and Sonnet keeps between_tools; both get effort low explicitly; with thinking disabled Anthropic rejects any effort change in history, so per-message effort inserts become low too.
  pi.on("before_provider_request", event => {
    const payload = event.payload;
    if (payload?.model === "claude-haiku-5-5" && pi.getThinkingLevel() === "off") {
      const { context_management: contextManagement, ...rest } = payload;
      const edits = (contextManagement?.edits ?? []).filter(edit => edit?.type !== "clear_thinking_20251015");
      return {
        ...rest,
        messages: payload.messages?.map(message =>
          message?.output_config?.effort !== undefined && message.output_config.effort !== "low"
            ? { ...message, output_config: { ...message.output_config, effort: "low" } }
            : message),
        ...(edits.length ? { context_management: { ...contextManagement, edits } } : {}),
        thinking: { type: "disabled" },
        output_config: { ...payload.output_config, effort: "low" },
      };
    }
    if (payload?.thinking?.type !== "between_tools") return;
    return { ...payload, output_config: { ...payload.output_config, effort: "low" } };
  });
}
