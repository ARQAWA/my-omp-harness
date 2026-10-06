export default function (pi) {
  const order = ["low", "medium", "high", "xhigh", "max"];
  for (const [key, direction] of [["ctrl+left", -1], ["ctrl+right", 1]]) {
    pi.registerShortcut(key, {
      description: direction < 0 ? "Decrease reasoning effort" : "Increase reasoning effort",
      handler(ctx) {
        const levels = order.filter(level => ctx.model?.thinking?.efforts?.includes(level));
        if (!levels.length) return;
        const current = order.indexOf(pi.getThinkingLevel());
        const next = direction > 0
          ? levels.find(level => order.indexOf(level) > current) ?? levels.at(-1)
          : levels.findLast(level => order.indexOf(level) < current) ?? levels[0];
        pi.setThinkingLevel(next);
      },
    });
  }
}
