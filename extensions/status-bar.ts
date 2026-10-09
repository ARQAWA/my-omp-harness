import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { getSessionAccentAnsi, getSessionAccentHex, SEGMENTS, StatusLineComponent } from "@oh-my-pi/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";

const TITLE = "my-omp-harness.title";

let latest: any;
let turnStart: number | undefined;
let lastTurnMs: number | undefined;
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

function rowLeftRight(left: string, right: string, width: number): string {
	if (!left && !right) return "";
	if (!left) return truncateToWidth(right, width);
	if (!right) return truncateToWidth(left, width);
	const lw = visibleWidth(left);
	const rw = visibleWidth(right);
	if (lw + rw <= width) return left + " ".repeat(width - lw - rw) + right;
	return truncateToWidth(`${left}  ${right}`, width);
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
		// Shorten reasoning labels to no lo md hi xh mx, all amber; off (between_tools or thinking disabled) shows "no".
		model = model.replace(`${theme.status.disabled} off`, "\x1b[38;2;255;176;0mno");
		for (const [level, short] of [["low", "lo"], ["medium", "md"], ["high", "hi"], ["xhigh", "xh"], ["max", "mx"]] as const) { const full = theme.thinking?.[level]; if (full) model = model.replace(full, "\x1b[38;2;255;176;0m" + short); }
		let place: string = rightPart.call(this, width)?.content ?? "";
		for (const badge of [agents, jobs]) {
			if (!badge) continue;
			model += `${theme.fg("statusLineSep", "·")} ${badge}`;
			place = place.replace(badge + sep, "");
		}
		// Drop omp's blank gap row so the context bar sits right under the input.
		const name = this.session?.sessionManager?.getSessionName?.();
		const accent = (name && getSessionAccentAnsi(getSessionAccentHex(name, theme.sessionAccentInputs))) || theme.getFgAnsi("accent");
		const id = this.session?.sessionManager?.getSessionId?.();
		const idText = id ? theme.fg("dim", id) : "";
		const third = rowLeftRight(place, idText, width);
		const rows = [contextLine(width, theme, accent), truncateToWidth(model, width)];
		if (third) rows.push(third);
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

function contextLine(width: number, theme: any, accent: string): string {
	const u = latest?.getContextUsage?.();
	if (!u?.contextWindow) return theme.fg("dim", "─".repeat(width));
	let p = u.percent ?? ((u.tokens ?? 0) / u.contextWindow) * 100;
	p = Math.min(100, Math.max(0, p));
	const label = ` ${Math.round(p)}% ${fmtK(u.tokens ?? 0)}/${fmtK(u.contextWindow)}`;
	const barWidth = Math.max(0, width - visibleWidth(label));
	const filled = Math.round((barWidth * p) / 100);
	const line =
		`${accent}${"━".repeat(filled)}\x1b[39m`
		+ theme.fg("dim", "─".repeat(barWidth - filled))
		+ `${accent}${label}\x1b[39m`;
	return truncateToWidth(line, width);
}

function showTitle(ctx: any) {
	ctx.ui.setWidget(
		TITLE,
		(_tui, theme) => ({
			render(width: number) {
				let left = "";
				if (turnStart === undefined && lastTurnMs !== undefined) {
					left = theme.fg("dim", `Worked ${fmtWorked(lastTurnMs)}`);
				}
				const name = ctx.sessionManager?.getSessionName?.();
				let right = "";
				if (name) {
					const accent =
						getSessionAccentAnsi(getSessionAccentHex(name, theme.sessionAccentInputs))
						|| theme.getFgAnsi("accent");
					right = `${accent}${name}\x1b[39m`;
				}
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
		if (_event.toolName !== "progress") return;
		showTitle(ctx);
	});
}
