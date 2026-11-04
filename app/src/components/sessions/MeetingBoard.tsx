"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Presentation, X } from "lucide-react";
import { getAgent } from "@/agents/AgentRegistry";
import { subagentRole } from "@/agents/subagentRole";
import type { AgentId } from "@/agents/agentTypes";
import { Markdown } from "@/components/sessions/Markdown";
import { PermissionStack } from "@/components/sessions/PermissionStack";
import { sessionCommands } from "@/integrations/sessionClient";
import { SessionsPanel } from "@/components/sessions/SessionsPanel";
import type { SessionItem } from "@/integrations/AgentBackend";
import { useSessionStore } from "@/state/useSessionStore";
import { useWorldStore } from "@/state/useWorldStore";

// The meeting board (Bảng họp): a large window over the office. Left, what each agent presented: the report every
// subagent handed back to the Manager (the Agent/Task tool result in the session transcript), then the Manager's
// own summary. Right, the conversation with the Manager (the Sessions view, at full height), where Việt answers or
// gives the next task. Everything shown comes from the open session's transcript; nothing is generated here.

interface Presentation {
  id: string;
  agent: AgentId;
  /** The agent file name Claude used (subagent_type), e.g. "thu-thu". */
  agentType: string;
  /** What the Manager asked for, in a few words (the Agent tool's description). */
  brief: string;
  /** The report, or null while the agent is still working. */
  report: string | null;
  failed: boolean;
}

interface Round {
  id: string;
  /** What Việt asked in this round (the prompt that started it). */
  request: string;
  presentations: Presentation[];
  /** The Manager's last message of the round, after the agents reported. */
  summary: string | null;
}

/** One string field from the tool input. The input is JSON, but may be cut short for very long prompts. */
function field(input: string, key: string): string {
  const m = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(input);
  if (!m) return "";
  try {
    return JSON.parse(m[1]!) as string;
  } catch {
    return "";
  }
}

/** Claude Code appends bookkeeping to a subagent's result (its id for resuming, usage); the board shows the report. */
function cleanReport(text: string): string {
  return text
    .replace(/\n*agentId: [\s\S]*$/, "")
    .replace(/\n*<usage>[\s\S]*?<\/usage>\s*$/, "")
    .trim();
}

export function buildRounds(items: SessionItem[]): Round[] {
  const rounds: Round[] = [];
  let cur: Round | null = null;
  for (const it of items) {
    if (it.kind === "user") {
      cur = { id: it.id, request: it.text, presentations: [], summary: null };
      rounds.push(cur);
      continue;
    }
    if (!cur) {
      cur = { id: `start-${it.id}`, request: "", presentations: [], summary: null };
      rounds.push(cur);
    }
    if (it.kind === "tool" && /^(Agent|Task)$/.test(it.name)) {
      const agentType = field(it.input, "subagent_type") || "general-purpose";
      cur.presentations.push({
        id: it.id,
        agent: subagentRole(agentType),
        agentType,
        brief: field(it.input, "description") || it.summary,
        report: it.result ? cleanReport(it.result.text) : null,
        failed: it.result?.isError === true,
      });
      cur.summary = null;
    } else if (it.kind === "assistant" && it.text.trim()) {
      cur.summary = it.text;
    }
  }
  return rounds.filter((r) => r.presentations.length > 0 || r.summary);
}

function Avatar({ agent }: { agent: AgentId }) {
  const p = getAgent(agent);
  return (
    <span className="grid size-9 flex-none place-items-center rounded-full text-[14px] font-semibold text-white" style={{ background: p.color }} aria-hidden>
      {p.name.charAt(0)}
    </span>
  );
}

function Card({ agent, title, subtitle, text, sessionId, pending, failed, defaultOpen }: {
  agent: AgentId;
  title: string;
  subtitle: string;
  text: string | null;
  sessionId: string;
  pending?: boolean;
  failed?: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const long = (text?.length ?? 0) > 900;
  const color = getAgent(agent).color;
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-mist-500/15 bg-ink-850/70 px-4 py-3" style={{ borderLeft: `4px solid ${color}` }} data-testid="board-card">
      <header className="flex items-start gap-3">
        <Avatar agent={agent} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14px] font-semibold text-mist-100">{title}</span>
          <span className="text-[12px] leading-snug text-mist-500">{subtitle}</span>
        </div>
        {pending ? <span className="flex-none rounded-full bg-signal/12 px-2 py-0.5 text-[11px] font-medium text-signal">Đang làm…</span> : null}
        {failed ? <span className="flex-none rounded-full bg-bad/12 px-2 py-0.5 text-[11px] font-medium text-bad">Lỗi</span> : null}
      </header>
      {text ? (
        <div className={`relative min-w-0 text-[13.5px] leading-relaxed ${long && !open ? "max-h-56 overflow-hidden" : ""}`}>
          <Markdown text={text} sessionId={sessionId} />
          {long && !open ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-850 to-transparent" /> : null}
        </div>
      ) : null}
      {long ? (
        <button type="button" onClick={() => setOpen((o) => !o)} className="btn btn-quiet h-7 self-start px-2 text-[12px]">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {open ? "Thu gọn" : "Xem đầy đủ"}
        </button>
      ) : null}
    </article>
  );
}

function Presentations() {
  const openId = useSessionStore((s) => s.openId);
  const items = useSessionStore((s) => s.items);
  const title = useSessionStore((s) => s.sessions.find((x) => x.sessionId === s.openId)?.title);
  const rounds = useMemo(() => buildRounds(items), [items]);
  const scroller = useRef<HTMLDivElement>(null);
  const last = rounds[rounds.length - 1];
  const lastKey = `${rounds.length}:${last?.presentations.length ?? 0}:${last?.presentations.filter((p) => p.report !== null).length ?? 0}:${last?.summary?.length ?? 0}`;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastKey]);

  if (!openId) {
    return (
      <p className="m-auto max-w-md px-6 text-center text-[13.5px] leading-relaxed text-mist-500">
        Chọn một phiên ở cột bên phải, hoặc bấm <b className="text-mist-300">Phiên mới</b>. Khi Manager gọi các agent, báo cáo của từng agent sẽ hiện ở đây như một buổi trình bày.
      </p>
    );
  }
  return (
    <div ref={scroller} className="scroll-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 py-4" data-testid="board-rounds">
      {title ? <p className="text-[12px] text-mist-500">Phiên: <span className="text-mist-300">{title}</span></p> : null}
      {rounds.length === 0 ? (
        <p className="m-auto max-w-md text-center text-[13.5px] leading-relaxed text-mist-500">Phiên này chưa có agent nào trình bày. Khi Manager giao việc cho agent, báo cáo sẽ hiện ở đây.</p>
      ) : null}
      {rounds.map((r, i) => {
        const latest = i === rounds.length - 1;
        return (
          <section key={r.id} className="flex flex-col gap-3" aria-label={`Lượt ${i + 1}`}>
            {r.request ? (
              <div className="rounded-xl border border-signal/25 bg-signal/8 px-4 py-2.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-signal">Anh giao · lượt {i + 1}</span>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[13px] leading-relaxed text-mist-100">{r.request}</p>
              </div>
            ) : null}
            {r.presentations.map((p) => {
              const prof = getAgent(p.agent);
              return (
                <Card
                  key={p.id}
                  agent={p.agent}
                  title={`${prof.name} trình bày`}
                  subtitle={`${prof.roleLabel} · ${p.agentType}${p.brief ? ` · việc: ${p.brief}` : ""}`}
                  text={p.report}
                  sessionId={openId}
                  pending={p.report === null}
                  failed={p.failed}
                  defaultOpen={latest}
                />
              );
            })}
            {r.summary ? (
              <Card agent="orion" title="Manager tổng hợp" subtitle="Ý kiến của Manager sau khi nghe các agent" text={r.summary} sessionId={openId} defaultOpen={latest} />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function MeetingBoard() {
  const open = useWorldStore((s) => s.board);
  const setBoard = useWorldStore((s) => s.setBoard);
  const live = useWorldStore((s) => s.backend.identified && !s.backend.simulated);
  const control = useSessionStore((s) => s.capabilities.control);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setBoard(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setBoard]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-ink-950/55 p-2 backdrop-blur-[2px] lg:p-6" role="dialog" aria-modal="true" aria-label="Bảng họp" data-testid="meeting-board">
      <div className="surface flex min-h-0 w-full max-w-[1600px] flex-col overflow-hidden">
        <header className="flex flex-none items-center gap-3 border-b border-mist-500/12 px-5 py-3">
          <Presentation size={18} className="text-signal" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="text-[15px] font-semibold text-mist-100">Bảng họp</h2>
            <p className="truncate text-[12px] text-mist-500">Bên trái: các agent trình bày với anh. Bên phải: trao đổi và giao việc cho Manager.</p>
          </div>
          {live && control ? (
            <button
              type="button"
              className="btn btn-primary h-8 px-3 text-[12.5px]"
              onClick={() => {
                sessionCommands.close();
                useSessionStore.getState().setComposeNew(true);
              }}
              title="Mở một phiên Claude Code mới, chạy ngầm, ở thư mục làm việc của Tổ"
            >
              <Plus size={14} /> Phiên mới
            </button>
          ) : null}
          <button type="button" onClick={() => setBoard(false)} className="btn btn-quiet h-8 px-2.5 text-[12.5px]" aria-label="Đóng bảng họp (Esc)">
            <X size={15} /> Đóng
          </button>
        </header>
        {live ? (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)] lg:grid-rows-1">
            <div className="flex min-h-0 flex-col border-b border-mist-500/12 lg:border-b-0 lg:border-r">
              <h3 className="flex-none px-5 pt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-mist-500">Các agent trình bày</h3>
              <Presentations />
            </div>
            <div className="flex min-h-0 flex-col">
              <h3 className="flex-none px-4 pt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-mist-500">Trao đổi với Manager</h3>
              {/* Permission asks also float over the office, which this window covers: show them here too. */}
              <div className="flex flex-none justify-center px-3 pt-2 empty:hidden">
                <PermissionStack />
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <SessionsPanel />
              </div>
            </div>
          </div>
        ) : (
          <p className="m-auto max-w-md px-6 py-10 text-center text-[13.5px] leading-relaxed text-mist-500">
            Bảng họp đọc phiên Claude Code thật, nên chỉ dùng được khi văn phòng chạy bằng <code className="font-mono">npm run up</code>. Bản mô phỏng không có phiên thật.
          </p>
        )}
      </div>
    </div>
  );
}
