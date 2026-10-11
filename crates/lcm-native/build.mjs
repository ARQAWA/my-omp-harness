// Builds lcm_native for darwin-arm64 and win32-x64 and copies both binaries into extensions/lcm/native.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const crateDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(crateDir, "..", "..");
const outDir = join(repoRoot, "extensions", "lcm", "native");

// The Homebrew cargo/rustc on PATH has no Windows std. Use the rustup toolchain's cargo and put its bin
// directory first on PATH, because cargo runs `rustc` from PATH.
let cargo = "cargo";
let env = process.env;
const rustup = join(homedir(), ".cargo", "bin", "rustup");
if (process.env.CARGO) {
  cargo = process.env.CARGO;
} else if (existsSync(rustup)) {
  const found = spawnSync(rustup, ["which", "cargo"], { encoding: "utf8" }).stdout.trim();
  if (found) {
    cargo = found;
    // The toolchain's rust-lld and rust-objcopy look for libLLVM.dylib under rustlib/<host>/lib, where it is not, so the loader also searches the toolchain lib directory.
    const toolchainLib = join(dirname(dirname(found)), "lib");
    env = {
      ...process.env,
      PATH: `${dirname(found)}${delimiter}${process.env.PATH}`,
      DYLD_FALLBACK_LIBRARY_PATH: [toolchainLib, process.env.DYLD_FALLBACK_LIBRARY_PATH].filter(Boolean).join(delimiter),
    };
  }
}

const targets = [
  { triple: "aarch64-apple-darwin", artifact: "liblcm_native.dylib", output: "lcm_native.darwin-arm64.node" },
  { triple: "x86_64-pc-windows-msvc", artifact: "lcm_native.dll", output: "lcm_native.win32-x64.node" },
];

mkdirSync(outDir, { recursive: true });
for (const { triple, artifact, output } of targets) {
  // The MSVC Windows target goes through cargo-xwin, which supplies the MSVC CRT and SDK libraries from its cache.
  const subcommand = triple.includes("-windows-") ? ["xwin", "build"] : ["build"];
  const result = spawnSync(cargo, [...subcommand, "--release", "--target", triple], { cwd: crateDir, stdio: "inherit", env });
  if (result.status !== 0) {
    console.error(`cargo build failed for ${triple} (exit ${result.status ?? result.signal})`);
    process.exit(1);
  }
  const from = join(crateDir, "target", triple, "release", artifact);
  const to = join(outDir, output);
  copyFileSync(from, to);
  console.log(`${to} ${statSync(to).size} bytes`);
}
