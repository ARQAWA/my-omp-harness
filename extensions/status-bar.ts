import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { SEGMENTS, StatusLineComponent } from "@oh-my-pi/pi-coding-agent";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import { fitLine } from "./cursor-feed/fit";

const TITLE = "my-omp-harness.title";

let latest: any;
let turnStart: number | undefined;
let lastTurnMs: number | undefined;
let turnInterval: ReturnType<typeof setInterval> | undefined;

const lastRateInvalidate = new WeakMap<object, number>();

function rateText(ctx: any): string | undefined {
	const rate = ctx?.session?.tokenRate?.rate?.();
	if (!Number.isFinite(rate)) return undefined;
	const [r, g, b] = rate < 30 ? [255, 71, 87] : rate < 60 ? [255, 215, 95] : rate < 90 ? [168, 230, 163] : [0, 255, 136];
	const icon = latest?.ui?.theme?.icon?.throughput ?? "";
	return `\x1b[38;2;${r};${g};${b}m${icon}${rate.toFixed(1)} tok/s\x1b[39m`;
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

function patchMode() {
	const MODE_PATCHED = Symbol.for("my-omp-harness.mode-both");
	const mode = SEGMENTS?.mode as any;
	if (!mode || mode[MODE_PATCHED]) return;
	mode[MODE_PATCHED] = true;
	const original = mode.render;
	mode.render = (ctx: any) => {
		const result = original(ctx);
		const planActive = ctx.planMode?.enabled || ctx.planMode?.paused;
		const goalActive = ctx.goalMode?.enabled || ctx.goalMode?.paused;
		if (!planActive || !goalActive) return result;
		const withoutPlan = original({ ...ctx, planMode: undefined, prewalk: undefined });
		if (!withoutPlan?.visible) return result;
		return { ...result, content: `${result.content} ${withoutPlan.content}` };
	};
}

function patchStatusJoin() {
	const STATUS_JOIN_PATCHED = Symbol.for("my-omp-harness.status-join");
	const segment = SEGMENTS?.status as any;
	if (!segment || segment[STATUS_JOIN_PATCHED]) return;
	segment[STATUS_JOIN_PATCHED] = true;
	const originalRender = segment.render;
	const originalDescribe = segment.describe;
	segment.render = (ctx: any) => {
		const hooks: unknown[] = Array.isArray(ctx?.hookStatuses) ? ctx.hookStatuses : [];
		if (hooks.length < 2) return originalRender(ctx);
		const theme = latest?.ui?.theme;
		const sep = theme ? ` ${theme.getFgAnsi("statusLineSep")}·${theme.getFgAnsi("text")} ` : " · ";
		const visible = hooks
			.map(item => originalRender({ ...ctx, hookStatuses: [item] }))
			.filter(result => result?.visible);
		if (visible.length === 0) return { content: "", visible: false };
		return { content: visible.map(result => result.content).join(sep), visible: true };
	};
	segment.describe = (ctx: any) => {
		const hooks: unknown[] = Array.isArray(ctx?.hookStatuses) ? ctx.hookStatuses : [];
		if (hooks.length < 2) return originalDescribe(ctx);
		const views = hooks.map(item => originalDescribe({ ...ctx, hookStatuses: [item] })).filter(Boolean);
		if (views.length === 0) return null;
		const spans = views.flatMap((view, index) => [
			...(index > 0 ? [{ t: " · " }] : []),
			...(view.spans ?? []),
		]);
		return { ...views[0], spans };
	};
}

function rowLeftRight(left: string, right: string, width: number): string {
	if (!left && !right) return "";
	if (!left) return fitLine(right, width);
	if (!right) return fitLine(left, width);
	const lw = visibleWidth(left);
	const rw = visibleWidth(right);
	if (lw + rw <= width) return left + " ".repeat(width - lw - rw) + right;
	const room = width - rw - 1;
	if (room <= 0) return fitLine(right, width);
	const leftPart = fitLine(left, room);
	return leftPart + " ".repeat(Math.max(0, width - visibleWidth(leftPart) - rw)) + right;
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
		if (turnStart !== undefined) {
			const now = Date.now();
			if (now - (lastRateInvalidate.get(this) ?? 0) >= 80) {
				lastRateInvalidate.set(this, now);
				this.invalidate();
			}
		}
		const base: string[] = render.call(this, width);
		const theme = latest?.ui?.theme;
		const k = base.findIndex(line => line !== "");
		if (!theme || k < 0) return base;
		// omp draws the running subagent and background job counters only with the right segments; move them to the model row.
		const agentCount = this.subagentCount;
		const jobCount = this.runningBackgroundJobCount();
		const ompAgents = agentCount > 0 ? theme.fg("statusLineSubagents", `${theme.icon.agents} ${agentCount}`) : "";
		const agents = agentCount > 0 ? theme.fg("statusLineSubagents", `${"\u{F0C0}"} ${agentCount}`) : "";
		const jobs = jobCount > 0 ? theme.fg("statusLineSubagents", `${theme.icon.job} ${jobCount}`) : "";
		const sep = ` ${theme.getFgAnsi("statusLineSep")}·${theme.getFgAnsi("text")} `;
		let model = base[k];
		// Shorten reasoning labels to no lo md hi xh mx; off (between_tools or thinking disabled) shows "no".
		model = model.replace(`${theme.status.disabled} off`, "no");
		for (const [level, short] of [["low", "lo"], ["medium", "md"], ["high", "hi"], ["xhigh", "xh"], ["max", "mx"]] as const) {
			const full = theme.thinking?.[level];
			if (full) model = model.replace(full, short);
		}
		let place: string = rightPart.call(this, width)?.content ?? "";
		for (const [badge, omp] of [[agents, ompAgents], [jobs, jobs]] as const) {
			if (!badge) continue;
			model += `${theme.fg("statusLineSep", "·")} ${badge}`;
			place = place.replace(omp + sep, "");
		}
		// Drop omp's blank gap row so the context bar sits right under the input.
		const textColor = theme.getFgAnsi("text");
		const rows = [contextLine(width, theme, textColor), fitLine(model, width)];
		if (place) rows.push(fitLine(place, width));
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

function fmtWorked(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const s = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const m = totalMin % 60;
	const h = Math.floor(totalMin / 60);
	const ss = String(s).padStart(2, "0");
	if (h > 0) {
		const mm = String(m).padStart(2, "0");
		return `${h}h ${mm}m ${ss}s`;
	}
	if (totalMin > 0) return `${totalMin}m ${ss}s`;
	return `${s}s`;
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

function contextLine(width: number, theme: any, textColor: string): string {
	const u = latest?.getContextUsage?.();
	if (!u?.contextWindow) return theme.fg("dim", "─".repeat(width));
	let p = u.percent ?? ((u.tokens ?? 0) / u.contextWindow) * 100;
	p = Math.min(100, Math.max(0, p));
	const label = ` ${Math.round(p)}% ${fmtK(u.tokens ?? 0)}/${fmtK(u.contextWindow)}`;
	const muted = theme.getFgAnsi("muted");
	const barWidth = Math.max(0, width - visibleWidth(label));
	const filled = Math.round((barWidth * p) / 100);
	const line =
		`${textColor}${"━".repeat(filled)}\x1b[39m`
		+ theme.fg("dim", "─".repeat(barWidth - filled))
		+ `${muted}${label}\x1b[39m`;
	return fitLine(line, width);
}

function showTitle(ctx: any) {
	ctx.ui.setWidget(
		TITLE,
		(_tui, theme) => ({
			render(width: number) {
				const name = ctx.sessionManager?.getSessionName?.();
				const id = ctx.sessionManager?.getSessionId?.();
				const parts: string[] = [];
				if (name) parts.push(`${theme.getFgAnsi("text")}${name}\x1b[39m`);
				if (turnStart === undefined && lastTurnMs !== undefined) {
					parts.push(theme.fg("dim", `Worked ${fmtWorked(lastTurnMs)}`));
				}
				const left = parts.join(" · ");
				const right = id ? theme.fg("muted", id) : "";
				if (!left && !right) return [""];
				return [rowLeftRight(left, right, width)];
			},
			invalidate() {},
		}),
		{ placement: "aboveEditor" },
	);
}

export default function statusBar(pi: ExtensionAPI) {
	patchTokenRate();
	patchMode();
	patchStatusJoin();
	patchStatusLine();

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		showTitle(ctx);
	});

	pi.on("session_switch", (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		lastTurnMs = undefined;
		showTitle(ctx);
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
		lastTurnMs = Date.now() - turnStart;
		ctx.ui.setStatus("turn", fmtTurn(lastTurnMs));
		turnStart = undefined;
		showTitle(ctx);
	});

	pi.on("tool_result", (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (_event.toolName !== "todo") return;
		showTitle(ctx);
	});
}
