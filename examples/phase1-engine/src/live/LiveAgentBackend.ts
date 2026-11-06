// Live source: mirrors a real Claude Code session of Tổ giúp việc from its hook payloads.
//
// Nothing here is simulated. Each robot is one agent of the Tổ, and moves only when a hook says that agent is working:
//   Manager      the main session: your prompt, its own tool calls, waiting for you
//   other robots  a subagent (SubagentStart … SubagentStop), matched by its agent file name (subagentRole)
// While a subagent runs, tool calls without an agent of their own are shown on that subagent's robot: the main session
// waits for it. Phases and progress are inferred from who is working, so the UI labels this source "Live · Claude Code".
// With several sessions at once, one focused session drives the robots (see LiveAgentBackend below).
import type { AgentId, AgentState } from "../agents/agentTypes.ts";
import { AGENTS, getAgent } from "../agents/AgentRegistry.ts";
import { AgentController } from "../agents/AgentController.ts";
import { subagentRole } from "../agents/subagentRole.ts";
import type { Action } from "../agents/AgentController.ts";
import type { AgentEvent, AgentEventType, EventSeverity } from "../events/eventTypes.ts";
import type { AgentBackend, CommLink, LiveSessionSummary, SimulationStatus, WorldSnapshot } from "../integrations/AgentBackend.ts";
import { EventBus } from "../simulation/EventBus.ts";
import { SIM_CONFIG } from "../simulation/simulationConfig.ts";
import { isTerminal } from "../simulation/WorkflowStateMachine.ts";
import { LOCATIONS } from "../simulation/worldLayout.ts";
import type { LocationId } from "../simulation/worldLayout.ts";
import { PHASE_STATUS } from "../tasks/taskTypes.ts";
import { slashCommand, typedText } from "./promptText.ts";
import { OrgTracker } from "./orgTracker.ts";
import type { CreateTaskInput, Task, WorkflowPhase } from "../tasks/taskTypes.ts";

/** The subset of Claude Code hook input this source reads. Unknown fields are ignored. */
export interface HookPayload {
  hook_event_name: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  error?: string;
  is_interrupt?: boolean;
  agent_type?: string;
  agent_id?: string;
  source?: string;
  reason?: string;
  message?: string;
}

interface Role {
  phase: WorkflowPhase;
  location: LocationId;
}

const ROLES: Record<AgentId, Role> = {
  orion: { phase: "intake", location: "hub" },
  quinn: { phase: "testing", location: "testing" },
  kai: { phase: "implementation", location: "dev" },
  troly1: { phase: "research", location: "bot1" },
  troly2: { phase: "research", location: "bot2" },
  iris: { phase: "research", location: "research" },
  piper: { phase: "research", location: "product" },
  rex: { phase: "review", location: "review" },
  taichinh: { phase: "implementation", location: "fin" },
  quytrinh: { phase: "implementation", location: "proc" },
  gopy: { phase: "implementation", location: "draft" },
  chuyende: { phase: "research", location: "study" },
  caitien: { phase: "planning", location: "ops" },
};

const READ_TOOLS = /^(Read|Grep|Glob|LS|WebFetch|WebSearch|NotebookRead|ListMcpResources|ReadMcpResource)$/;
const PLAN_TOOLS = /^(TodoWrite|TaskCreate|TaskUpdate|TaskList|EnterPlanMode|ExitPlanMode)$/;
const EDIT_TOOLS = /^(Edit|MultiEdit|Write|NotebookEdit)$/;
const DELEGATE_TOOLS = /^(Agent|Task|Skill|AskUserQuestion)$/;
/** Claude Code's own plumbing (loading tool schemas and the like): not work done for the user, so not shown. */
const IGNORED_TOOLS = /^(ToolSearch)$/;
/** Message prefixes the sound engine listens for (viewer/soundEngine.ts): keep them in sync. */
export const NEEDS_PERMISSION = "Cần anh cấp quyền";
export const NEEDS_YOU = "Claude cần anh";

export interface Classified {
  /** "plan": a todo list or plan mode; "ask": a question to you; "work": everything else. */
  kind: "work" | "plan" | "ask";
  /** Short, factual description of what the session is doing, e.g. "Sửa · Báo cáo.md". */
  label: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function oneLine(s: string, max: number): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function relPath(path: string, cwd: string | undefined): string {
  if (!path) return "";
  // Windows paths come with backslashes; compare and show them with "/".
  const p = path.replaceAll("\\", "/");
  const c = cwd?.replaceAll("\\", "/");
  if (c && p.toLowerCase().startsWith(c.toLowerCase() + "/")) return p.slice(c.length + 1);
  const parts = p.split("/");
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p;
}

/**
 * What a tool call is, in words the office shows; null for plumbing that is not shown. Which robot does it is
 * decided by the session (the Manager, or the subagent that is running), not by the tool. Pure, so it is easy to test.
 */
export function classifyTool(tool: string, input: Record<string, unknown> = {}, cwd?: string): Classified | null {
  if (IGNORED_TOOLS.test(tool)) return null;
  const target = relPath(str(input["file_path"]) || str(input["notebook_path"]) || str(input["path"]), cwd);
  if (tool === "Bash" || tool === "PowerShell") return { kind: "work", label: `Chạy lệnh · ${oneLine(str(input["command"]), 60)}` };
  if (EDIT_TOOLS.test(tool)) return { kind: "work", label: `${tool === "Write" ? "Ghi" : "Sửa"} · ${target || "file"}` };
  if (READ_TOOLS.test(tool)) {
    const what = target || oneLine(str(input["pattern"]) || str(input["query"]) || str(input["url"]), 48);
    const verb = /^Web/.test(tool) ? "Tra trên web" : /^(Grep|Glob|LS)$/.test(tool) ? "Tìm" : "Đọc";
    return { kind: "work", label: what ? `${verb} · ${what}` : verb };
  }
  if (PLAN_TOOLS.test(tool)) return { kind: "plan", label: tool === "TodoWrite" ? "Cập nhật danh sách việc" : "Lập kế hoạch" };
  if (DELEGATE_TOOLS.test(tool)) {
    if (tool === "AskUserQuestion") return { kind: "ask", label: "Hỏi anh một câu" };
    const who = str(input["subagent_type"]) || str(input["skill"]) || "";
    return { kind: "work", label: `${tool === "Skill" ? "Dùng skill" : "Giao việc"}${who ? ` · ${who}` : ""}` };
  }
  if (tool.startsWith("mcp__")) return { kind: "work", label: tool.replace(/^mcp__/, "").replace(/__/g, " · ") };
  return { kind: "work", label: tool };
}

export { subagentRole };

export interface LiveOptions {
  /** Show prompt text in task titles. Off: tasks are titled "Prompt 3". Default true (the server is loopback-only). */
  showPrompts?: boolean;
  /** Wall clock (ms). Session activity, focus hysteresis and expiry use it. */
  now?: () => number;
  /** Tick on a timer. Tests turn this off and call tick() themselves. */
  autoTick?: boolean;
  /** Agent file names in <cwd>/.claude/agents, for the org chart. The server reads the disk; none by default. */
  listAgents?: (cwd: string) => string[];
  /** The work folder the org chart reads agent files from until a hook names one. */
  orgCwd?: string;
}

/** Auto focus leaves a session only after it has been idle (turn ended, or no hook) this long (ms). */
export const FOCUS_IDLE_MS = 8000;
/** Tool calls issued in the same breath as a permission ask do not end the wait (ms). */
const WAIT_GRACE_MS = 2000;
/** Ended sessions leave the session list after this (ms). */
export const ENDED_TTL_MS = 3 * 60_000;
/** Any session with no hook for this long leaves the list (ms): it most likely died without a SessionEnd. */
const QUIET_TTL_MS = 60 * 60_000;
/** The snapshot lists at most this many sessions. */
const MAX_SESSIONS = 12;

type SessionStatus = LiveSessionSummary["status"];

/** Where one robot stands for a session, and what it says it is doing. */
interface Stage {
  location: LocationId;
  status: "working" | "thinking";
  activity: string;
}

/** Everything the live source knows about one Claude Code session, focused or not. */
interface LiveSession {
  id: string;
  cwd: string;
  project: string;
  title: string;
  /** The title came from a typed prompt; later prompts do not rename the session. */
  titled: boolean;
  status: SessionStatus;
  /** Wall-clock ms of the last hook. */
  lastActivity: number;
  waitingSince: number | null;
  taskId: string | null;
  /** The robot that holds the session's attention (the kind of action it is doing now). */
  holder: AgentId | null;
  /** Every robot this session holds and where: the scene to restore when the session gets focus. */
  stage: Map<AgentId, Stage>;
  /** Subagents running now, oldest first: tool calls are shown on the newest one while the Manager waits. */
  subagents: AgentId[];
}

function projectOf(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/**
 * Several Claude Code sessions can run at once (different projects, terminal and web). The robots stand for kinds of
 * action, not for sessions, so only one session drives them: the focused one. Every session keeps its own state
 * (task, phase, which robot holds its attention, waiting or not); when focus moves, the robots re-stage to the new
 * session's state. Events from every session still reach the feed, the sounds and the "needs you" signals.
 */
export class LiveAgentBackend implements AgentBackend {
  readonly kind = "live" as const;
  readonly label = "Live · Claude Code";
  readonly simulated = false;

  private events = new EventBus<AgentEvent>();
  private snapshots = new EventBus<WorldSnapshot>();
  private controllers = new Map<AgentId, AgentController>();
  private holds = new Map<AgentId, number>();
  private releasedAt = new Map<AgentId, number>();
  private holdSeq = 0;
  private tasks = new Map<string, Task>();
  private taskSeq = 0;
  private sessions = new Map<string, LiveSession>();
  private focusId: string | null = null;
  private focusMode: "auto" | "pinned" = "auto";
  /** The session whose hook is being handled: its id and project go into every event's metadata. */
  private ctx: LiveSession | null = null;
  private links: CommLink[] = [];
  private linkSeq = 0;
  private eventSeq = 0;
  private clock = 0;
  private status: SimulationStatus = "running";
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private opts: Required<Omit<LiveOptions, "orgCwd">>;
  private org: OrgTracker;

  constructor(options: LiveOptions = {}) {
    const { orgCwd, ...rest } = options;
    this.opts = { showPrompts: true, now: Date.now, autoTick: true, listAgents: () => [], ...rest };
    this.org = new OrgTracker({
      now: () => this.opts.now(),
      showPrompts: this.opts.showPrompts,
      listAgents: this.opts.listAgents,
      ...(orgCwd ? { cwd: orgCwd } : {}),
    });
    for (const profile of AGENTS) {
      this.controllers.set(profile.id, new AgentController(profile, {
        walkSpeed: SIM_CONFIG.walkSpeed,
        onArrived: (id, location) => this.emit({ type: "agent.arrived", agentId: id, message: `${getAgent(id).name} đến ${LOCATIONS[location].label}`, feed: false, metadata: { location } }),
        positionOf: (id) => this.ctrl(id).state.position,
        faceIfIdle: () => {},
      }));
      this.releasedAt.set(profile.id, 0);
    }
  }

  // ───────────────────────── AgentBackend ─────────────────────────

  async connect(): Promise<void> {
    if (this.timer || !this.opts.autoTick) {
      this.emitReady();
      return;
    }
    this.emitReady();
    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - this.last) / 1000, SIM_CONFIG.maxStepSeconds);
      this.last = now;
      this.tick(dt);
    }, 1000 / SIM_CONFIG.tickHz);
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async start(): Promise<void> { this.setStatus("running", "system.started", "Đang theo dõi"); }
  async resume(): Promise<void> { this.setStatus("running", "system.resumed", "Theo dõi tiếp"); }
  async pause(): Promise<void> { this.setStatus("paused", "system.paused", "Tạm dừng hình (Claude Code vẫn làm việc; sự kiện vẫn được ghi)"); }
  async stop(): Promise<void> { this.setStatus("ready", "system.stopped", "Dừng theo dõi"); }

  async reset(): Promise<void> {
    this.tasks.clear();
    this.sessions.clear();
    this.focusId = null;
    this.focusMode = "auto";
    this.links = [];
    this.taskSeq = this.linkSeq = this.eventSeq = 0;
    this.clock = 0;
    for (const c of this.controllers.values()) c.resetToHome();
    this.emit({ type: "system.reset", message: "Đã xóa màn hình theo dõi" });
    this.publish();
  }

  async setSpeed(multiplier: number): Promise<void> {
    if (multiplier !== 1) throw new Error("The live view runs in real time; speed cannot change.");
  }

  async submitTask(_input: CreateTaskInput): Promise<Task> {
    throw new Error("Live view is read-only: tasks come from prompts you type in Claude Code.");
  }

  async pauseAgent(_id: AgentId): Promise<void> {
    throw new Error("Live view is read-only: it cannot pause a real Claude Code session.");
  }

  async resumeAgent(_id: AgentId): Promise<void> {
    throw new Error("Live view is read-only: it cannot pause a real Claude Code session.");
  }

  /** Pin the robots to one session, or `null` to follow activity again (auto). */
  async focusSession(sessionId: string | null): Promise<void> {
    if (sessionId === null) {
      this.focusMode = "auto";
      // Choosing auto means "show me what is happening now": jump to the most active session without hysteresis.
      const best = this.mostActive();
      if (best) this.setFocus(best);
    } else {
      const s = this.sessions.get(sessionId);
      if (!s) throw new Error("No hooks from that session have reached this server yet, so the robots cannot follow it.");
      this.focusMode = "pinned";
      this.setFocus(s);
    }
    this.publish();
  }

  getSnapshot(): WorldSnapshot {
    return this.snapshot();
  }

  subscribe(listener: (e: AgentEvent) => void): () => void {
    return this.events.subscribe(listener);
  }

  subscribeSnapshot(listener: (s: WorldSnapshot) => void): () => void {
    return this.snapshots.subscribe(listener);
  }

  // ───────────────────────── hook ingestion ─────────────────────────

  ingest(p: HookPayload): void {
    const s = this.touch(p);
    this.ctx = s;
    try {
      // Focus is settled before the hook acts, so a session that just took focus plays this hook out in full.
      const asks = p.hook_event_name === "PermissionRequest" || p.hook_event_name === "Notification";
      this.autoFocus(asks ? s : null);
      const acted = this.handle(s, p);
      const charted = this.org.ingest(p);
      if (acted || charted) this.publish();
    } finally {
      this.ctx = null;
    }
  }

  /** Creates or updates the session a hook belongs to: cwd, activity time and status. */
  private touch(p: HookPayload): LiveSession {
    const id = p.session_id ?? "default";
    const now = this.opts.now();
    let s = this.sessions.get(id);
    if (!s) {
      s = { id, cwd: "", project: "", title: `Session ${id.slice(0, 8)}`, titled: false, status: "idle", lastActivity: now, waitingSince: null, taskId: null, holder: null, stage: new Map(), subagents: [] };
      this.sessions.set(id, s);
    }
    if (p.cwd && p.cwd !== s.cwd) {
      s.cwd = p.cwd;
      s.project = projectOf(p.cwd);
    }
    s.lastActivity = now;
    const before = s.status;
    s.status = this.nextStatus(s, p.hook_event_name, now);
    if (s.status === "waiting" && before !== "waiting") s.waitingSince = now;
    if (before === "waiting" && s.status !== "waiting") {
      s.waitingSince = null;
      // Claude is working again: Orion stops waiting at the hub unless Orion is what the session is doing.
      if (s.holder !== "orion") this.unhold(s, "orion");
    }
    return s;
  }

  private nextStatus(s: LiveSession, hook: string, now: number): SessionStatus {
    switch (hook) {
      case "UserPromptSubmit":
        return "running";
      case "PermissionRequest":
      case "Notification":
        return "waiting";
      case "Stop":
      case "StopFailure":
        return "idle";
      case "SessionEnd":
        return "ended";
      case "SessionStart":
        return s.status === "ended" ? "idle" : s.status;
      case "PreToolUse":
      case "PostToolUse":
      case "PostToolUseFailure":
      case "SubagentStart":
      case "SubagentStop":
      case "PreCompact":
        // Parallel tool calls issued with the ask are not an answer to it.
        if (s.status === "waiting" && s.waitingSince !== null && now - s.waitingSince < WAIT_GRACE_MS) return "waiting";
        return "running";
      case "PermissionDenied":
        return "running";
      default:
        return s.status;
    }
  }

  /** Acts out one hook for its session. Returns false for hooks that change nothing. */
  private handle(s: LiveSession, p: HookPayload): boolean {
    switch (p.hook_event_name) {
      case "SessionStart":
        this.emit({ type: "system.started", message: `Phiên Claude Code bắt đầu${p.cwd ? ` ở ${projectOf(p.cwd)}` : ""}` });
        break;
      case "SessionEnd":
        this.finish(s, "failed", `Phiên đã đóng (${p.reason ?? "exit"}) trước khi Claude xong`);
        s.subagents = [];
        this.emit({ type: "system.stopped", message: `Phiên Claude Code đã đóng (${p.reason ?? "exit"})` });
        for (const id of [...s.stage.keys()]) this.unhold(s, id);
        break;
      case "UserPromptSubmit":
        this.onPrompt(s, p);
        break;
      case "PreToolUse": {
        const c = p.tool_name ? classifyTool(p.tool_name, p.tool_input, p.cwd) : null;
        if (!c) return false;
        // Ticking items off an existing todo list is bookkeeping: update the cards, keep the current robot working.
        if (p.tool_name === "TodoWrite" && !this.onTodos(s, p.tool_input?.["todos"])) break;
        this.onTool(s, c, this.actor(s, p));
        break;
      }
      case "PostToolUse":
        return false; // the robot keeps working until the next call; only failures are worth showing
      case "PostToolUseFailure": {
        const c = p.tool_name ? classifyTool(p.tool_name, p.tool_input, p.cwd) : null;
        if (!c || p.is_interrupt) return false;
        this.onToolFailed(s, c, this.actor(s, p), str(p.error).split("\n")[0] ?? "");
        break;
      }
      case "PermissionRequest": {
        const c = p.tool_name ? classifyTool(p.tool_name, p.tool_input, p.cwd) : null;
        this.hold(s, "orion", "hub", "thinking", `Chờ anh cấp quyền${c ? `: ${c.label}` : ""}`);
        this.emit({ type: "agent.message", agentId: "orion", taskId: this.task(s)?.id, severity: "warning", message: `${NEEDS_PERMISSION}${c ? ` · ${c.label}` : ""}` });
        break;
      }
      case "PermissionDenied": {
        const c = p.tool_name ? classifyTool(p.tool_name, p.tool_input, p.cwd) : null;
        const who = this.actor(s, p);
        if (c) this.emoteFor(s, who, "error", `Không được phép · ${c.label}`);
        this.emit({ type: "agent.message", agentId: who, taskId: this.task(s)?.id, severity: "warning", message: `Không được phép${c ? ` · ${c.label}` : ""}` });
        break;
      }
      case "SubagentStart": {
        const role = subagentRole(p.agent_type ?? "");
        const name = p.agent_type || "general-purpose";
        const task = this.task(s);
        s.subagents.push(role);
        this.linkFor(s, "orion", role, "assign");
        this.emit({ type: "task.assigned", agentId: "orion", targetAgentId: role, taskId: task?.id, message: `Manager giao việc cho ${getAgent(role).name} (${name})` });
        this.hold(s, role, ROLES[role].location, "working", `Đang làm · ${name}`);
        if (task) this.observePhase(task, ROLES[role].phase, role);
        if (s.holder === "orion" || s.holder === null) this.hold(s, "orion", "hub", "thinking", `Chờ ${getAgent(role).name} báo cáo`);
        break;
      }
      case "SubagentStop": {
        const role = subagentRole(p.agent_type ?? "");
        const i = s.subagents.lastIndexOf(role);
        if (i >= 0) s.subagents.splice(i, 1);
        this.linkFor(s, role, "orion", "report");
        this.emit({ type: "agent.message", agentId: role, targetAgentId: "orion", taskId: this.task(s)?.id, message: `${getAgent(role).name} báo cáo xong cho Manager (${p.agent_type || "general-purpose"})` });
        if (!s.subagents.includes(role)) {
          this.unhold(s, role);
          if (s.holder === role) s.holder = null;
        }
        if (s.subagents.length === 0) this.switchTo(s, "orion", "Đọc báo cáo của agent", "thinking");
        break;
      }
      case "Notification":
        this.hold(s, "orion", "hub", "thinking", `Chờ anh${p.message ? `: ${oneLine(p.message, 60)}` : ""}`);
        this.emit({ type: "agent.message", agentId: "orion", taskId: this.task(s)?.id, severity: "warning", message: `${NEEDS_YOU}${p.message ? `: ${oneLine(p.message, 80)}` : ""}` });
        break;
      case "PreCompact":
        this.hold(s, "orion", "hub", "thinking", "Nén lại hội thoại");
        break;
      case "Stop":
        // Stop means the turn ended, not that the work is finished: Claude may be asking a question.
        s.subagents = [];
        this.finish(s, "done", "Xong lượt · chờ anh");
        break;
      case "StopFailure":
        s.subagents = [];
        this.finish(s, "failed", `Claude dừng vì lỗi: ${oneLine(str(p.error), 80)}`);
        break;
      default:
        return false; // unknown or uninteresting event: ignore
    }
    return true;
  }

  private onPrompt(s: LiveSession, p: HookPayload): void {
    const prev = this.task(s);
    if (prev && !isTerminal(prev.phase)) this.finish(s, "failed", "Dừng giữa chừng: anh gửi yêu cầu mới trước khi Claude xong");
    const n = ++this.taskSeq;
    const id = `T-${String(n).padStart(3, "0")}`;
    // What you typed, without the IDE selection or slash-command wrappers Claude Code adds.
    const raw = p.prompt ?? "";
    const text = typedText(raw) || slashCommand(raw) || "";
    const title = this.opts.showPrompts && text ? oneLine(text, 90) : `Prompt ${n}`;
    // The session is named after its first typed prompt (a slash command only until a real prompt arrives).
    if (this.opts.showPrompts && text && (!s.titled || s.title.startsWith("/"))) {
      s.title = oneLine(text, 60);
      s.titled = true;
    }
    const task: Task = {
      id, title,
      description: this.opts.showPrompts ? oneLine(text, 280) : "",
      priority: "medium", status: "assigned", phase: "intake", assignedAgentId: "orion",
      progress: SIM_CONFIG.phaseProgress.intake[0], createdAt: this.clock, updatedAt: this.clock, completedAt: null,
      iteration: 0, subtasks: [], findings: [],
      history: [{ from: "queued", to: "intake", signal: "observed", at: this.clock }],
      isDemo: false, preferredAgentId: null, blockedReason: null,
      origin: { sessionId: s.id, project: s.project },
    };
    this.tasks.set(id, task);
    s.taskId = id;
    this.emit({ type: "task.created", taskId: id, message: `${id}: ${title}` });
    this.switchTo(s, "orion", "Đọc yêu cầu của anh", "thinking");
  }

  /**
   * Who does a tool call: the agent named in the hook (newer Claude Code versions send `agent_type` for calls made
   * inside a subagent), else the newest running subagent, else the Manager. The main session waits while a subagent works.
   */
  private actor(s: LiveSession, p: HookPayload): AgentId {
    if (p.agent_type) return subagentRole(p.agent_type);
    return s.subagents[s.subagents.length - 1] ?? "orion";
  }

  private onTool(s: LiveSession, c: Classified, agent: AgentId): void {
    this.ensureTask(s);
    if (agent === "orion" && c.kind === "ask") {
      this.hold(s, "orion", "hub", "thinking", c.label);
      return;
    }
    if (agent !== "orion") {
      // A subagent's own step: its robot keeps the desk; the Manager stays waiting at the hub.
      this.hold(s, agent, ROLES[agent].location, "working", c.label);
      return;
    }
    this.switchTo(s, "orion", c.label, c.kind === "plan" ? "thinking" : "working");
  }

  /**
   * Claude's own todo list becomes the task cards on the planning board.
   * Returns true when this is planning (a first list, or new items), false for a status update.
   */
  private onTodos(s: LiveSession, todos: unknown): boolean {
    this.ensureTask(s);
    const task = this.task(s);
    if (!task || !Array.isArray(todos)) return true;
    const subtasks = todos
      .filter((t): t is { content?: unknown; status?: unknown } => typeof t === "object" && t !== null)
      .slice(0, 24)
      .map((t, i) => ({ id: `${task.id}.${i + 1}`, title: oneLine(str(t.content), 80), done: t.status === "completed" }));
    const cur = this.tasks.get(task.id)!;
    this.tasks.set(task.id, { ...cur, subtasks, updatedAt: this.clock });
    const known = new Set(cur.subtasks.map((x) => x.title));
    const added = subtasks.filter((x) => !known.has(x.title)).length;
    if (cur.subtasks.length === 0 && subtasks.length > 0) {
      this.emit({ type: "plan.created", agentId: "orion", taskId: task.id, message: `Danh sách ${subtasks.length} bước việc`, metadata: { subtasks: subtasks.map((x) => x.title) } });
      return true;
    }
    return added > 0;
  }

  private onToolFailed(s: LiveSession, c: Classified, agent: AgentId, error: string): void {
    this.emoteFor(s, agent, "error", `✗ ${c.label}`);
    this.emit({ type: "agent.message", agentId: agent, taskId: this.task(s)?.id, severity: "warning", message: `Lỗi · ${c.label}${error ? ` (${oneLine(error, 80)})` : ""}` });
  }

  /** Hand the session's attention to `agent`: the previous holder is released, a link shows the handoff. */
  private switchTo(s: LiveSession, agent: AgentId, activity: string, status: "working" | "thinking"): void {
    const prev = s.holder;
    const task = this.task(s);
    if (prev && prev !== agent) {
      this.unhold(s, prev);
      this.linkFor(s, prev, agent, prev === "orion" ? "assign" : "message");
      this.emit({ type: "agent.message", agentId: prev, targetAgentId: agent, taskId: task?.id, message: activity });
    }
    s.holder = agent;
    this.hold(s, agent, ROLES[agent].location, status, activity);
    if (task && agent !== "orion") this.observePhase(task, ROLES[agent].phase, agent);
  }

  private observePhase(task: Task, phase: WorkflowPhase, agent: AgentId): void {
    const cur = this.tasks.get(task.id)!;
    if (isTerminal(cur.phase)) return;
    const next: Task = { ...cur, assignedAgentId: agent, updatedAt: this.clock };
    if (cur.phase !== phase) {
      next.phase = phase;
      next.status = PHASE_STATUS[phase];
      next.progress = Math.max(cur.progress, SIM_CONFIG.phaseProgress[phase][0]);
      next.history = [...cur.history, { from: cur.phase, to: phase, signal: "observed", at: this.clock }];
      if (phase === "implementation") {
        next.iteration = cur.iteration + 1;
        this.emit({ type: "implementation.started", agentId: agent, taskId: task.id, message: `Làm lần ${next.iteration}`, feed: false, metadata: { iteration: next.iteration } });
      }
      this.emit({ type: "task.status_changed", taskId: task.id, agentId: agent, message: `${task.id}: ${cur.phase} → ${phase}`, feed: false, metadata: { from: cur.phase, to: phase, signal: "observed" } });
    }
    this.tasks.set(task.id, next);
  }

  private bump(task: Task): void {
    const cur = this.tasks.get(task.id)!;
    this.tasks.set(task.id, { ...cur, updatedAt: this.clock });
  }

  private finish(s: LiveSession, outcome: "done" | "failed", message: string): void {
    const task = this.task(s);
    const holder = s.holder;
    if (holder) this.unhold(s, holder);
    s.holder = null;
    // Orion's announcement below replaces any wait at the hub.
    s.stage.delete("orion");
    if (!task || isTerminal(task.phase)) return;
    const done: Task = {
      ...task,
      phase: outcome,
      status: PHASE_STATUS[outcome],
      progress: outcome === "done" ? 1 : task.progress,
      assignedAgentId: null,
      completedAt: this.clock,
      updatedAt: this.clock,
      history: [...task.history, { from: task.phase, to: outcome, signal: "observed", at: this.clock }],
    };
    this.tasks.set(task.id, done);
    if (holder && holder !== "orion") this.linkFor(s, holder, "orion", "report");
    if (outcome === "done") {
      this.actFor(s, "orion", [
        { kind: "move", to: "hub", activity: "Về bàn Manager" },
        { kind: "emote", status: "success", duration: SIM_CONFIG.durations.announce, activity: `${task.id} xong` },
      ]);
      this.emit({ type: "task.completed", agentId: "orion", taskId: task.id, severity: "success", message: `${task.id} · ${message}` });
    } else {
      this.emoteFor(s, "orion", "error", `${task.id} dừng`);
      this.emit({ type: "task.failed", agentId: "orion", taskId: task.id, severity: "error", message: `${task.id} · ${message}` });
    }
  }

  /** A tool call can arrive with no prompt first (hooks enabled mid-session). Open a task so it has a home. */
  private ensureTask(s: LiveSession): void {
    const t = this.task(s);
    if (t && !isTerminal(t.phase)) return;
    this.onPrompt(s, { hook_event_name: "UserPromptSubmit", prompt: "" });
  }

  private task(s: LiveSession): Task | undefined {
    return s.taskId ? this.tasks.get(s.taskId) : undefined;
  }

  // ───────────────────────── focus ─────────────────────────

  /**
   * Auto focus: follow the most recently active session, with hysteresis. Focus moves only when the focused session
   * has been idle (turn ended, or no hook) for FOCUS_IDLE_MS, or has ended, and then only to a session that is
   * running or waiting. A session that starts waiting for you (`stealer`) takes focus at once. Pinned focus stays
   * until you pick another session or auto, or until the pinned session drops out of the list.
   */
  private autoFocus(stealer: LiveSession | null = null): void {
    if (this.focusMode === "pinned") {
      if (this.focusId && this.sessions.has(this.focusId)) return;
      this.focusMode = "auto";
    }
    if (stealer) return this.setFocus(stealer);
    const cur = this.focusId ? this.sessions.get(this.focusId) : undefined;
    if (!cur) return this.setFocus(this.mostActive());
    if (cur.status === "waiting") return;
    const ended = cur.status === "ended";
    if (!ended && this.opts.now() - cur.lastActivity < FOCUS_IDLE_MS) return;
    const next = this.mostActive(cur, ended ? ["waiting", "running", "idle"] : ["waiting", "running"]);
    if (next) this.setFocus(next);
  }

  /** The session to follow: waiting first, then running, then idle; newest activity within each. */
  private mostActive(except?: LiveSession, statuses: SessionStatus[] = ["waiting", "running", "idle"]): LiveSession | null {
    let best: LiveSession | null = null;
    for (const s of this.sessions.values()) {
      if (s === except || !statuses.includes(s.status)) continue;
      if (!best) best = s;
      else {
        const rank = statuses.indexOf(s.status) - statuses.indexOf(best.status);
        if (rank < 0 || (rank === 0 && s.lastActivity > best.lastActivity)) best = s;
      }
    }
    return best;
  }

  /** Move focus and re-stage the robots: the new session's holders go to their stations, everyone else goes home. */
  private setFocus(next: LiveSession | null): void {
    const id = next?.id ?? null;
    if (id === this.focusId) return;
    this.focusId = id;
    for (const profile of AGENTS) {
      const stage = next?.stage.get(profile.id);
      if (stage) {
        this.holdAt(profile.id, stage.location, stage.status, stage.activity);
        continue;
      }
      const c = this.ctrl(profile.id);
      this.release(profile.id);
      if (c.busy) c.clear();
      // Head home on the next tick instead of after the usual pause: this robot belonged to another story.
      this.releasedAt.set(profile.id, this.clock - SIM_CONFIG.returnHomeDelay);
    }
    // Arcs in flight belong to the previous session's story.
    this.links = [];
  }

  /** Ended sessions leave after ENDED_TTL_MS, silent ones after QUIET_TTL_MS; at most MAX_SESSIONS are kept. */
  private prune(): void {
    const now = this.opts.now();
    for (const [id, s] of this.sessions) {
      const age = now - s.lastActivity;
      if ((s.status === "ended" && age > ENDED_TTL_MS) || age > QUIET_TTL_MS) this.sessions.delete(id);
    }
    if (this.sessions.size > MAX_SESSIONS) {
      const old = [...this.sessions.values()].filter((s) => s.id !== this.focusId).sort((a, b) => a.lastActivity - b.lastActivity);
      for (const s of old.slice(0, this.sessions.size - MAX_SESSIONS)) this.sessions.delete(s.id);
    }
  }

  // ───────────────────────── motion (only the focused session moves robots) ─────────────────────────

  private focused(s: LiveSession): boolean {
    return this.focusId === s.id;
  }

  private hold(s: LiveSession, agent: AgentId, location: LocationId, status: "working" | "thinking", activity: string): void {
    s.stage.set(agent, { location, status, activity });
    if (this.focused(s)) this.holdAt(agent, location, status, activity);
  }

  private unhold(s: LiveSession, agent: AgentId): void {
    const had = s.stage.delete(agent);
    if (had && this.focused(s)) this.release(agent);
  }

  private emoteFor(s: LiveSession, agent: AgentId, status: "success" | "error", activity: string): void {
    if (this.focused(s)) this.emote(agent, status, activity);
  }

  private actFor(s: LiveSession, agent: AgentId, actions: Action[]): void {
    if (this.focused(s)) this.act(agent, actions);
  }

  private linkFor(s: LiveSession, from: AgentId, to: AgentId, kind: CommLink["kind"]): void {
    if (this.focused(s)) this.link(from, to, kind);
  }

  private holdAt(agent: AgentId, location: LocationId, status: "working" | "thinking", activity: string): void {
    const token = ++this.holdSeq;
    this.holds.set(agent, token);
    const c = this.ctrl(agent);
    // Already holding at the right place: just update what it says it is doing.
    if (c.state.location === location && c.state.path.length === 0 && c.busy) {
      c.clear();
    } else {
      c.clear();
      c.enqueue({ kind: "move", to: location, activity: `Đến ${LOCATIONS[location].label}` });
    }
    c.enqueue({ kind: "wait", until: () => this.holds.get(agent) !== token, timeout: Number.MAX_SAFE_INTEGER, status, activity });
    // Start it now, so the snapshot published for this hook already shows the new activity (no one-frame "Idle").
    c.step(0);
  }

  private act(agent: AgentId, actions: Action[]): void {
    this.holds.set(agent, ++this.holdSeq);
    const c = this.ctrl(agent);
    c.clear();
    c.enqueue(...actions);
    c.step(0);
    this.releasedAt.set(agent, this.clock);
  }

  private emote(agent: AgentId, status: "success" | "error", activity: string): void {
    const c = this.ctrl(agent);
    const token = this.holds.get(agent);
    const holding = c.busy;
    const duration = status === "error" ? SIM_CONFIG.durations.errorEmote : SIM_CONFIG.durations.celebrate;
    const keep = c.state.activity;
    const keepStatus = c.state.status === "thinking" ? "thinking" : "working";
    c.clear();
    c.enqueue({ kind: "emote", status, duration, activity });
    // Go back to holding if this agent still has the session's attention.
    if (holding && token !== undefined) c.enqueue({ kind: "wait", until: () => this.holds.get(agent) !== token, timeout: Number.MAX_SAFE_INTEGER, status: keepStatus, activity: keep });
    c.step(0);
  }

  private release(agent: AgentId): void {
    this.holds.set(agent, ++this.holdSeq);
    this.ctrl(agent).step(0);
    this.releasedAt.set(agent, this.clock);
  }

  private link(from: AgentId, to: AgentId, kind: CommLink["kind"]): void {
    if (from === to) return;
    this.links.push({ id: `L-${++this.linkSeq}`, from, to, kind, startedAt: this.clock, endsAt: this.clock + SIM_CONFIG.linkDuration });
  }

  tick(dt: number): void {
    if (this.status !== "running") return;
    this.clock += dt;
    this.prune();
    this.autoFocus();
    for (const profile of AGENTS) {
      const c = this.ctrl(profile.id);
      c.step(dt);
      // Idle and away from home: walk back after a short pause.
      if (!c.busy && c.state.location !== profile.home && this.clock - this.releasedAt.get(profile.id)! >= SIM_CONFIG.returnHomeDelay) {
        c.enqueue({ kind: "move", to: profile.home, activity: "Về bàn làm việc" });
      }
    }
    this.links = this.links.filter((l) => l.endsAt > this.clock);
    this.publish();
  }

  // ───────────────────────── plumbing ─────────────────────────

  /** Which session the robots follow (tests and the server log). */
  get focus(): { sessionId: string | null; mode: "auto" | "pinned" } {
    return { sessionId: this.focusId, mode: this.focusMode };
  }

  snapshot(): WorldSnapshot {
    const sessions: LiveSessionSummary[] = [...this.sessions.values()]
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .map((s) => ({ sessionId: s.id, title: s.title, project: s.project, status: s.status, lastActivity: s.lastActivity }));
    return structuredClone({
      clock: this.clock,
      status: this.status,
      speed: 1,
      agents: AGENTS.map((a) => this.ctrl(a.id).state) as AgentState[],
      tasks: [...this.tasks.values()],
      links: this.links,
      live: { focus: { sessionId: this.focusId, mode: this.focusMode }, sessions },
      org: this.org.state(sessions),
    });
  }

  private emitReady(): void {
    this.emit({ type: "system.ready", message: "Văn phòng sẵn sàng · chờ tín hiệu từ Claude Code" });
    this.publish();
  }

  private setStatus(status: SimulationStatus, type: AgentEventType, message: string): void {
    if (this.status === status) return;
    this.status = status;
    this.emit({ type, message });
    this.publish();
  }

  private ctrl(id: AgentId): AgentController {
    return this.controllers.get(id)!;
  }

  private emit(e: { type: AgentEventType; message: string; agentId?: AgentId; targetAgentId?: AgentId; taskId?: string; severity?: EventSeverity; feed?: boolean; metadata?: Record<string, unknown> }): void {
    // Every event a hook causes says which session (and project) it belongs to, so the feed, the task cards and
    // the "needs you" signals can name it whether or not that session is the one the robots follow.
    const s = this.ctx;
    const metadata = s ? { session: s.id, project: s.project, sessionTitle: s.title, ...e.metadata } : e.metadata;
    const event: AgentEvent = { ...e, ...(metadata ? { metadata } : {}), id: `E-${++this.eventSeq}`, timestamp: this.opts.now(), simTime: this.clock, severity: e.severity ?? "info", feed: e.feed ?? true };
    for (const k of ["agentId", "targetAgentId", "taskId"] as const) if (event[k] === undefined) delete event[k];
    this.events.emit(event);
  }

  private publish(): void {
    if (this.snapshots.size > 0) this.snapshots.emit(this.snapshot());
  }
}
