// Claude Code command hook: forward the hook's JSON (stdin) to the 3D Claude Hub Remote server.
// Same job as forward-hook.sh, but needs only Node (no curl, no Git Bash), so it also runs where Claude Code
// starts hooks from cmd or PowerShell on Windows. Prints nothing and always exits 0, so it can never block,
// alter or inject anything into the session. Installed with "async": true so Claude never waits for it.
// The server wants a token when --control is on: AAW_TOKEN, else the one it keeps in ~/.aaw/token.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const done = () => process.exit(0);
setTimeout(done, 2500).unref?.();
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = process.env.AAW_HOOK_URL || "http://127.0.0.1:8787/hook";
  let token = process.env.AAW_TOKEN || "";
  if (!token) {
    try {
      token = readFileSync(join(homedir(), ".aaw", "token"), "utf8").split(/\r?\n/)[0].trim();
    } catch {
      token = "";
    }
  }
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(2000) }).then((r) => r.arrayBuffer());
} catch {
  // server not running, or anything else: stay silent
}
done();
