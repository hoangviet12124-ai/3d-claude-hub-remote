// Documents attached to a prompt from the web UI (PDF, Word, Excel...). Claude Code cannot take them as message
// content the way it takes images, so the server saves each one into a folder on this machine and the prompt
// names its path; the session then reads the file like any other. Files are only ever added: never overwritten,
// never deleted here.
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { ATTACH_DOC_EXTENSIONS, MAX_ATTACH_DOC_BYTES } from "../../src/integrations/AgentBackend.ts";

/** Name of the folder attachments go in, inside the Workspace folder next to the working folder. */
export const ATTACH_FOLDER_NAME = "Đính kèm văn phòng";

/**
 * Where attachments are saved. Tổ giúp việc keeps results in a "Workspace" folder next to the Brainstorm vault
 * (the default working folder), and sessions there may already write to it; use it when it exists. Otherwise
 * ~/.aaw/attachments.
 */
export function defaultAttachDir(workdir: string | undefined, home = homedir()): string {
  if (workdir) {
    const workspace = join(dirname(workdir), "Workspace");
    if (existsSync(workspace) && statSync(workspace).isDirectory()) return join(workspace, ATTACH_FOLDER_NAME);
  }
  return join(home, ".aaw", "attachments");
}

/** A file name that is safe on Windows and keeps its extension: no folders, no reserved characters, not too long. */
export function safeFileName(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  let clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  const ext = extname(clean);
  let stem = clean.slice(0, clean.length - ext.length).trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem) || stem.replace(/\./g, "") === "") stem = `Tệp ${stem}`.trim();
  if (stem.length > 120) stem = stem.slice(0, 120).trim();
  clean = stem + ext.toLowerCase();
  return clean;
}

/** Local date as YYYY-MM-DD, the subfolder of one day's attachments. */
export function dayFolder(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Check an attachment from the web UI (untrusted input) and return its bytes and safe name. */
export function checkAttachment(fileName: unknown, data: unknown): { name: string; bytes: Buffer } {
  if (typeof fileName !== "string" || !fileName.trim()) throw new Error("Tệp đính kèm cần có tên.");
  const name = safeFileName(fileName);
  const ext = extname(name).toLowerCase();
  if (!(ATTACH_DOC_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`Chưa nhận loại tệp "${ext || "không đuôi"}". Đính kèm được: ${ATTACH_DOC_EXTENSIONS.join(", ")} và ảnh.`);
  }
  if (typeof data !== "string" || !BASE64_RE.test(data)) throw new Error("Nội dung tệp không hợp lệ.");
  if (data.length > Math.ceil(MAX_ATTACH_DOC_BYTES / 3) * 4) throw new Error(`Tệp quá lớn: tối đa ${Math.round(MAX_ATTACH_DOC_BYTES / 1024 / 1024)} MB.`);
  const bytes = Buffer.from(data, "base64");
  if (bytes.length === 0) throw new Error("Tệp rỗng.");
  return { name, bytes };
}

/** Save into `dir`/<today>/, adding " (2)", " (3)"... when the name is taken. Returns the absolute path. */
export function saveAttachment(dir: string, fileName: unknown, data: unknown, now = new Date()): string {
  const { name, bytes } = checkAttachment(fileName, data);
  const day = join(dir, dayFolder(now));
  mkdirSync(day, { recursive: true });
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const path = join(day, n === 1 ? name : `${stem} (${n})${ext}`);
    try {
      writeFileSync(path, bytes, { flag: "wx" });
      return path;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error("Thư mục đính kèm hôm nay đã có quá nhiều tệp cùng tên.");
}
