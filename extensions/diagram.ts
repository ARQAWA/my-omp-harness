import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { rasterizeSvg } from "@oh-my-pi/pi-natives";
import { Container, Image, ImageProtocol, TERMINAL, Text } from "@oh-my-pi/pi-tui";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const THEME = THEMES["tokyo-night"];
const DIR = join(tmpdir(), "omp-diagrams");
// The chat scales the image to its full width; these pixel sizes only set sharpness.
const WIDTH = 2400;
const MAX_HEIGHT = 16000;

function hex(color: string): number[] | undefined {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
	if (!m) return undefined;
	const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function mix(a: string, p: number, b: string, q = 100 - p): string {
	const ca = hex(a);
	if (b === "transparent" && ca) return `rgba(${ca[0]},${ca[1]},${ca[2]},${(p / 100).toFixed(2)})`;
	const cb = hex(b);
	if (!ca || !cb) return a;
	const w = p / (p + q);
	return `#${ca.map((v, i) => Math.round(v * w + cb[i] * (1 - w)).toString(16).padStart(2, "0")).join("")}`;
}

// beautiful-mermaid styles the SVG with CSS variables, color-mix() and a CSS background, which the rasterizer ignores; this turns them into plain colors and a background rectangle.
function flatten(svg: string): { svg: string; width: number; height: number } {
	let text = svg.replace(/@import[^;]*;/g, "");
	const vars = new Map<string, string>();
	for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;"}]+)/g)) {
		if (!vars.has(m[1])) vars.set(m[1], m[2].trim());
	}
	for (let i = 0; i < 20; i++) {
		const before = text;
		text = text.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*?))?\s*\)/g, (_m, name: string, fallback?: string) => vars.get(name) ?? fallback ?? "");
		text = text.replace(
			/color-mix\(\s*in srgb\s*,\s*([^(),\s]+)\s+([\d.]+)%\s*,\s*([^(),\s]+)(?:\s+([\d.]+)%)?\s*\)/g,
			(_m, a: string, p: string, b: string, q?: string) => mix(a, Number(p), b, q === undefined ? undefined : Number(q)),
		);
		if (text === before) break;
	}
	let width = 0;
	let height = 0;
	text = text.replace(/<svg\b[^>]*>/, (tag) => {
		width = Number(/\bwidth="([\d.]+)/.exec(tag)?.[1]);
		height = Number(/\bheight="([\d.]+)/.exec(tag)?.[1]);
		const scale = Math.min(WIDTH / width, MAX_HEIGHT / height);
		width = Math.round(width * scale);
		height = Math.round(height * scale);
		return `${tag
			.replace(/\bwidth="[^"]*"/, `width="${width}"`)
			.replace(/\bheight="[^"]*"/, `height="${height}"`)}<rect width="100%" height="100%" fill="${THEME.bg}"/>`;
	});
	return { svg: text, width, height };
}

export default function diagram(pi: ExtensionAPI) {
	// omp turns images off inside terminal multiplexers, but herdr renders Kitty graphics itself.
	if (process.env.HERDR_ENV === "1" && !process.env.PI_FORCE_IMAGE_PROTOCOL) TERMINAL.imageProtocol = ImageProtocol.Kitty;
	const z = pi.zod;
	pi.on("session_start", async (_event, ctx) => {
		// Only root Main talks to the user, so subagents get no diagram tool.
		if (ctx.agent.kind !== "sub") return;
		const active = await pi.getActiveTools();
		if (active.includes("diagram")) await pi.setActiveTools(active.filter((name: string) => name !== "diagram"));
	});
	pi.registerTool({
		name: "diagram",
		label: "Diagram",
		loadMode: "essential",
		description:
			"Draw a Mermaid diagram for the user. title: a short caption. mermaid: the diagram source in Mermaid syntax. The chat shows the diagram as an image across the full terminal width, with a link that opens it at full size. Use this tool for every diagram; a mermaid code block in chat text shows only as text art.",
		parameters: z.object({ title: z.string(), mermaid: z.string() }),
		async execute(_toolCallId, params) {
			const { svg, width, height } = flatten(renderMermaidSVG(params.mermaid, THEME));
			const png = await rasterizeSvg(Buffer.from(svg), width, height);
			mkdirSync(DIR, { recursive: true });
			const path = join(DIR, `${createHash("sha256").update(params.mermaid).digest("hex").slice(0, 16)}.png`);
			writeFileSync(path, png);
			return { content: [{ type: "text", text: `The user sees the diagram as an image: ${path}` }], details: { path } };
		},
		renderCall(args, _options, theme) {
			return new Text(theme.fg("accent", args?.title ? `Схема: ${args.title}` : "Схема"), 0, 0);
		},
		renderResult(result, _options, theme) {
			const path = (result.details as { path?: string } | undefined)?.path;
			if (!path || !existsSync(path)) {
				const message = result.content.map((part: { type: string; text?: string }) => (part.type === "text" ? part.text ?? "" : "")).join("\n");
				return new Text(theme.fg("muted", message), 0, 0);
			}
			const box = new Container();
			box.addChild(new Image(readFileSync(path).toString("base64"), "image/png", { fallbackColor: (text: string) => theme.fg("muted", text) }));
			box.addChild(new Text(theme.fg("accent", `\x1b]8;;${pathToFileURL(path).href}\x1b\\Открыть в полный размер\x1b]8;;\x1b\\`), 0, 0));
			return box;
		},
	});
}
