"use client";
// Images in the Sessions chat: attaching them to a prompt (paste, drop, pick), and showing the ones in a
// conversation (fetched from the server on demand) with a full-size view.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, ImageOff, Paperclip, X } from "lucide-react";
import { ATTACH_DOC_EXTENSIONS, PROMPT_IMAGE_TYPES } from "@/integrations/AgentBackend";
import type { PromptImage, SessionImageRef } from "@/integrations/AgentBackend";
import { sessionCommands } from "@/integrations/sessionClient";
import { fileToAttachment, imageFiles, roomFor } from "@/components/sessions/promptImages";
import type { Attachment } from "@/components/sessions/promptImages";
import { docRefusal, fileToBase64, otherFiles, withDocPaths } from "@/components/sessions/promptDocs";
import type { DocAttachment } from "@/components/sessions/promptDocs";

// ───────────────────────── attaching ─────────────────────────

export interface Attachments {
  items: Attachment[];
  /** Documents (PDF, Word, Excel...) saved on the server's machine; the prompt names their paths. */
  docs: DocAttachment[];
  /** Images plus documents attached. */
  count: number;
  /** Reading or saving files in progress. */
  reading: boolean;
  /** Why something was not attached. */
  note: string | null;
  add: (files: File[]) => Promise<void>;
  remove: (id: string) => void;
  clear: () => void;
  /** What goes into `sendPrompt`. */
  payload: () => PromptImage[];
  /** The prompt text with the saved documents' paths listed after it. */
  text: (typed: string) => string;
  /** Paste handler for a textarea: attaches pasted images, lets text paste as usual. */
  onPaste: (e: React.ClipboardEvent) => void;
  /** Drop handlers for the area images can be dropped on. */
  dropProps: { onDragOver: (e: React.DragEvent) => void; onDragLeave: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void };
  dragging: boolean;
}

export function useAttachments(disabled = false): Attachments {
  const [items, setItems] = useState<Attachment[]>([]);
  const [docs, setDocs] = useState<DocAttachment[]>([]);
  const [reading, setReading] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Refs, so two quick pastes both see what the other already took.
  const count = useRef(0);
  const inFlight = useRef(0);
  useEffect(() => {
    count.current = items.length;
  }, [items]);

  const addImages = useCallback(async (files: File[], notes: string[]) => {
    if (files.length === 0) return;
    const { take, note: full } = roomFor(count.current + inFlight.current, files.length);
    if (full) notes.push(full);
    inFlight.current += take;
    setReading((n) => n + take);
    const read = await Promise.all(
      files.slice(0, take).map((f) =>
        fileToAttachment(f).catch((err: unknown) => {
          notes.push(err instanceof Error ? err.message : String(err));
          return null;
        }),
      ),
    );
    const ok = read.filter((a): a is Attachment => !!a);
    inFlight.current -= take;
    count.current += ok.length;
    setReading((n) => n - take);
    setItems((cur) => [...cur, ...ok]);
  }, []);

  // A document is saved on the server's machine as soon as it is attached, so the path is ready when you send.
  // Removing it from the strip leaves the saved copy where it is (nothing is deleted from here).
  const addDocs = useCallback(async (files: File[], notes: string[]) => {
    await Promise.all(
      files.map(async (f) => {
        const refusal = docRefusal(f.name, f.size);
        if (refusal) {
          notes.push(refusal);
          return;
        }
        const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setDocs((cur) => [...cur, { id, name: f.name }]);
        setReading((n) => n + 1);
        try {
          const path = await sessionCommands.saveAttachment(f.name, await fileToBase64(f));
          setDocs((cur) => cur.map((d) => (d.id === id ? { ...d, path } : d)));
        } catch (err) {
          setDocs((cur) => cur.filter((d) => d.id !== id));
          notes.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setReading((n) => n - 1);
        }
      }),
    );
  }, []);

  const add = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const notes: string[] = [];
      setNote(null);
      await Promise.all([addImages(files.filter((f) => f.type.startsWith("image/")), notes), addDocs(files.filter((f) => !f.type.startsWith("image/")), notes)]);
      setNote(notes.length > 0 ? notes.join(" ") : null);
    },
    [addImages, addDocs],
  );

  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");

  return {
    items,
    docs,
    count: items.length + docs.length,
    reading: reading > 0,
    note,
    add,
    remove: (id) => {
      if (id.startsWith("doc-")) setDocs((cur) => cur.filter((d) => d.id !== id));
      else {
        setItems((cur) => cur.filter((a) => a.id !== id));
        count.current = Math.max(0, count.current - 1);
      }
      setNote(null);
    },
    clear: () => {
      setItems([]);
      setDocs([]);
      count.current = 0;
      setNote(null);
    },
    payload: () => items.map(({ mediaType, data }) => ({ mediaType, data })),
    text: (typed) => withDocPaths(typed, docs.flatMap((d) => (d.path ? [d.path] : []))),
    onPaste: (e) => {
      if (disabled) return;
      const files = [...imageFiles(e.clipboardData), ...otherFiles(e.clipboardData)];
      if (files.length === 0) return;
      // A screenshot has no text: keep the browser from pasting anything else. Copied web content keeps its text.
      if (!e.clipboardData.types.includes("text/plain")) e.preventDefault();
      void add(files);
    },
    dropProps: {
      onDragOver: (e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      },
      onDragLeave: (e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      },
      onDrop: (e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        const files = [...imageFiles(e.dataTransfer), ...otherFiles(e.dataTransfer)];
        if (files.length > 0) void add(files);
      },
    },
    dragging,
  };
}

/** The paperclip of the composer: opens the file picker for images and documents. */
export function AttachButton({ onFiles, disabled, className = "" }: { onFiles: (files: File[]) => void; disabled?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={`btn btn-quiet ${className}`}
        onClick={() => input.current?.click()}
        disabled={disabled}
        title="Đính kèm ảnh hoặc tệp PDF, Word, Excel (hoặc kéo thả vào đây)"
        aria-label="Đính kèm ảnh hoặc tệp"
        data-testid="attach-image"
      >
        <Paperclip size={14} />
      </button>
      <input
        ref={input}
        type="file"
        accept={[...PROMPT_IMAGE_TYPES, "image/*", ...ATTACH_DOC_EXTENSIONS].join(",")}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          onFiles(files);
        }}
      />
    </>
  );
}

/** Thumbnails of the images and names of the documents about to be sent, each with a remove button. */
export function AttachmentStrip({ a, disabled }: { a: Attachments; disabled?: boolean }) {
  if (a.count === 0 && !a.reading && !a.note) return null;
  return (
    <div className="flex flex-col gap-1">
      {a.docs.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tệp đính kèm" data-testid="attached-docs">
          {a.docs.map((d) => (
            <li
              key={d.id}
              className="flex max-w-[260px] items-center gap-1.5 rounded-md border border-mist-500/20 bg-ink-900/60 py-1 pl-2 pr-1 text-[12px] text-mist-100"
              title={d.path ? `Đã lưu: ${d.path}` : "Đang lưu…"}
            >
              <FileText size={13} className="flex-none text-mist-300" />
              <span className="truncate">{d.name}</span>
              {d.path ? null : <span className="flex-none text-[10.5px] text-mist-500">đang lưu…</span>}
              <button
                type="button"
                onClick={() => a.remove(d.id)}
                disabled={disabled || !d.path}
                className="flex size-5 flex-none items-center justify-center rounded-[2px] text-mist-500 hover:bg-mist-500/15 hover:text-mist-100"
                aria-label={`Bỏ ${d.name}`}
                title="Bỏ khỏi câu giao việc (bản đã lưu vẫn giữ)"
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {a.items.length > 0 || (a.reading && a.docs.every((d) => d.path)) ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Attached images" data-testid="attachments">
          {a.items.map((it) => (
            <li key={it.id} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL, nothing to optimise */}
              <img src={it.url} alt={it.name} title={it.name} className="h-14 w-14 rounded-md border border-mist-500/20 object-cover" />
              <button
                type="button"
                onClick={() => a.remove(it.id)}
                disabled={disabled}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-mist-500/30 bg-ink-900 text-mist-300 hover:text-mist-100"
                aria-label={`Remove ${it.name}`}
                title="Remove"
              >
                <X size={11} />
              </button>
            </li>
          ))}
          {a.reading ? <li className="flex h-14 w-14 items-center justify-center rounded-md border border-dashed border-mist-500/30 text-[10.5px] text-mist-500">Reading…</li> : null}
        </ul>
      ) : null}
      {a.note ? <p className="text-[11px] leading-snug text-bad">{a.note}</p> : null}
    </div>
  );
}

// ───────────────────────── showing ─────────────────────────

/** A full-size view over the page; Escape, a click or the close button closes it. */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/90 p-4" onClick={onClose} data-testid="lightbox">
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL or a URL you chose to load */}
      <img src={src} alt={alt} referrerPolicy="no-referrer" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
      <button type="button" onClick={onClose} className="btn btn-quiet absolute right-3 top-3 h-9 w-9 p-0" aria-label="Close" autoFocus>
        <X size={16} />
      </button>
    </div>,
    document.body,
  );
}

function SessionImage({ sessionId, image, index }: { sessionId: string; image: SessionImageRef; index: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    sessionCommands.image(sessionId, image.id).then(
      (url) => live && setSrc(url),
      (err: unknown) => live && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [sessionId, image.id]);
  const alt = `Image ${index + 1}`;
  if (error) {
    return (
      <span className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-mist-500/20 bg-ink-900/60 px-1 text-center text-[10.5px] leading-tight text-mist-500" title={error}>
        <ImageOff size={14} /> {alt} unavailable
      </span>
    );
  }
  if (!src) return <span className="block h-20 w-28 animate-pulse rounded-lg bg-ink-800/80" aria-label={`Loading ${alt}`} />;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block overflow-hidden rounded-lg border border-mist-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" title="View full size">
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from the transcript */}
        <img src={src} alt={alt} className="max-h-48 max-w-[min(100%,16rem)] object-contain" data-testid="session-image" />
      </button>
      {open ? <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The images of one prompt in the conversation. */
export function SessionImages({ sessionId, images }: { sessionId: string; images: readonly SessionImageRef[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {images.map((im, i) => (
        <SessionImage key={im.id} sessionId={sessionId} image={im} index={i} />
      ))}
    </div>
  );
}
