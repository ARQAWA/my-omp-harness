import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { SEGMENTS } from "@oh-my-pi/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import os from "node:os";

let latest: any;
let tuiRef: { requestRender?: () => void } | undefined;
let git: GitState | undefined;
let turnStart: number | undefined;
let turnInterval: ReturnType<typeof setInterval> | undefined;

interface GitState {
	branch?: string;
	ahead: number;
	behind: number;
	staged: number;
	modified: number;
	untracked: number;
}

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

function parseGit(output: string): GitState | undefined {
	const state: GitState = { ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0 };
	for (const line of output.split("\n")) {
		if (line.startsWith("# branch.head ")) {
			state.branch = line.slice("# branch.head ".length).trim();
		} else if (line.startsWith("# branch.ab ")) {
			const m = line.match(/\+(\d+) -(\d+)/);
			if (m) {
				state.ahead = Number(m[1]);
				state.behind = Number(m[2]);
			}
		} else if (line.startsWith("1 ") || line.startsWith("2 ")) {
			const xy = line.split(/\s+/)[1] ?? "..";
			if (xy[0] !== ".") state.staged++;
			if (xy[1] !== ".") state.modified++;
		} else if (line.startsWith("u ")) {
			state.modified++;
		} else if (line.startsWith("? ")) {
			state.untracked++;
		}
	}
	return state;
}

async function refreshGit(pi: ExtensionAPI, ctx: any) {
	try {
		const res = await pi.exec("git", ["status", "--porcelain=v2", "--branch"], {
			cwd: ctx.cwd,
			timeout: 3000,
		});
		if (res.code !== 0) {
			git = undefined;
		} else {
			git = parseGit(res.stdout ?? "");
		}
		tuiRef?.requestRender?.();
	} catch {
		// keep previous git state
	}
}

function abbrevPath(cwd: string): string {
	const home = os.homedir();
	if (cwd === home) return "~";
	if (cwd.startsWith(home + "/")) return "~" + cwd.slice(home.length);
	return cwd;
}

function placeLine(width: number, ctx: any, theme: any): string {
	const path = theme.fg("statusLinePath", abbrevPath(ctx.cwd));
	const parts: string[] = [path];
	if (git) {
		const dirty = git.staged + git.modified + git.untracked;
		const branchColor = dirty === 0 ? "statusLineGitClean" : "statusLineGitDirty";
		const gitParts: string[] = [];
		if (git.branch) gitParts.push(theme.fg(branchColor, git.branch));
		if (git.ahead > 0) gitParts.push(theme.fg("muted", `↑${git.ahead}`));
		if (git.behind > 0) gitParts.push(theme.fg("muted", `↓${git.behind}`));
		if (git.staged > 0) gitParts.push(theme.fg("success", `+${git.staged}`));
		if (git.modified > 0) gitParts.push(theme.fg("warning", `~${git.modified}`));
		if (git.untracked > 0) gitParts.push(theme.fg("dim", `?${git.untracked}`));
		if (gitParts.length) parts.push(gitParts.join(" "));
	}
	const line = " " + parts.join("   ");
	return truncateToWidth(line, width);
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

function setupWidget(ctx: any) {
	ctx.ui.setWidget(
		"my-omp-harness.status-rows",
		(tui: any, theme: any) => {
			tuiRef = tui;
			return {
				render(width: number) {
					const c = latest ?? ctx;
					return [placeLine(width, c, theme), contextLine(width, theme)];
				},
				invalidate() {},
			};
		},
		{ placement: "belowEditor" },
	);
}

export default function statusBar(pi: ExtensionAPI) {
	patchTokenRate();

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		setupWidget(ctx);
		await refreshGit(pi, ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		setupWidget(ctx);
		await refreshGit(pi, ctx);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		if (turnInterval !== undefined) return;
		turnStart = Date.now();
		const update = () => {
			if (turnStart === undefined) return;
			ctx.ui.setStatus("turn", `turn ${fmtTurn(Date.now() - turnStart)}`);
		};
		update();
		turnInterval = setInterval(update, 1000);
		turnInterval.unref?.();
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		await refreshGit(pi, ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		latest = ctx;
		await refreshGit(pi, ctx);
		if (turnStart === undefined) return;
		if (turnInterval !== undefined) {
			clearInterval(turnInterval);
			turnInterval = undefined;
		}
		ctx.ui.setStatus("turn", `turn ${fmtTurn(Date.now() - turnStart)}`);
		turnStart = undefined;
	});
}
