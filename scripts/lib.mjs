// Shared helpers for `npm run setup` and `npm run up` (Node built-ins only).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENGINE = join(ROOT, "examples", "phase1-engine");
export const APP = join(ROOT, "app");
export const WIN = process.platform === "win32";
export const NPM = WIN ? "npm.cmd" : "npm";

const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = color("1");
export const dim = color("2");
export const red = color("31");
export const green = color("32");
export const yellow = color("33");
export const cyan = color("36");

export function step(title) {
  console.log(`\n${bold(cyan("▸"))} ${bold(title)}`);
}

/** Run a command with inherited output; exits the process on failure. */
export function run(cmd, args, cwd, env = {}) {
  console.log(dim(`  $ ${[cmd, ...args].join(" ")}${cwd !== ROOT ? `   (in ${cwd.slice(ROOT.length + 1)})` : ""}`));
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env }, shell: WIN });
  if (r.status !== 0) {
    console.error(red(`\n✗ Failed: ${cmd} ${args.join(" ")} (exit ${r.status ?? r.signal})`));
    process.exit(r.status ?? 1);
  }
}

export function nodeVersionOk() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > 22 || (maj === 22 && min >= 6);
}

export function which(bin) {
  const r = spawnSync(WIN ? "where" : "which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

/** This machine on Tailscale: your login (e.g. you@github) and its MagicDNS name, or null when Tailscale is not up. */
export function tailscaleSelf() {
  const r = spawnSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) return null;
  try {
    const s = JSON.parse(r.stdout);
    const login = s.User?.[String(s.Self?.UserID)]?.LoginName ?? null;
    const dnsName = s.Self?.DNSName?.replace(/\.$/, "") || null;
    return login ? { login, dnsName } : null;
  } catch {
    return null;
  }
}

/**
 * Point `tailscale serve` at a local port, so this machine's tailnet name opens it. HTTPS when the tailnet has
 * certificates, plain HTTP otherwise (still encrypted by WireGuard). Returns the URL; throws when Tailscale is not usable.
 */
export function tailscaleServe(port) {
  if (!which("tailscale")) throw new Error("tailscale is not installed (https://tailscale.com/download).");
  const r0 = spawnSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 10_000 });
  const status = r0.status === 0 ? JSON.parse(r0.stdout) : null;
  const name = status?.Self?.DNSName?.replace(/\.$/, "");
  if (!name) throw new Error("Tailscale is not running or not logged in on this machine.");
  const serve = (proto, publicPort) =>
    spawnSync("tailscale", ["serve", "--bg", `--${proto}=${publicPort}`, `http://127.0.0.1:${port}`], { encoding: "utf8", timeout: 30_000 });
  const why = (r) => (r.stderr || r.stdout || "timed out").trim().split("\n")[0];
  // HTTPS needs the tailnet's certificates; without them `tailscale serve --https` waits for a browser consent.
  if ((status.CertDomains ?? []).length > 0) {
    const r = serve("https", 443);
    if (r.status === 0) return `https://${name}/`;
    console.log(yellow(`  ! HTTPS serve failed (${why(r)}); using HTTP instead.`));
  }
  const r = serve("http", 80);
  if (r.status !== 0) throw new Error(`tailscale serve failed: ${why(r)}`);
  console.log(dim("  Served over HTTP inside the tailnet (traffic is still encrypted by WireGuard). For HTTPS, enable"));
  console.log(dim("  'HTTPS Certificates' in the Tailscale admin console (DNS page)."));
  return `http://${name}/`;
}

/** Newest modification time under `dir`, skipping build output and dependencies. */
export function newestMtime(dir, skip = new Set(["node_modules", ".next", "test-results", "playwright-report", "notes"])) {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    if (skip.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    newest = Math.max(newest, st.isDirectory() ? newestMtime(p, skip) : st.mtimeMs);
  }
  return newest;
}

/** Why the production build must be (re)built, or null when it is current. */
export function buildStale() {
  const id = join(APP, ".next", "BUILD_ID");
  if (!existsSync(id)) return "no production build yet";
  const built = statSync(id).mtimeMs;
  const changed = Math.max(newestMtime(join(APP, "src")), ...["package.json", "package-lock.json", "next.config.ts"].map((f) => statSync(join(APP, f)).mtimeMs));
  return changed > built ? "the app changed since the last build" : null;
}

export function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

/** Spawn a long-running process whose output lines get a coloured prefix. */
export function supervise(name, paint, cmd, args, cwd, env = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: "1", ...env }, shell: WIN });
  const prefix = paint(name.padEnd(6));
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) console.log(`${prefix} ${l}`);
    });
  }
  return child;
}

/**
 * Stop a child started by `supervise` and everything under it. On Windows the child is the cmd.exe that `shell: true`
 * puts in front of npm, so `kill()` would end only that shell and leave node holding its port (seen 04/11: an orphaned
 * world server kept 8787 and every autostart retry failed); `taskkill /T` ends the whole tree.
 */
export function killTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (WIN) {
    try {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      return;
    } catch {
      // fall through to a plain kill
    }
  }
  child.kill("SIGINT");
}

/**
 * Windows only: if the program listening on `port` is one this repo started (its command line runs a file under
 * `ownDir`), end it and its children and return true. A world server or app left behind by a crash then no longer
 * blocks the next start. Anything else on the port is left alone (returns false).
 */
export function freeOwnPort(port, ownDir) {
  if (!WIN) return false;
  const net = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
  const line = (net.stdout || "").split(/\r?\n/).find((l) => /LISTENING/i.test(l) && new RegExp(`[:.]${port}\\s`).test(l));
  const pid = line?.trim().split(/\s+/).pop();
  if (!pid || !/^\d+$/.test(pid)) return false;
  const ps = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
    { encoding: "utf8", windowsHide: true },
  );
  const cmdline = (ps.stdout || "").trim();
  const own = ownDir.replaceAll("/", "\\").toLowerCase();
  if (!cmdline || !(cmdline.toLowerCase().includes(own) || /server[\\/]main\.ts|next(\.cmd)?["']? start/i.test(cmdline) && cmdline.toLowerCase().includes("vanphongao"))) return false;
  spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore", windowsHide: true });
  return true;
}

export function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : WIN ? "cmd" : "xdg-open";
  const args = WIN ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // no browser launcher: the URL is printed anyway
  }
}
