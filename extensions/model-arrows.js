import { levelsFor } from "./reasoning-arrows.js";
export const MODELS = [
  "anthropic/claude-opus-5-5",
  "anthropic/claude-sonnet-5-5",
  "anthropic/claude-haiku-5-5",
  "anthropic/claude-fable-5-1",
  "openai-codex/gpt-6.1-sol",
  "openai-codex/gpt-6-luna",
  "openai-codex/gpt-5.6-luna",
];

export default function (pi) {
  for (const [key, direction] of [["shift+up", -1], ["shift+down", 1]]) {
    pi.registerShortcut(key, {
      description: direction < 0 ? "Previous model in list" : "Next model in list",
      async handler(ctx) {
        const cur = ctx.model;
        const index = MODELS.findIndex(spec => cur && spec === `${cur.provider}/${cur.id}`);
        const next = index < 0
          ? (direction < 0 ? MODELS.length - 1 : 0)
          : Math.min(MODELS.length - 1, Math.max(0, index + direction));
        if (next === index) return;
        const model = ctx.models.resolve(MODELS[next]);
        if (!model) return;
        await pi.setModel(model);
        // A level the new model lacks (e.g. off) moves to its lowest supported level.
        const levels = levelsFor(model);
        if (levels.length && !levels.includes(pi.getThinkingLevel())) pi.setThinkingLevel(levels[0]);
      },
    });
  }
}
