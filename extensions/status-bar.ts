import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { SEGMENTS, StatusLineComponent } from "@oh-my-pi/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";

let latest: any;
let turnStart: number | undefined;
let turnInterval: ReturnType<typeof setInterval> | undefined;

function rateText(ctx: any): string | undefined {
	const rate = ctx?.usageStats?.tokensPerSecond;
	if (!rate || !Number.isFinite(rate)) return undefined;
	const [r, g, b] = rate < 30 ? [255, 71, 87] : rate < 60 ? [255, 215, 95] : rate < 90 ? [168, 230, 163] : [0, 255, 136];
	return `\x1b[38;2;${r};${g};${b}m${rate.toFixed(1)} tok/s\x1b[39m`;
}

function patchTokenRate() {
	const RATE_PATCHED = Symbol.for("my-omp-harness.rate-color");
	const tokenRate = SEGMENTS?.token_rate as any;
	if (!tokenRate || tokenRate[RATE_PATCHED]) return;
	tokenRate[RATE_PATCHED] = true;
	tokenRate.render = (ctx: any) => {
		const t = rateText(ctx);
		return t ? { content: t, visible: true } : { content: "", visible: false };
	};
	tokenRate.describe = (ctx: any) => {
		const t = rateText(ctx);
		return t ? { spans: [{ t }] } : null;
	};
}

function patchStatusLine() {
	const ROWS_PATCHED = Symbol.for("my-omp-harness.status-rows");
	const proto = StatusLineComponent.prototype as any;
	if (proto[ROWS_PATCHED]) return;
	proto[ROWS_PATCHED] = true;
	const render = proto.render;
	const rightPart = proto.getStandaloneTopBorder;
	// The rule composer would put the right segments into the line above the input; keep that line plain.
	proto.getStandaloneTopBorder = () => ({ content: "", width: 0, revision: 0 });
	proto.render = function (width: number) {
		const base: string[] = render.call(this, width);
		const theme = latest?.ui?.theme;
		const k = base.findIndex(line => line !== "");
		if (!theme || k < 0) return base;
		// omp draws the running subagent and background job counters only with the right segments; move them to the model row.
		const agentCount = this.subagentCount;
		const jobCount = this.runningBackgroundJobCount();
		const agents = agentCount > 0 ? theme.fg("statusLineSubagents", `${theme.icon.agents} ${agentCount}`) : "";
		const jobs = jobCount > 0 ? theme.fg("statusLineSubagents", `${theme.icon.job} ${jobCount}`) : "";
		const sep = ` ${theme.getFgAnsi("statusLineSep")}·${theme.getFgAnsi("text")} `;
		let model = base[k];
		let place: string = rightPart.call(this, width)?.content ?? "";
		for (const badge of [agents, jobs]) {
			if (!badge) continue;
			model += `${theme.fg("statusLineSep", "·")} ${badge}`;
			place = place.replace(badge + sep, "");
		}
		const rows = [...base.slice(0, k), contextLine(width, theme), truncateToWidth(model, width)];
		if (place) rows.push(truncateToWidth(place, width));
		return [...rows, ...base.slice(k + 1)];
	};
}

function fmtTurn(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const sec = totalSec % 60;
	if (totalSec < 3600) {
		const min = Math.floor(totalSec / 60);
		return `${min}:${String(sec).padStart(2, "0")}`;
	}
	const h = Math.floor(totalSec / 3600);
	const min = Math.floor((totalSec % 3600) / 60);
	return `${h}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtK(n: number): string {
	if (n >= 1e6) {
		const v = n / 1e6;
		const s = v.toFixed(1);
		return `${s.endsWith(".0") ? s.slice(0, -2) : s}M`;
	}
	const v = n / 1e3;
	const s = v.toFixed(1);
	return `${s.endsWith(".0") ? s.slice(0, -2) : s}k`;
}

function contextLine(width: number, theme: any): string {
	const u = latest?.getContextUsage?.();
	if (!u?.contextWindow) return theme.fg("dim", "─".repeat(width));
	let p = u.percent ?? ((u.tokens ?? 0) / u.contextWindow) * 100;
	p = Math.min(100, Math.max(0, p));
	const label = ` ${Math.round(p)}% ${fmtK(u.tokens ?? 0)}/${fmtK(u.contextWindow)}`;
	const color = p < 50 ? "success" : p < 80 ? "warning" : "error";
	const barWidth = Math.max(0, width - visibleWidth(label));
	const filled = Math.round((barWidth * p) / 100);
	const line =
		theme.fg(color, "━".repeat(filled))
		+ theme.fg("dim", "─".repeat(barWidth - filled))
		+ theme.fg(color, label);
	return truncateToWidth(line, width);
}

export default function statusBar(pi: ExtensionAPI) {
	patchTokenRate();
	patchStatusLine();

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
	});

	pi.on("session_switch", (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
	});

	pi.on("before_agent_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		if (turnInterval !== undefined) return;
		turnStart = Date.now();
		const update = () => {
			if (turnStart === undefined) return;
			ctx.ui.setStatus("turn", fmtTurn(Date.now() - turnStart));
		};
		update();
		turnInterval = setInterval(update, 1000);
		turnInterval.unref?.();
	});

	pi.on("agent_end", (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		if (turnStart === undefined) return;
		if (turnInterval !== undefined) {
			clearInterval(turnInterval);
			turnInterval = undefined;
		}
		ctx.ui.setStatus("turn", fmtTurn(Date.now() - turnStart));
		turnStart = undefined;
	});
}
