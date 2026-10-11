import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";

const RESET = "\x1b[0m";

/**
 * Fits a styled line into width. A cut line ends with "…" in the style of the text it cuts,
 * so the dots keep that color instead of the terminal's default one. Pads to width when pad is true.
 */
export function fitLine(line: string, width: number, pad = false): string {
	if (width <= 0) return "";
	if (visibleWidth(line) <= width) return pad ? truncateToWidth(line, width, "", true) : line;
	const cut = truncateToWidth(line, width - 1, "", false);
	const body = cut.endsWith(RESET) ? cut.slice(0, -RESET.length) : cut;
	const out = `${body}…${RESET}`;
	return pad ? truncateToWidth(out, width, "", true) : out;
}
