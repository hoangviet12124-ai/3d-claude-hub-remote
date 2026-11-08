"use client";

// The org chart (sơ đồ) of Tổ giúp việc: one lamp per agent, light running along the lines when work is handed
// down (Manager → department) and back (report, green). Fed by the live source's `org` snapshot.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OrgMove, OrgState } from "@/integrations/AgentBackend";
import { useWorldStore } from "@/state/useWorldStore";
import { displayName, layoutOrg, pathTo, STAGE_W, unitOf } from "./orgLayout";
import type { CardNode, DotNode, Edge, IconName, OrgLayout } from "./orgLayout";
import "./orgBoard.css";

const ICON: Record<IconName, string> = {
  boss: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/><path d="M5 19h14"/>',
  hub: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.5 4.6M12 11.5l5.5 4.6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  build: '<path d="M4 21V5l8-2v18M12 9h8v12M3 21h18M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2"/>',
  coins:
    '<ellipse cx="9" cy="7" rx="6" ry="2.5"/><path d="M3 7v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7"/><path d="M9 16.5c-3.3 0-6-1.1-6-2.5"/><ellipse cx="15" cy="15" rx="6" ry="2.5"/><path d="M9 15v3c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-3"/>',
  flow: '<rect x="3" y="4" width="7" height="5" rx="1"/><rect x="14" y="15" width="7" height="5" rx="1"/><path d="M6.5 9v4.5a2 2 0 0 0 2 2H14"/><path d="M12 13l2 2.5-2 2.5"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/><path d="M14 20h6"/>',
  flask: '<path d="M9 3h6M10 3v6l-5.2 9.2A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-2.8L14 9V3"/><path d="M7.5 15h9"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="2.8"/><path d="M4 5v14c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V5"/><path d="M4 12c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8"/>',
  scan: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M3 13h18"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  more: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
};

const EMPTY: OrgState = { agents: [], manager: { state: "off", task: "" }, runs: [], moves: [] };
const FLASH_MS = 1600;

/** Lit-green-for-a-moment marks after a report or an answer; "boss:on" lights the Boss when a prompt goes out. */
function useFlashes(): [Set<string>, (id: string) => void] {
  const [flash, setFlash] = useState<Set<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);
  const add = useCallback((id: string) => {
    setFlash((s) => new Set(s).add(id));
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setFlash((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }, FLASH_MS),
    );
  }, []);
  return [flash, add];
}

function Card({ n }: { n: CardNode }) {
  const cls = `ob-card${n.state === "off" ? "" : ` ${n.state}`}`;
  const mark = n.state === "done" ? "✓" : n.state === "wait" ? "!" : n.state === "err" ? "×" : "";
  return (
    <div className={cls} style={{ left: n.x, top: n.y, width: n.w, ["--acc" as string]: n.acc }} title={n.tip} data-node={n.id} data-state={n.state}>
      <div className="ob-ic">
        <svg viewBox="0 0 24 24" aria-hidden dangerouslySetInnerHTML={{ __html: ICON[n.icon] }} />
      </div>
      <div className="ob-tx">
        <b>{n.title}</b>
        <span>{n.status}</span>
      </div>
      <i className="ob-mark" aria-hidden>
        {mark}
      </i>
      {n.ports.in ? <i className="ob-port in" /> : null}
      {n.ports.out ? <i className="ob-port out" /> : null}
      {n.ports.down ? <i className="ob-port down" /> : null}
      {n.ports.up ? <i className="ob-port up" /> : null}
    </div>
  );
}

function Dot({ n }: { n: DotNode }) {
  const st = n.state === "off" ? "" : ` ${n.state}`;
  return (
    <>
      <div className={`ob-dot${st}`} style={{ left: n.cx - 13, top: n.cy - 13, ["--acc" as string]: n.acc }} title={n.tip} data-node={n.id} data-state={n.state}>
        {n.num}
      </div>
      <span className={`ob-dlabel${st}`} style={{ left: n.cx + 20, top: n.cy - 9, ["--acc" as string]: n.acc }} title={n.tip}>
        {n.label}
      </span>
    </>
  );
}

/** Light running along one edge (forward) or back along it (green). Resolves when it has arrived. */
function runFlow(g: SVGGElement, e: Edge, back: boolean): Promise<void> {
  const ns = "http://www.w3.org/2000/svg";
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", e.d);
  p.setAttribute("class", back ? "ob-flow back" : "ob-flow");
  p.style.setProperty("--acc", e.acc);
  g.appendChild(p);
  const L = p.getTotalLength();
  const S = Math.min(60, L * 0.45);
  p.style.strokeDasharray = `${S} ${L + S}`;
  const from = back ? -L : S;
  const to = back ? S : -L;
  const anim = p.animate([{ strokeDashoffset: from }, { strokeDashoffset: to }], { duration: Math.max(480, L * 1.9), easing: "ease-in-out" });
  return anim.finished.then(
    () => p.remove(),
    () => p.remove(),
  );
}

/** The chain of cards a move travels through, and in which direction. */
function routeOf(m: OrgMove): { nodes: string[]; back: boolean } | null {
  if (m.kind === "prompt") return { nodes: ["boss", "mgr"], back: false };
  if (m.kind === "answer") return { nodes: ["mgr", "boss"], back: true };
  if (m.kind === "assign") return { nodes: pathTo(m.agentType), back: false };
  if (m.kind === "report") return { nodes: pathTo(m.agentType).reverse(), back: true };
  return null;
}

const LOG_KIND: Record<OrgMove["kind"], string> = { prompt: "k-go", assign: "k-go", report: "k-ret", answer: "k-ret", fail: "k-bad" };
/** The server writes agent file names ("so-hoa"); the log shows the department's name instead. */
const friendlyText = (m: OrgMove) => (m.agentType ? m.text.split(m.agentType).join(displayName(m.agentType)) : m.text);
const clock = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour12: false });

/** The wallpaper's ticker: time, who, what happened. Never the task itself. */
function wallLine(m: OrgMove): [who: string, what: string] {
  if (m.kind === "prompt") return ["Manager", "Assigned"];
  if (m.kind === "answer") return ["Manager", "Done"];
  if (m.kind === "fail") return ["Manager", "Error"];
  return [displayName(m.agentType, true), m.kind === "assign" ? "Assigned" : "Done"];
}

/** `wall`: the desktop wallpaper. English names only, no task texts, a short ticker instead of the log. */
export function OrgBoard({ variant }: { variant: "full" | "compact" | "wall" }) {
  const org = useWorldStore((s) => s.org);
  const backend = useWorldStore((s) => s.backend);
  const [flash, addFlash] = useFlashes();
  const wall = variant === "wall";
  const layout = useMemo(() => layoutOrg(org ?? EMPTY, flash, wall), [org, flash, wall]);
  const layoutRef = useRef<OrgLayout>(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    // The whole chart fits the box both ways (no scrolling across), centred across.
    const fit = () => {
      const w = el.clientWidth;
      const s = Math.min(variant === "compact" ? 1 : variant === "wall" ? 1.4 : 1.05, w / STAGE_W, el.clientHeight / layoutRef.current.height);
      setScale(s);
      setOffset(Math.max(0, (w - STAGE_W * s) / 2));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [variant, layout.height]);

  // New moves send light along the lines. The first batch seen is history: no light for it.
  const flowRef = useRef<SVGGElement>(null);
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    const moves = org?.moves ?? [];
    if (!org) return;
    const top = moves.at(-1)?.seq ?? 0;
    if (lastSeq.current === null || top < lastSeq.current) {
      lastSeq.current = top; // first look, or the server restarted
      return;
    }
    const fresh = moves.filter((m) => m.seq > lastSeq.current!);
    lastSeq.current = top;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const m of fresh) {
      if (m.kind === "prompt") addFlash("boss:on");
      if (m.kind === "answer") {
        addFlash("mgr");
        addFlash("boss");
      }
      if (m.kind === "report") addFlash(unitOf(m.agentType));
      const route = routeOf(m);
      const g = flowRef.current;
      if (!route || !g || reduce) continue;
      void (async () => {
        for (let i = 0; i + 1 < route.nodes.length; i++) {
          const a = route.nodes[i]!;
          const b = route.nodes[i + 1]!;
          const edges = layoutRef.current.edges;
          const fwd = edges.find((e) => e.from === a && e.to === b);
          const rev = edges.find((e) => e.from === b && e.to === a);
          const e = fwd ?? rev;
          if (!e || !flowRef.current) return;
          await runFlow(flowRef.current, e, !fwd);
        }
      })();
    }
  }, [org, addFlash]);

  const { cards, dots, groups, edges, height, counts } = layout;
  const stage = (
    <div ref={canvasRef} className="ob-canvas">
      <div className="ob-stage" style={{ height, transform: `translateX(${offset}px) scale(${scale || 0.0001})` }}>
        {groups.map((gr) => (
          <div key={gr.key} className={`ob-group${gr.busy ? " busy" : ""}`} style={{ left: gr.x, top: gr.y, width: gr.w, height: gr.h, ["--acc" as string]: gr.acc }}>
            <span>{gr.label}</span>
          </div>
        ))}
        <svg className="ob-wires" style={{ height }} viewBox={`0 0 ${STAGE_W} ${height}`} aria-hidden>
          <defs>
            <filter id="ob-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {edges.map((e) => (
            <path key={e.key} className={`ob-edge${e.sub ? " sub" : ""}${e.live ? " live" : ""}`} d={e.d} style={{ ["--acc" as string]: e.acc }} />
          ))}
          <g ref={flowRef} filter="url(#ob-glow)" />
        </svg>
        {cards.map((n) => (
          <Card key={n.id} n={n} />
        ))}
        {dots.map((n) => (
          <Dot key={n.id} n={n} />
        ))}
        {layout.empty && org && !wall ? (
          <p className="ob-note" style={{ top: height / 2 - 30 }}>
            Chưa thấy file agent nào trong thư mục .claude\agents của thư mục làm việc. Các phòng sẽ tự hiện khi Tổ có agent hoặc khi một agent bắt đầu chạy.
          </p>
        ) : null}
      </div>
    </div>
  );

  if (wall) {
    const ticker = (org?.moves ?? []).slice(-4).reverse();
    return (
      <div className="ob ob-wall" data-testid="org-wall">
        <header className="ob-wall-head">
          <span className="ob-wall-title">OPS BOARD</span>
          <span className="ob-wall-meters">
            <b className={counts.on ? "on" : undefined}>{counts.on}</b> working
            <b className={counts.wait ? "wait" : undefined}>{counts.wait}</b> waiting
            <b className={counts.err ? "err" : undefined}>{counts.err}</b> error
          </span>
        </header>
        <div className="ob-wall-board">{stage}</div>
        <ul className="ob-ticker">
          {ticker.map((m) => {
            const [who, what] = wallLine(m);
            return (
              <li key={m.seq} className={LOG_KIND[m.kind]}>
                <time>{clock(m.at)}</time> - <span>{who}</span> - <em>{what}</em>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className="ob ob-compact" data-testid="org-board" aria-label="Sơ đồ Tổ giúp việc">
        {stage}
      </div>
    );
  }

  const conn = backend.connection;
  const connText = conn === "open" ? "đang nối văn phòng" : conn === "connecting" ? "đang nối…" : "mất kết nối với văn phòng";
  const moves = (org?.moves ?? []).slice().reverse();
  return (
    <div className="ob ob-page" data-testid="org-page">
      <div className="ob-wrap">
        <header className="ob-head">
          <div className="ob-brand">
            <i className={`ob-power${conn === "open" ? " open" : conn === "connecting" ? "" : " bad"}`} aria-hidden />
            <h1>Sơ đồ Tổ giúp việc</h1>
            <span className="ob-conn">{connText}</span>
          </div>
          <div className="ob-meters" aria-live="polite">
            {(
              [
                ["on", "đang làm"],
                ["wait", "chờ duyệt"],
                ["err", "lỗi"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className={`ob-meter ob-m-${k}`}>
                <b className={counts[k] === 0 ? "zero" : undefined}>{counts[k]}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </header>
        <section className="ob-board" aria-label="Sơ đồ">
          {stage}
        </section>
        {org === null && conn === "open" && backend.identified ? (
          <p className="ob-wait-msg">
            Văn phòng chưa gửi sơ đồ. Có thể văn phòng đang chạy bản cũ (cập nhật bằng git pull rồi chạy lại) hoặc đang chạy bản mô phỏng, không đọc phiên Claude Code thật.
          </p>
        ) : null}
        <section className="ob-logbox" aria-label="Nhật ký">
          <h2>Nhật ký</h2>
          <ul className="ob-log">
            {moves.length === 0 ? <li className="k-info ob-empty"><i /><time /><span>Chưa có việc nào từ lúc văn phòng mở.</span></li> : null}
            {moves.map((m) => (
              <li key={m.seq} className={LOG_KIND[m.kind]}>
                <i />
                <time>{clock(m.at)}</time>
                <span>{friendlyText(m)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
