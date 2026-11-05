// Who in Tổ giúp việc is working now, for the org chart (sơ đồ). Fed with the same hook payloads as the live source.
//
// Unlike the robots (one per role), the chart shows every running subagent: three copies of so-hoa at once are three
// lamps. A run starts at SubagentStart and ends at SubagentStop (matched by agent_id when the hook sends one). Its
// task is the description the Manager gave the Agent tool just before. A permission ask from inside a subagent turns
// its lamp amber; an error that ends the turn (usage limit, API error) turns the session's lamps red for a while.
import type { OrgLamp, OrgMove, OrgRun, OrgState } from "../integrations/AgentBackend.ts";

/** The hook fields the chart reads. */
export interface OrgHook {
  hook_event_name: string;
  session_id?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  agent_id?: string;
  agent_type?: string;
  error?: string;
}

/** What the chart needs to know about each session from the live source. */
export interface OrgSessionView {
  sessionId: string;
  title: string;
  status: "running" | "waiting" | "idle" | "ended";
  lastActivity: number;
}

export interface OrgTrackerOptions {
  now?: () => number;
  /** Show task texts (the Manager's descriptions, your prompts). Off: tasks are left empty. */
  showPrompts?: boolean;
  /** Agent file names in <cwd>/.claude/agents. Server-side only (reads the disk); none by default. */
  listAgents?: (cwd: string) => string[];
  /** The work folder before any hook names one (the office's workdir), so departments show from the start. */
  cwd?: string;
}

/** Tool calls issued together with a permission ask do not end the wait (ms). */
const WAIT_GRACE_MS = 2000;
/** A run stopped by an error stays red this long (ms). */
const ERR_TTL_MS = 10 * 60_000;
/** A run nobody heard from in this long is dropped (its SubagentStop was lost) (ms). */
const STALE_MS = 3 * 60 * 60_000;
/** How long the agent list of a folder is cached (ms). */
const AGENTS_TTL_MS = 60_000;
const MAX_MOVES = 40;

interface Run extends OrgRun {
  sessionId: string;
  seen: number;
  waitAt: number;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function oneLine(s: string, max: number): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export class OrgTracker {
  private runs = new Map<string, Run>();
  /** Agent tool calls waiting for their SubagentStart, per session: the type and the description. */
  private pending = new Map<string, { type: string; task: string }[]>();
  /** Sessions whose last turn ended in an error, with the error. */
  private failed = new Map<string, { at: number; text: string }>();
  private moves: OrgMove[] = [];
  private seq = 0;
  private made = 0;
  private cwd = "";
  private agentCache = new Map<string, { at: number; names: string[] }>();
  private opts: Required<Omit<OrgTrackerOptions, "cwd">>;

  constructor(options: OrgTrackerOptions = {}) {
    const { cwd, ...rest } = options;
    this.opts = { now: Date.now, showPrompts: true, listAgents: () => [], ...rest };
    this.cwd = cwd ?? "";
  }

  /** Reads one hook. Returns true when the chart changed. */
  ingest(p: OrgHook): boolean {
    const sid = p.session_id ?? "default";
    const now = this.opts.now();
    if (p.cwd) this.cwd = p.cwd;
    switch (p.hook_event_name) {
      case "UserPromptSubmit": {
        this.failed.delete(sid);
        for (const r of this.runs.values()) if (r.sessionId === sid && r.state === "err") this.runs.delete(r.id);
        const text = this.opts.showPrompts ? oneLine(str(p.prompt), 80) : "";
        this.move("prompt", "", text ? `Boss giao việc: ${text}` : "Boss giao việc cho Manager");
        return true;
      }
      case "PreToolUse": {
        if (!p.agent_type && !p.agent_id && (p.tool_name === "Agent" || p.tool_name === "Task")) {
          const input = p.tool_input ?? {};
          const type = str(input["subagent_type"]) || "general-purpose";
          const task = this.opts.showPrompts ? oneLine(str(input["description"]) || str(input["prompt"]), 80) : "";
          const list = this.pending.get(sid) ?? [];
          list.push({ type, task });
          this.pending.set(sid, list);
          return false;
        }
        return this.touchRun(sid, p, now);
      }
      case "PostToolUse":
      case "PostToolUseFailure":
        return this.touchRun(sid, p, now);
      case "SubagentStart": {
        const type = p.agent_type || "general-purpose";
        const list = this.pending.get(sid) ?? [];
        const i = list.findIndex((x) => x.type === type);
        const task = i >= 0 ? list.splice(i, 1)[0]!.task : "";
        const id = p.agent_id || `${sid}:${type}:${++this.made}`;
        this.runs.set(id, { id, agentType: type, task, state: "on", since: now, sessionId: sid, seen: now, waitAt: 0 });
        this.move("assign", type, `Manager giao ${type}${task ? `: ${task}` : ""}`);
        return true;
      }
      case "SubagentStop": {
        const r = this.findRun(sid, p);
        if (r) this.runs.delete(r.id);
        const type = r?.agentType ?? (p.agent_type || "general-purpose");
        this.move("report", type, `${type} nộp kết quả cho Manager`);
        return true;
      }
      case "PermissionRequest":
      case "Notification": {
        const r = p.agent_id || p.agent_type ? this.findRun(sid, p) : null;
        if (!r) return false; // the Manager's own ask: the session's status shows it
        r.state = "wait";
        r.waitAt = now;
        r.seen = now;
        return true;
      }
      case "Stop":
        this.move("answer", "", "Manager trả lời Boss");
        return true;
      case "StopFailure": {
        const text = oneLine(str(p.error), 90) || "lỗi không rõ";
        this.failed.set(sid, { at: now, text });
        for (const r of this.runs.values()) if (r.sessionId === sid) { r.state = "err"; r.seen = now; }
        this.move("fail", "", `Dừng vì lỗi: ${text}`);
        return true;
      }
      case "SessionEnd": {
        let changed = this.failed.delete(sid);
        for (const r of [...this.runs.values()]) if (r.sessionId === sid) { this.runs.delete(r.id); changed = true; }
        this.pending.delete(sid);
        return changed;
      }
      default:
        return false;
    }
  }

  /** The chart now. `sessions` comes from the live source (status, title). */
  state(sessions: OrgSessionView[]): OrgState {
    const now = this.opts.now();
    for (const r of [...this.runs.values()]) {
      if ((r.state === "err" && now - r.seen > ERR_TTL_MS) || now - r.seen > STALE_MS) this.runs.delete(r.id);
    }
    for (const [sid, f] of this.failed) if (now - f.at > ERR_TTL_MS) this.failed.delete(sid);
    const runs: OrgRun[] = [...this.runs.values()]
      .sort((a, b) => a.since - b.since)
      .map(({ id, agentType, task, state, since }) => ({ id, agentType, task, state, since }));

    const subWaiting = runs.some((r) => r.state === "wait");
    const busy = sessions.filter((s) => s.status === "running" || s.status === "waiting").sort((a, b) => b.lastActivity - a.lastActivity);
    let state: OrgLamp = "off";
    if (busy.some((s) => s.status === "waiting") && !subWaiting) state = "wait";
    else if (busy.length > 0) state = "on";
    else if (this.failed.size > 0) state = "err";
    const task = state === "err" ? [...this.failed.values()].at(-1)!.text : this.opts.showPrompts ? (busy[0]?.title ?? "") : "";

    const agents = new Set(this.agentsOf(this.cwd));
    for (const r of runs) agents.add(r.agentType);
    return { agents: [...agents].sort(), manager: { state, task }, runs, moves: this.moves.slice() };
  }

  private touchRun(sid: string, p: OrgHook, now: number): boolean {
    if (!p.agent_id && !p.agent_type) return false;
    const r = this.findRun(sid, p);
    if (!r) return false;
    r.seen = now;
    if (r.state === "wait" && now - r.waitAt >= WAIT_GRACE_MS) {
      r.state = "on";
      return true;
    }
    return false;
  }

  /** The run a hook belongs to: by agent_id, else the newest run of that agent type in the session. */
  private findRun(sid: string, p: OrgHook): Run | null {
    if (p.agent_id) {
      const r = this.runs.get(p.agent_id);
      if (r) return r;
    }
    const type = p.agent_type || "general-purpose";
    let found: Run | null = null;
    for (const r of this.runs.values()) if (r.sessionId === sid && r.agentType === type && (!found || r.since >= found.since)) found = r;
    return found;
  }

  private move(kind: OrgMove["kind"], agentType: string, text: string): void {
    this.moves.push({ seq: ++this.seq, kind, agentType, at: this.opts.now(), text });
    if (this.moves.length > MAX_MOVES) this.moves.splice(0, this.moves.length - MAX_MOVES);
  }

  private agentsOf(cwd: string): string[] {
    if (!cwd) return [];
    const now = this.opts.now();
    const hit = this.agentCache.get(cwd);
    if (hit && now - hit.at < AGENTS_TTL_MS) return hit.names;
    let names: string[] = [];
    try {
      names = this.opts.listAgents(cwd);
    } catch {
      names = [];
    }
    this.agentCache.set(cwd, { at: now, names });
    return names;
  }
}
