export default function (pi) {
  const list = [
    "anthropic/claude-opus-5-5",
    "anthropic/claude-sonnet-5-5",
    "anthropic/claude-fable-5-1",
    "openai-codex/gpt-6.1-sol",
    "openai-codex/gpt-6-luna",
    "cursor/composer-2.5",
  ];
  for (const [key, direction] of [["ctrl+up", -1], ["ctrl+down", 1]]) {
    pi.registerShortcut(key, {
      description: direction < 0 ? "Previous model in list" : "Next model in list",
      async handler(ctx) {
        const cur = ctx.model;
        const index = list.findIndex(spec => cur && spec === `${cur.provider}/${cur.id}`);
        const next = index < 0
          ? (direction < 0 ? list.length - 1 : 0)
          : Math.min(list.length - 1, Math.max(0, index + direction));
        if (next === index) return;
        const model = ctx.models.resolve(list[next]);
        if (model) await pi.setModel(model);
      },
    });
  }
}
