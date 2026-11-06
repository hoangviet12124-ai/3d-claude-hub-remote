// Documents attached in the web UI (npm run test:attachments): where they are saved, which names and types are
// accepted, and the saveAttachment command over a real server. No Claude involved.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWorldServer } from "../server/worldServer.ts";
import { SessionHub } from "../server/sessions/sessionHub.ts";
import type { Runner } from "../server/sessions/claudeRunner.ts";
import { ATTACH_FOLDER_NAME, dayFolder, defaultAttachDir, safeFileName, saveAttachment } from "../server/sessions/attachments.ts";
import { LiveAgentBackend } from "../src/live/LiveAgentBackend.ts";
import { WebSocketAgentBackend } from "../src/integrations/WebSocketAgentBackend.ts";
import { MAX_ATTACH_DOC_BYTES } from "../src/integrations/AgentBackend.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const throws = (f: () => unknown) => {
  try {
    f();
    return "";
  } catch (e) {
    return (e as Error).message || "threw";
  }
};
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

console.log("\nWhere attachments go");
const desk = mkdtempSync(join(tmpdir(), "aaw-attach-desk-"));
mkdirSync(join(desk, "Brainstorm"));
check("no Workspace next to the working folder: ~/.aaw/attachments", defaultAttachDir(join(desk, "Brainstorm"), "/home/x") === join("/home/x", ".aaw", "attachments"));
mkdirSync(join(desk, "Workspace"));
check("a Workspace next to it: Workspace/Đính kèm văn phòng", defaultAttachDir(join(desk, "Brainstorm"), "/home/x") === join(desk, "Workspace", ATTACH_FOLDER_NAME));
check("no working folder: ~/.aaw/attachments", defaultAttachDir(undefined, "/home/x") === join("/home/x", ".aaw", "attachments"));
check("the day folder is the local date", dayFolder(new Date(2026, 10, 5, 9, 30)) === "2026-11-05");

console.log("\nFile names");
check("a plain Vietnamese name is kept", safeFileName("Hồ sơ thanh toán đợt 2.pdf") === "Hồ sơ thanh toán đợt 2.pdf");
check("folders in the name are dropped", safeFileName("..\\..\\Windows\\evil.pdf") === "evil.pdf" && safeFileName("../../etc/x.pdf") === "x.pdf");
check("reserved characters become spaces", safeFileName('a<b>c:d"e|f?g*h.xlsx') === "a b c d e f g h.xlsx", safeFileName('a<b>c:d"e|f?g*h.xlsx'));
check("the extension is lower-cased", safeFileName("BAO CAO.PDF") === "BAO CAO.pdf");
check("a reserved Windows name is not used as is", !/^con\.pdf$/i.test(safeFileName("CON.pdf")));
check("a very long name is shortened, extension kept", (() => {
  const n = safeFileName(`${"x".repeat(300)}.docx`);
  return n.length <= 125 && n.endsWith(".docx");
})());

console.log("\nSaving");
const dir = join(desk, "Workspace", ATTACH_FOLDER_NAME);
const when = new Date(2026, 10, 5, 9, 0);
const p1 = saveAttachment(dir, "Biên bản.pdf", b64("%PDF-1 one"), when);
check("saved under <dir>/<day>/<name>", p1 === join(dir, "2026-11-05", "Biên bản.pdf") && readFileSync(p1, "utf8") === "%PDF-1 one", p1);
const p2 = saveAttachment(dir, "Biên bản.pdf", b64("%PDF-1 two"), when);
check("the same name again gets (2), the first file is untouched", p2 === join(dir, "2026-11-05", "Biên bản (2).pdf") && readFileSync(p1, "utf8") === "%PDF-1 one" && readFileSync(p2, "utf8") === "%PDF-1 two", p2);
check("an executable is refused", throws(() => saveAttachment(dir, "setup.exe", b64("MZ"), when)) !== "");
check("a script is refused", throws(() => saveAttachment(dir, "run.ps1", b64("x"), when)) !== "");
check("a name without extension is refused", throws(() => saveAttachment(dir, "README", b64("x"), when)) !== "");
check("an empty file is refused", throws(() => saveAttachment(dir, "a.pdf", "", when)) !== "");
check("data that is not base64 is refused", throws(() => saveAttachment(dir, "a.pdf", "not base64!", when)) !== "");
check("a file over the limit is refused", throws(() => saveAttachment(dir, "big.pdf", "A".repeat(Math.ceil(MAX_ATTACH_DOC_BYTES / 3) * 4 + 4), when)) !== "");
check("nothing else was written", readdirSync(join(dir, "2026-11-05")).length === 2);

console.log("\nThe saveAttachment command");
const root = mkdtempSync(join(tmpdir(), "aaw-attach-projects-"));
const token = "attach-token";
const live = new LiveAgentBackend({ autoTick: false });
await live.connect();
const readOnly = new SessionHub({ root, pollMs: 50, discoverWithinMs: 0, attachDir: join(desk, "ro") });
const control = new SessionHub({ root, pollMs: 50, discoverWithinMs: 0, workdir: join(desk, "Brainstorm"), runner: {} as Runner });
check("with control and a Workspace, the hub saves there", control.attachDir === dir, control.attachDir);
for (const [label, hub] of [["read-only", readOnly], ["control", control]] as const) {
  const server = await startWorldServer({ backend: live, port: 0, token, tokenScope: "sessions", sessions: hub });
  const client = new WebSocketAgentBackend({ url: server.url, token });
  await client.connect();
  const r = await client.request<{ path: string }>({ name: "saveAttachment", fileName: "Dự toán.xlsx", data: b64("PK xlsx") }).then(
    (v) => v,
    (e: Error) => e,
  );
  if (label === "read-only") check("a server without control refuses", r instanceof Error && !/unknown command/i.test(r.message) && !existsSync(join(desk, "ro")), r instanceof Error ? r.message : JSON.stringify(r));
  else check("with control: acks the saved path", !(r instanceof Error) && r.path.startsWith(dir) && r.path.endsWith("Dự toán.xlsx") && readFileSync(r.path, "utf8") === "PK xlsx", r instanceof Error ? r.message : r.path);
  const noToken = new WebSocketAgentBackend({ url: server.url });
  await noToken.connect();
  const nt = await noToken.request({ name: "saveAttachment", fileName: "x.pdf", data: b64("x") }).then(() => null, (e: Error) => e);
  check(`${label}: a connection without the token is refused`, nt instanceof Error);
  await noToken.disconnect();
  await client.disconnect();
  await server.close();
}
readOnly.dispose();
control.dispose();
await live.disconnect();
console.log(failures === 0 ? "\nAll attachment checks passed." : `\n${failures} attachment check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
