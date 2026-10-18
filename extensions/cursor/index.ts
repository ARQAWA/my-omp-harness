import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { register as registerGlob } from "./glob.ts";
import { register as registerReadFile } from "./read-file.ts";
import { register as registerRg } from "./rg.ts";

// Cursor's rg, Glob and ReadFile, ported from ~/ai-project/cursor-pi.
export default function cursorTools(pi: ExtensionAPI) {
	registerRg(pi);
	registerGlob(pi);
	registerReadFile(pi);
}
