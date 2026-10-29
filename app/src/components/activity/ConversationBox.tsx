"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AGENTS } from "@/agents/AgentRegistry";
import type { AgentId } from "@/agents/agentTypes";
import { Avatar, formatClock } from "@/components/ui";
import { feedEvents } from "@/events/eventStore";
import { useWorldStore } from "@/state/useWorldStore";

const nameOf = (id: AgentId) => AGENTS.find((a) => a.id === id)?.name ?? id;
const colorOf = (id: AgentId) => AGENTS.find((a) => a.id === id)?.color ?? "currentColor";

/**
 * "Phòng hội thoại": các tin trao đổi gần nhất giữa các agent, nổi ở góc dưới bên trái cảnh 3D như bảng
 * điều hành mẫu. Chỉ hiện trên màn rộng; thu gọn được. "Chi tiết" mở tab Hội thoại đầy đủ.
 */
export function ConversationBox() {
  const events = useWorldStore((s) => s.events);
  const setTab = useWorldStore((s) => s.setTab);
  const [open, setOpen] = useState(true);
  const messages = useMemo(() => feedEvents(events, true), [events]);
  const latest = messages.slice(-4).reverse();

  return (
    <section className="surface pointer-events-auto absolute bottom-16 left-0 hidden w-[min(400px,45%)] min-w-[300px] flex-col lg:flex" aria-label="Phòng hội thoại" data-testid="conversation-box">
      <header className="flex items-center gap-2 border-b-[1.5px] border-line px-3 py-2">
        <button type="button" className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-mist-100" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          Phòng hội thoại
        </button>
        <span className="whitespace-nowrap font-mono text-[11px] text-mist-500">· {messages.length} tin</span>
        <button type="button" className="btn ml-auto h-7 flex-none px-2 font-mono text-[11px]" onClick={() => setTab("activity")}>
          Chi tiết →
        </button>
      </header>
      {open ? (
        latest.length === 0 ? (
          <p className="px-3 py-3 text-[12.5px] text-mist-500">Chưa có trao đổi nào. Bấm Chạy thử để xem các agent làm việc.</p>
        ) : (
          <ol className="flex flex-col gap-2.5 px-3 py-2.5">
            {latest.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                {e.agentId ? <Avatar id={e.agentId} size={26} /> : null}
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-5 text-mist-500">
                    {e.agentId ? (
                      <b className="font-semibold" style={{ color: colorOf(e.agentId), filter: "brightness(0.7) saturate(1.3)" }}>
                        {nameOf(e.agentId)}
                      </b>
                    ) : null}
                    {e.targetAgentId ? <> → {nameOf(e.targetAgentId)}</> : null} · {formatClock(e.simTime)}
                  </p>
                  <p className="line-clamp-2 text-[12.5px] leading-snug text-mist-100">{e.message}</p>
                </div>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </section>
  );
}
