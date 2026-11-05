"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { SESSION_STATUS_LABEL, SessionDot } from "@/components/sessions/sessionUi";
import type { SessionInfo } from "@/integrations/AgentBackend";
import { sessionCommands } from "@/integrations/sessionClient";
import { useSessionStore } from "@/state/useSessionStore";
import { loadTabs, useTabStore } from "@/state/useTabStore";

// Tabs over the chat, so Việt can give the Manager several jobs at once and switch between them. A session keeps
// running when it is not on screen; switching only changes which one the chat shows. A tab is kept for every session
// opened or started here (useTabStore) until he closes the tab, plus any office session that is working or waiting
// for him. Closing a tab only takes it off the strip: the session itself is not stopped. A double-click names a tab
// (kept in this browser); an empty name goes back to the session's title.

const MAX_TABS = 8;

function tabSessions(sessions: SessionInfo[], pinned: string[], openId: string | null): SessionInfo[] {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const out: SessionInfo[] = [];
  for (const id of pinned) {
    const s = byId.get(id);
    if (s) out.push(s);
  }
  for (const s of sessions) {
    if (s.owner === "web" && (s.status === "running" || s.status === "waiting") && !out.includes(s)) out.push(s);
  }
  const open = openId ? byId.get(openId) : undefined;
  if (open && !out.includes(open)) out.push(open);
  return out.slice(-MAX_TABS);
}

function shortTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length > 26 ? `${t.slice(0, 25)}…` : t || "Phiên";
}

export function SessionTabs({ canStart }: { canStart: boolean }) {
  const sessions = useSessionStore((s) => s.sessions);
  const openId = useSessionStore((s) => s.openId);
  const composing = useSessionStore((s) => s.composeNew);
  const pinned = useTabStore((s) => s.ids);
  const labels = useTabStore((s) => s.labels);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const finish = (save: boolean) => {
    if (save && editing) useTabStore.getState().setLabel(editing, draft);
    setEditing(null);
  };
  useEffect(loadTabs, []);
  const tabs = tabSessions(sessions, pinned, openId);
  const closeTab = (id: string) => {
    useTabStore.getState().unpin(id);
    if (id !== openId) return;
    const next = tabs.filter((t) => t.sessionId !== id).at(-1);
    if (next) void sessionCommands.open(next.sessionId);
    else sessionCommands.close();
  };
  if (tabs.length === 0 && !canStart) return null;
  return (
    <div className="flex flex-none items-center gap-1 overflow-x-auto border-b border-mist-500/12 px-2 py-1.5 scroll-thin" role="tablist" aria-label="Các phiên đang làm" data-testid="session-tabs">
      {tabs.map((s) => {
        const active = s.sessionId === openId && !composing;
        const name = labels[s.sessionId] ?? s.title;
        if (editing === s.sessionId) {
          return (
            <input
              key={s.sessionId}
              autoFocus
              value={draft}
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => finish(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") finish(true);
                else if (e.key === "Escape") {
                  e.preventDefault();
                  finish(false);
                }
              }}
              placeholder={shortTitle(s.title)}
              aria-label="Tên thẻ"
              className="field h-7 w-[200px] flex-none py-0 text-[12px]"
              data-testid="session-tab-rename"
            />
          );
        }
        return (
          <div
            key={s.sessionId}
            className={`group flex h-7 max-w-[240px] flex-none items-center rounded-[3px] border text-[12px] ${
              active ? "border-signal/40 bg-signal/10 font-semibold text-mist-100" : "border-transparent text-mist-300 hover:border-mist-500/25 hover:bg-ink-900"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => void sessionCommands.open(s.sessionId)}
              onDoubleClick={() => {
                setDraft(labels[s.sessionId] ?? "");
                setEditing(s.sessionId);
              }}
              title={`${s.title}\n${SESSION_STATUS_LABEL[s.status]}\nBấm đúp để đặt tên thẻ`}
              className="flex h-full min-w-0 items-center gap-1.5 pl-2 pr-1"
              data-testid="session-tab"
            >
              <SessionDot status={s.status} />
              <span className="truncate">{shortTitle(name)}</span>
            </button>
            <button
              type="button"
              onClick={() => closeTab(s.sessionId)}
              className="mr-0.5 flex size-5 flex-none items-center justify-center rounded-[2px] text-mist-500 opacity-60 hover:bg-mist-500/15 hover:text-mist-100 group-hover:opacity-100"
              aria-label={`Đóng thẻ ${shortTitle(name)}`}
              title="Đóng thẻ (phiên không bị dừng; mở lại ở Danh sách)"
              data-testid="session-tab-close"
            >
              <X size={12} />
            </button>
          </div>
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
