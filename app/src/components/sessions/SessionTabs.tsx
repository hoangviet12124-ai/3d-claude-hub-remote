"use client";

import { Plus } from "lucide-react";
import { SESSION_STATUS_LABEL, SessionDot } from "@/components/sessions/sessionUi";
import type { SessionInfo } from "@/integrations/AgentBackend";
import { sessionCommands } from "@/integrations/sessionClient";
import { useSessionStore } from "@/state/useSessionStore";

// Tabs over the chat: the sessions the office is running (started or continued here and not closed), so Việt can
// give the Manager several jobs at once and switch between them. A session keeps running when it is not on screen;
// switching only changes which one the chat shows. The list is derived, not kept: a session joins when it starts
// and leaves when it is closed (Đóng phiên) or hidden.

const MAX_TABS = 6;

function tabSessions(sessions: SessionInfo[], openId: string | null): SessionInfo[] {
  const working = sessions
    .filter((s) => s.owner === "web" && s.status !== "ended")
    .sort((a, b) => a.lastActivity - b.lastActivity)
    .slice(-MAX_TABS);
  const open = openId ? sessions.find((s) => s.sessionId === openId) : undefined;
  if (open && !working.includes(open)) working.push(open);
  return working;
}

function shortTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length > 26 ? `${t.slice(0, 25)}…` : t || "Phiên";
}

export function SessionTabs({ canStart }: { canStart: boolean }) {
  const sessions = useSessionStore((s) => s.sessions);
  const openId = useSessionStore((s) => s.openId);
  const composing = useSessionStore((s) => s.composeNew);
  const tabs = tabSessions(sessions, openId);
  if (tabs.length === 0 && !canStart) return null;
  return (
    <div className="flex flex-none items-center gap-1 overflow-x-auto border-b border-mist-500/12 px-2 py-1.5 scroll-thin" role="tablist" aria-label="Các phiên đang làm" data-testid="session-tabs">
      {tabs.map((s) => {
        const active = s.sessionId === openId && !composing;
        return (
          <button
            key={s.sessionId}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => void sessionCommands.open(s.sessionId)}
            title={`${s.title}\n${SESSION_STATUS_LABEL[s.status]}`}
            className={`flex h-7 max-w-[220px] flex-none items-center gap-1.5 rounded-[3px] border px-2 text-[12px] ${
              active ? "border-signal/40 bg-signal/10 font-semibold text-mist-100" : "border-transparent text-mist-300 hover:border-mist-500/25 hover:bg-ink-900"
            }`}
            data-testid="session-tab"
          >
            <SessionDot status={s.status} />
            <span className="truncate">{shortTitle(s.title)}</span>
          </button>
        );
      })}
      {canStart ? (
        <button
          type="button"
          onClick={() => {
            sessionCommands.close();
            useSessionStore.getState().setComposeNew(true);
          }}
          className={`flex h-7 flex-none items-center gap-1 rounded-[3px] border px-2 text-[12px] ${composing ? "border-signal/40 bg-signal/10 text-mist-100" : "border-dashed border-mist-500/30 text-mist-500 hover:text-mist-100"}`}
          title="Giao thêm một việc mới cho Manager, chạy song song với các phiên đang làm"
          data-testid="session-tab-new"
        >
          <Plus size={13} /> Việc mới
        </button>
      ) : null}
    </div>
  );
}
