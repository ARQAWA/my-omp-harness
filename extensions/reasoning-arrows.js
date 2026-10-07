export const ORDER = ["off", "low", "medium", "high", "xhigh", "max"];

// off is offered only where omp sends between_tools (Sonnet 5.5).
export function levelsFor(model) {
  return ORDER.filter(level =>
    level === "off"
      ? model?.compat?.supportsBetweenToolsThinking === true
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
  // On off omp sends between_tools without effort; Anthropic would default to high.
  pi.on("before_provider_request", event => {
    const payload = event.payload;
    if (payload?.thinking?.type !== "between_tools") return;
    return {
      ...payload,
      output_config: { ...payload.output_config, effort: "medium" },
    };
  });
}
