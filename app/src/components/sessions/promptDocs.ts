// Documents you attach to a prompt (PDF, Word, Excel...): the browser cannot tell the server where a file lives on
// disk, so the file's bytes go to the server, which saves a copy (see server/sessions/attachments.ts) and acks its
// path. The prompt then names those paths for the session to read.
import { ATTACH_DOC_EXTENSIONS, MAX_ATTACH_DOC_BYTES } from "../../integrations/AgentBackend.ts";

export interface DocAttachment {
  id: string;
  name: string;
  /** Where the server saved it; absent while saving. */
  path?: string;
}

/** The extension of a file name, lower-cased with its dot ("" when none). */
export function extOf(name: string): string {
  const m = /\.[^./\\]+$/.exec(name);
  return m ? m[0].toLowerCase() : "";
}

export function isDocName(name: string): boolean {
  return (ATTACH_DOC_EXTENSIONS as readonly string[]).includes(extOf(name));
}

/** Why a file cannot be attached as a document, or null when it can. */
export function docRefusal(name: string, size: number): string | null {
  if (!isDocName(name)) return `${name || "Tệp"}: chưa nhận loại tệp này (nhận ảnh và ${ATTACH_DOC_EXTENSIONS.join(", ")}).`;
  if (size === 0) return `${name}: tệp rỗng.`;
  if (size > MAX_ATTACH_DOC_BYTES) return `${name}: quá lớn (tối đa ${Math.round(MAX_ATTACH_DOC_BYTES / 1024 / 1024)} MB). Anh dán đường dẫn tệp vào câu giao việc thay vì đính kèm.`;
  return null;
}

/** The prompt text with the saved documents listed after it. */
export function withDocPaths(text: string, paths: readonly string[]): string {
  if (paths.length === 0) return text;
  const list = paths.map((p) => `- "${p}"`).join("\n");
  const head = paths.length === 1 ? "Tệp đính kèm (đã lưu trên máy, đọc tại đường dẫn này):" : "Tệp đính kèm (đã lưu trên máy, đọc tại các đường dẫn này):";
  return `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${head}\n${list}`;
}

/** A file's bytes as base64 (no data: prefix). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : "");
    };
    r.onerror = () => reject(r.error ?? new Error("Không đọc được tệp."));
    r.readAsDataURL(file);
  });
}

/** Files in a paste or drop that are not images. */
export function otherFiles(list: DataTransfer | null): File[] {
  if (!list) return [];
  return [...list.files].filter((f) => !f.type.startsWith("image/"));
}
