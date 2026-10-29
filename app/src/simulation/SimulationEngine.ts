import type { AgentId, AgentState, CarryKind } from "../agents/agentTypes.ts";
import { AGENTS, PHASE_OWNER, getAgent } from "../agents/AgentRegistry.ts";
import { AgentController } from "../agents/AgentController.ts";
import type { Action } from "../agents/AgentController.ts";
import type { AgentEvent, AgentEventType, EventSeverity } from "../events/eventTypes.ts";
import type { CommLink, SimulationStatus, WorldSnapshot } from "../integrations/AgentBackend.ts";
import { PHASE_STATUS } from "../tasks/taskTypes.ts";
import type { CreateTaskInput, Task, WorkflowPhase, WorkflowSignal } from "../tasks/taskTypes.ts";
import { EventBus, createRng, hashString, rngRange } from "./EventBus.ts";
import { SIM_CONFIG } from "./simulationConfig.ts";
import { compareWork, pickNextTask } from "./TaskScheduler.ts";
import { applySignal, isTerminal } from "./WorkflowStateMachine.ts";
import { shortTitle, templateFor } from "./workContent.ts";
import { LOCATIONS } from "./worldLayout.ts";
import type { LocationId } from "./worldLayout.ts";

/**
 * Việc phụ quanh một bước chính: dự họp giao việc, trợ lý lấy tài liệu ở Kho, Thủ thư / Số hóa giao tài liệu,
 * trợ lý phụ soạn báo cáo, trợ lý đưa báo cáo sang QA. Chỉ người phụ trách bước chính mới chuyển bước.
 */
type SideKind = "attend" | "fetch" | "serve" | "help" | "deliver";

/** One unit of work an agent owes a task: "do the <phase> step of <task>", or a side job (`side`) around it. */
interface Job {
  taskId: string;
  phase: WorkflowPhase;
  side?: SideKind;
}

type EmitInput = Omit<AgentEvent, "id" | "timestamp" | "simTime" | "severity" | "feed"> & {
  severity?: EventSeverity;
  feed?: boolean;
};

/** Agent chưa giao nhiệm vụ đi dạo nhiều nơi; agent đang làm thỉnh thoảng ra Góc giải lao. */
const AMBIENT_SPOTS_FREE: LocationId[] = ["lounge"];
const AMBIENT_SPOTS_BUSY: LocationId[] = ["lounge"];
/** An toàn: không chờ ai quá lâu (giây mô phỏng), để không bao giờ kẹt cứng. */
const WAIT_LIMIT = 240;

export class SimulationEngine {
  readonly events = new EventBus<AgentEvent>();
  readonly snapshots = new EventBus<WorldSnapshot>();

  private clock = 0;
  private status: SimulationStatus = "ready";
  private speed: number = SIM_CONFIG.defaultSpeed;
  private rng = createRng(SIM_CONFIG.seed);
  private tasks = new Map<string, Task>();
  private taskSeq = new Map<string, number>();
  private taskRng = new Map<string, () => number>();
  private nextTaskSeq = 0;
  private links: CommLink[] = [];
  private linkSeq = 0;
  private eventSeq = 0;
  private log: AgentEvent[] = [];
  private controllers = new Map<AgentId, AgentController>();
  private jobs = new Map<AgentId, Job[]>();
  private currentJob = new Map<AgentId, Job | null>();
  private idleSince = new Map<AgentId, number>();
  private nextAmbientAt = new Map<AgentId, number>();
  /** Cờ phối hợp giữa các agent trong một vụ việc, ví dụ `T-001:arr:kai`. */
  private flags = new Set<string>();
  private now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    for (const profile of AGENTS) {
      this.controllers.set(
        profile.id,
        new AgentController(profile, {
          walkSpeed: SIM_CONFIG.walkSpeed,
          onArrived: (id, location) => this.onArrived(id, location),
          positionOf: (id) => this.ctrl(id).state.position,
          faceIfIdle: (listener, speaker) => {
            const c = this.ctrl(listener);
            if (!c.isIdleStill || c.state.paused) return;
            const p = c.state.position;
            const s = this.ctrl(speaker).state.position;
            c.state.heading = Math.atan2(s.x - p.x, s.z - p.z);
          },
        }),
      );
    }
    this.resetAgents();
  }

  // ───────────────────────── commands ─────────────────────────

  start(): void {
    if (this.status === "paused") return this.resume();
    if (this.status === "running") return;
    this.status = "running";
    this.emit({ type: "system.started", message: "Bắt đầu mô phỏng" });
    this.publish();
  }

  /** Halt ticking and return to `ready` without clearing anything; `start()` continues from the same clock. */
  stop(): void {
    if (this.status === "ready") return;
    this.status = "ready";
    this.emit({ type: "system.stopped", message: "Simulation stopped", feed: false });
    this.publish();
  }

  pause(): void {
    if (this.status !== "running") return;
    this.status = "paused";
    this.emit({ type: "system.paused", message: "Simulation paused", severity: "warning" });
    this.publish();
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.status = "running";
    this.emit({ type: "system.resumed", message: "Simulation resumed" });
    this.publish();
  }

  reset(): void {
    this.clock = 0;
    this.status = "ready";
    this.speed = SIM_CONFIG.defaultSpeed;
    this.rng = createRng(SIM_CONFIG.seed);
    this.tasks.clear();
    this.taskSeq.clear();
    this.taskRng.clear();
    this.nextTaskSeq = 0;
    this.links = [];
    this.linkSeq = 0;
    this.eventSeq = 0;
    this.log = [];
    this.flags.clear();
    this.resetAgents();
    this.emit({ type: "system.reset", message: "World reset" });
    this.publish();
  }

  setSpeed(multiplier: number): void {
    if (!(SIM_CONFIG.speeds as readonly number[]).includes(multiplier)) {
      throw new Error(`Unsupported speed ${multiplier}; use one of ${SIM_CONFIG.speeds.join(", ")}`);
    }
    if (multiplier === this.speed) return;
    this.speed = multiplier;
    this.emit({ type: "system.speed_changed", message: `Speed set to ${multiplier}×`, metadata: { speed: multiplier }, feed: false });
    this.publish();
  }

  submitTask(input: CreateTaskInput): Task {
    const seq = ++this.nextTaskSeq;
    const id = `T-${String(seq).padStart(3, "0")}`;
    const task: Task = {
      id,
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "medium",
      status: "queued",
      phase: "queued",
      assignedAgentId: null,
      progress: 0,
      createdAt: this.clock,
      updatedAt: this.clock,
      completedAt: null,
      iteration: 0,
      subtasks: [],
      findings: [],
      history: [],
      isDemo: input.isDemo ?? false,
      preferredAgentId: input.preferredAgentId ?? null,
      blockedReason: null,
      ...(input.script ? { script: structuredClone(input.script) } : {}),
    };
    this.tasks.set(id, task);
    this.taskSeq.set(id, seq);
    this.taskRng.set(id, createRng(hashString(task.title) ^ SIM_CONFIG.seed ^ seq));
    const via = task.preferredAgentId ? ` (giao cho ${getAgent(task.preferredAgentId).name}, qua Manager)` : "";
    this.emit({ type: "task.created", taskId: id, message: `${id} được tạo: ${shortTitle(task.title)}${via}`, metadata: { priority: task.priority } });
    this.publish();
    return structuredClone(task);
  }

  pauseAgent(id: AgentId): void {
    const c = this.ctrl(id);
    if (c.state.paused) return;
    c.state.paused = true;
    const name = getAgent(id).name;
    this.emit({ type: "agent.paused", agentId: id, message: `${name} paused`, severity: "warning" });
    for (const t of this.tasks.values()) {
      if (t.assignedAgentId === id && !isTerminal(t.phase)) this.block(t, `${name} is paused`);
    }
    this.publish();
  }

  resumeAgent(id: AgentId): void {
    const c = this.ctrl(id);
    if (!c.state.paused) return;
    c.state.paused = false;
    const name = getAgent(id).name;
    for (const t of this.tasks.values()) {
      if (t.assignedAgentId === id && t.status === "blocked") {
        this.put({ ...t, status: PHASE_STATUS[t.phase], blockedReason: null, updatedAt: this.clock });
        this.emit({ type: "task.unblocked", agentId: id, taskId: t.id, message: `${t.id} unblocked: ${name} is back` });
      }
    }
    this.emit({ type: "agent.resumed", agentId: id, message: `${name} resumed` });
    this.publish();
  }

  // ───────────────────────── reads ─────────────────────────

  getTask(id: string): Task | undefined {
    const t = this.tasks.get(id);
    return t ? structuredClone(t) : undefined;
  }

  getStatus(): SimulationStatus {
    return this.status;
  }

  getClock(): number {
    return this.clock;
  }

  eventLog(): readonly AgentEvent[] {
    return this.log;
  }

  snapshot(): WorldSnapshot {
    return structuredClone({
      clock: this.clock,
      status: this.status,
      speed: this.speed,
      agents: AGENTS.map((a) => this.ctrl(a.id).state),
      tasks: [...this.tasks.values()],
      links: this.links,
    });
  }

  emitBootEvents(): void {
    this.emit({ type: "system.ready", message: "Tổ giúp việc sẵn sàng · chế độ mô phỏng, không gọi AI" });
    for (const a of AGENTS) {
      this.emit({ type: "agent.arrived", agentId: a.id, message: `${a.name} đang ở ${LOCATIONS[a.home].label}`, metadata: { location: a.home, boot: true } });
    }
  }

  // ───────────────────────── tick ─────────────────────────

  tick(realDtSeconds: number): void {
    if (this.status !== "running") return;
    const dt = realDtSeconds * this.speed;
    this.clock += dt;

    for (let t = pickNextTask([...this.tasks.values()], (x) => this.seqOf(x), SIM_CONFIG.maxConcurrentTasks); t; t = pickNextTask([...this.tasks.values()], (x) => this.seqOf(x), SIM_CONFIG.maxConcurrentTasks)) {
      this.transition(t.id, "picked_up");
    }

    for (const a of AGENTS) {
      this.dispatch(a.id);
      this.ctrl(a.id).step(dt);
    }

    this.links = this.links.filter((l) => l.endsAt > this.clock);
    this.publish();
  }

  // ───────────────────────── scheduling ─────────────────────────

  /**
   * Per-agent job queue: an agent does one job at a time, picks the best by (priority, createdAt, seq),
   * never preempts a running job, and drops ambient behaviour the moment a job is waiting.
   */
  private dispatch(id: AgentId): void {
    const c = this.ctrl(id);
    if (c.state.paused) return;
    if (this.currentJob.get(id)) return;
    const queue = this.jobs.get(id)!;
    if (queue.length > 0 && c.onlyAmbient) {
      queue.sort((a, b) => this.compareJobs(a, b));
      const job = queue.shift()!;
      c.interruptAmbient();
      this.currentJob.set(id, job);
      c.state.currentTaskId = job.taskId;
      c.enqueue(...(job.side ? this.buildSideJob(id, job) : this.buildJob(id, job)), { kind: "call", fn: () => this.finishJob(id) });
      return;
    }
    if (!c.busy) this.idleBehaviour(id);
  }

  private compareJobs(a: Job, b: Job): number {
    const ta = this.tasks.get(a.taskId)!;
    const tb = this.tasks.get(b.taskId)!;
    return compareWork({ ...ta, seq: this.seqOf(ta) }, { ...tb, seq: this.seqOf(tb) });
  }

  private finishJob(id: AgentId): void {
    this.currentJob.set(id, null);
    this.ctrl(id).state.currentTaskId = null;
    this.idleSince.set(id, this.clock);
    this.nextAmbientAt.set(id, Math.max(this.nextAmbientAt.get(id)!, this.clock + SIM_CONFIG.ambient.minGap));
  }

  private idleBehaviour(id: AgentId): void {
    const c = this.ctrl(id);
    const profile = getAgent(id);
    const home = profile.home;
    if (c.state.location !== home) {
      if (this.clock - this.idleSince.get(id)! >= SIM_CONFIG.returnHomeDelay) {
        c.enqueue({ kind: "move", to: home, activity: "Về bàn làm việc", ambient: true });
      }
      return;
    }
    const idleText = profile.active ? "Sẵn sàng nhận việc" : "Chưa giao nhiệm vụ";
    if (this.clock < this.nextAmbientAt.get(id)!) {
      c.enqueue({ kind: "wait", until: () => false, timeout: this.nextAmbientAt.get(id)! - this.clock, activity: idleText, ambient: true });
      return;
    }
    const cfg = profile.active ? SIM_CONFIG.ambient : SIM_CONFIG.ambientFree;
    const spots = profile.active ? AMBIENT_SPOTS_BUSY : AMBIENT_SPOTS_FREE;
    const spot = spots[Math.floor(this.rng() * spots.length)]!;
    const stay = rngRange(this.rng, cfg.minStay, cfg.maxStay);
    this.nextAmbientAt.set(id, this.clock + rngRange(this.rng, cfg.minGap, cfg.maxGap));
    const label = LOCATIONS[spot].label;
    const doing = spot === "view" ? "Ngắm phố qua cửa kính" : "Ngồi uống cà phê ở Góc giải lao";
    c.enqueue(
      { kind: "move", to: spot, slot: profile.seat, activity: profile.active ? `Ra ${label} nghỉ một lát` : `Ra ${label} ngồi (chưa giao nhiệm vụ)`, ambient: true },
      { kind: "call", fn: () => this.emit({ type: "agent.ambient", agentId: id, message: `${profile.name} đang ở ${label}`, feed: false, metadata: { location: spot } }), ambient: true },
      { kind: "wait", until: () => false, timeout: stay, activity: doing, ambient: true },
      { kind: "move", to: home, activity: "Về bàn làm việc", ambient: true },
    );
  }

  // ───────────────────────── coordination ─────────────────────────

  private flagKey(taskId: string, name: string): string {
    return `${taskId}:${name}`;
  }

  private setFlag(taskId: string, name: string): void {
    this.flags.add(this.flagKey(taskId, name));
  }

  private hasFlag(taskId: string, name: string): boolean {
    return this.flags.has(this.flagKey(taskId, name));
  }

  /** Queue a side job; it runs through the same per-agent queue as phase jobs. */
  private side(agent: AgentId, taskId: string, side: SideKind): void {
    const task = this.tasks.get(taskId)!;
    this.jobs.get(agent)!.push({ taskId, phase: task.phase, side });
  }

  private carry(id: AgentId, what: CarryKind | null): Action {
    return { kind: "call", fn: () => (this.ctrl(id).state.carrying = what) };
  }

  /** Trợ lý ra Kho lấy tài nguyên nghiên cứu rồi mang về cạnh bàn KT XDCB. */
  private fetchActions(id: AgentId, task: Task, what: "docs" | "records"): Action[] {
    const docs = what === "docs";
    const counter: AgentId = docs ? "iris" : "piper";
    const counterName = getAgent(counter).name;
    const label = docs ? "văn bản" : "hồ sơ cũ";
    return [
      { kind: "move", to: docs ? "kho_vb" : "kho_hs", activity: `Ra Kho lưu trữ lấy ${label} cho ${task.id}` },
      { kind: "call", fn: () => this.setFlag(task.id, `at:${id}`) },
      { kind: "wait", until: () => this.hasFlag(task.id, `handed:${id}`), timeout: WAIT_LIMIT, activity: `Chờ ${counterName} giao ${label}` },
      this.carry(id, what),
      { kind: "move", to: "dev_help", slot: docs ? 1 : 0, activity: `Mang ${label} về cho KT XDCB` },
      this.talk(id, "kai", SIM_CONFIG.durations.publish, "message", `Nộp ${label} cho KT XDCB`),
      this.carry(id, null),
      {
        kind: "call",
        fn: () => {
          this.message(id, "kai", task.id, docs ? "Đã có văn bản còn hiệu lực tại ngày thủ tục, kèm điều khoản liên quan" : "Đã có hồ sơ cũ và phát hiện trước đây của vụ việc tương tự");
          this.setFlag(task.id, `back:${id}`);
        },
      },
    ];
  }

  private buildSideJob(id: AgentId, job: Job): Action[] {
    const task = this.tasks.get(job.taskId)!;
    const d = SIM_CONFIG.durations;
    const short = shortTitle(task.title);
    switch (job.side) {
      case "attend": {
        const seat = id === "quinn" ? 2 : 1;
        return [
          { kind: "move", to: "collab", slot: seat, activity: `Vào Phòng họp: họp giao việc ${task.id}` },
          { kind: "call", fn: () => this.setFlag(task.id, `arr:${id}`) },
          { kind: "wait", until: () => this.hasFlag(task.id, "meet_done"), timeout: WAIT_LIMIT, status: "thinking", activity: id === "quinn" ? `Thống nhất tiêu chí nghiệm thu ${task.id}` : `Nhận việc ${task.id}: ${short}` },
        ];
      }
      case "fetch":
        return this.fetchActions(id, task, "records");
      case "serve": {
        const bot: AgentId = id === "iris" ? "troly1" : "troly2";
        const what = id === "iris" ? "văn bản còn hiệu lực" : "hồ sơ cũ đã số hóa";
        return [
          { kind: "move", to: getAgent(id).home, activity: "Về bàn làm việc" },
          { kind: "work", duration: d.research, status: "working", activity: `Tìm ${what} cho ${task.id}` },
          { kind: "wait", until: () => this.hasFlag(task.id, `at:${bot}`), timeout: WAIT_LIMIT, activity: `Chờ ${getAgent(bot).name} đến nhận` },
          this.talk(id, bot, d.publish, "message", `Giao ${what} cho ${getAgent(bot).name}`),
          {
            kind: "call",
            fn: () => {
              this.setFlag(task.id, `handed:${bot}`);
              this.emit({ type: "agent.message", agentId: id, targetAgentId: bot, taskId: task.id, message: `${getAgent(id).name} giao ${what} cho ${getAgent(bot).name}` });
            },
          },
        ];
      }
      case "help": {
        const first = task.iteration <= 1;
        const doing = id === "troly1" ? "Đối chiếu điều khoản, ghi số hiệu văn bản" : "Lập bảng dữ kiện, ghi số trang hồ sơ";
        return [
          { kind: "move", to: getAgent(id).home, activity: "Về bàn làm việc" },
          { kind: "work", duration: first ? d.implement * 0.8 : d.fix * 0.8, status: "working", activity: `${doing} (${task.id})` },
        ];
      }
      case "deliver": {
        const iteration = task.iteration;
        return [
          { kind: "move", to: "dev_help", slot: 1, activity: `Nhận báo cáo lần ${iteration} từ KT XDCB` },
          this.carry(id, "report"),
          { kind: "move", to: "qa_in", activity: `Đưa báo cáo lần ${iteration} sang Phòng QA` },
          this.talk(id, "quinn", d.submit, "message", "Giao báo cáo cho QA"),
          this.carry(id, null),
          {
            kind: "call",
            fn: () => {
              this.message(id, "quinn", task.id, `Báo cáo lần ${iteration} của ${task.id} kèm Báo cáo ngược`);
              this.setFlag(task.id, `delivered:${iteration}`);
            },
          },
        ];
      }
      default:
        throw new Error(`No side job ${String(job.side)}`);
    }
  }

  // ───────────────────────── choreography ─────────────────────────

  private buildJob(id: AgentId, job: Job): Action[] {
    const t = () => this.tasks.get(job.taskId)!;
    const task = t();
    const d = SIM_CONFIG.durations;
    const tpl = templateFor(task.title, task.description);
    const short = shortTitle(task.title);
    const at = (loc: LocationId, slot?: number): Action => ({ kind: "move", to: loc, ...(slot === undefined ? {} : { slot }), activity: `Đến ${LOCATIONS[loc].label}` });
    const call = (fn: () => void): Action => ({ kind: "call", fn });
    const progress = (f: number) => {
      const [a, b] = SIM_CONFIG.phaseProgress[t().phase];
      const cur = t();
      this.put({ ...cur, progress: Math.max(cur.progress, a + (b - a) * f), updatedAt: this.clock });
    };

    switch (job.phase) {
      case "intake":
        // Anh Việt gõ lệnh giao việc: Manager đọc yêu cầu, gọi trưởng phòng và QA vào Phòng họp.
        return [
          at("hub"),
          { kind: "work", duration: d.intakeThink, status: "thinking", activity: `Nhận việc từ anh Việt: ${short}`, onProgress: progress },
          call(() => {
            this.side("kai", task.id, "attend");
            this.side("quinn", task.id, "attend");
            this.emit({ type: "agent.message", agentId: id, targetAgentId: "kai", taskId: task.id, message: `Manager mời KT XDCB và QA vào Phòng họp giao việc ${task.id}` });
          }),
          at("collab", 0),
          { kind: "wait", until: () => this.hasFlag(task.id, "arr:kai") && this.hasFlag(task.id, "arr:quinn"), timeout: WAIT_LIMIT, activity: "Chờ trưởng phòng và QA vào họp" },
          // Cuộc họp là lúc các agent đang chạy sau khi anh Việt gõ lệnh; kéo dài vừa đủ để nhìn thấy.
          this.talk(id, "kai", d.meeting, "assign", `Giao việc ${task.id}: phạm vi, thời hạn, sản phẩm`),
          this.talk(id, "quinn", d.meeting, "assign", "Thống nhất tiêu chí nghiệm thu với QA"),
          call(() => {
            this.setFlag(task.id, "meet_done");
            this.emit({ type: "task.assigned", agentId: id, targetAgentId: "kai", taskId: task.id, message: `Manager giao ${task.id} cho KT XDCB (QA dự họp): ${short}` });
            this.transition(task.id, "delegated");
          }),
        ];

      case "planning":
        return [
          at("planning"),
          { kind: "work", duration: d.breakdown, status: "working", activity: `Lập kế hoạch kiểm tra ${task.id}`, onProgress: progress },
          call(() => {
            const subtasks = tpl.subtasks.map((title, i) => ({ id: `${task.id}.${i + 1}`, title, done: false }));
            this.put({ ...t(), subtasks, updatedAt: this.clock });
            this.emit({ type: "plan.created", agentId: id, taskId: task.id, message: `KT XDCB lập kế hoạch ${task.id}: ${subtasks.length} hạng mục kiểm tra`, metadata: { subtasks: subtasks.map((s) => s.title) } });
          }),
          this.talk(id, "troly1", d.coordinate, "assign", "Giao Trợ lý 1 lấy văn bản pháp luật ở Kho"),
          this.talk(id, "troly2", d.coordinate, "assign", "Giao Trợ lý 2 lấy hồ sơ cũ ở Kho"),
          call(() => {
            this.side("troly2", task.id, "fetch");
            this.side("iris", task.id, "serve");
            this.side("piper", task.id, "serve");
            this.message(id, "troly1", task.id, `Cần căn cứ cho ${tpl.subtasks.length} hạng mục của "${short}"`);
            this.transition(task.id, "plan_ready");
          }),
        ];

      case "research":
        // Trợ lý 1 phụ trách bước này: lấy văn bản, rồi chờ Trợ lý 2 mang hồ sơ cũ về.
        return [
          ...this.fetchActions(id, task, "docs"),
          call(() => progress(0.7)),
          { kind: "wait", until: () => this.hasFlag(task.id, "back:troly2"), timeout: WAIT_LIMIT, activity: "Chờ Trợ lý 2 mang hồ sơ cũ về" },
          call(() => {
            this.put({ ...t(), findings: [...tpl.findings], updatedAt: this.clock });
            this.emit({ type: "research.completed", agentId: id, targetAgentId: "kai", taskId: task.id, message: `Trợ lý mang ${tpl.findings.length} tài nguyên nghiên cứu từ Kho về cho ${task.id}`, metadata: { findings: tpl.findings } });
            this.transition(task.id, "findings_published");
          }),
        ];

      case "implementation": {
        const iteration = task.iteration;
        const first = iteration <= 1;
        return [
          at("dev"),
          call(() => {
            this.side("troly2", task.id, "help");
            if (first) this.side("troly1", task.id, "help");
            this.emit({ type: "implementation.started", agentId: id, taskId: task.id, message: first ? `KT XDCB bắt đầu soạn báo cáo ${task.id}` : `KT XDCB sửa ${task.id} theo Phiếu QA (lần ${iteration})`, metadata: { iteration } });
          }),
          {
            kind: "work",
            duration: first ? d.implement : d.fix,
            status: "working",
            activity: first ? `Soạn báo cáo: ${short}` : `Sửa theo Phiếu QA: ${task.id}`,
            onProgress: (f) => {
              progress(f);
              const cur = t();
              const n = Math.ceil(f * cur.subtasks.length);
              if (cur.subtasks.some((s, i) => i < n && !s.done)) {
                this.put({ ...cur, subtasks: cur.subtasks.map((s, i) => (i < n ? { ...s, done: true } : s)) });
              }
            },
          },
          this.talk(id, "troly1", d.submit, "assign", `Nhờ Trợ lý 1 đưa báo cáo lần ${iteration} sang QA`),
          call(() => {
            this.side("troly1", task.id, "deliver");
            this.emit({ type: "implementation.submitted", agentId: id, targetAgentId: "quinn", taskId: task.id, message: `KT XDCB nộp báo cáo lần ${iteration} của ${task.id}`, metadata: { iteration } });
            this.transition(task.id, "submitted");
          }),
        ];
      }

      case "testing": {
        const fails = this.outcome(task, "qa");
        const test = tpl.tests[(task.iteration - 1) % tpl.tests.length]!;
        const head: Action[] = [
          at("testing"),
          { kind: "wait", until: () => this.hasFlag(task.id, `delivered:${task.iteration}`), timeout: WAIT_LIMIT, activity: `Chờ trợ lý đưa báo cáo ${task.id}` },
          call(() => this.emit({ type: "qa.started", agentId: id, taskId: task.id, message: `QA chấm báo cáo lần ${task.iteration}`, feed: false })),
          { kind: "work", duration: d.test, status: "working", activity: `Chấm báo cáo lần ${task.iteration}`, onProgress: progress },
        ];
        if (fails) {
          return [
            ...head,
            { kind: "emote", status: "error", duration: d.errorEmote, activity: `Chưa đạt: ${test}` },
            this.talk(id, "kai", d.report, "report", "Trả Phiếu QA về KT XDCB"),
            call(() => {
              this.message(id, "kai", task.id, `Chưa đạt tiêu chí "${test}" ở báo cáo lần ${task.iteration}`);
              this.emit({ type: "qa.failed", agentId: id, targetAgentId: "kai", taskId: task.id, severity: "warning", message: `QA trả về báo cáo lần ${task.iteration}: ${test}`, metadata: { test, iteration: task.iteration } });
              this.rework(task.id, "tests_failed");
            }),
          ];
        }
        return [
          ...head,
          { kind: "emote", status: "success", duration: d.celebrate, activity: "Đạt mọi tiêu chí" },
          this.talk(id, "orion", d.report, "message", "Báo Manager: báo cáo đạt"),
          call(() => {
            this.message(id, "orion", task.id, `Báo cáo lần ${task.iteration} đạt ${tpl.tests.length} tiêu chí`);
            this.emit({ type: "qa.passed", agentId: id, targetAgentId: "orion", taskId: task.id, severity: "success", message: `QA kết luận Đạt cho ${task.id} (lần ${task.iteration})`, metadata: { iteration: task.iteration } });
            this.transition(task.id, "tests_passed");
          }),
        ];
      }

      case "review":
        return [
          at("hub"),
          { kind: "work", duration: d.review, status: "thinking", activity: `Tổng hợp ${task.id} gửi anh Việt`, onProgress: progress },
          { kind: "emote", status: "success", duration: d.announce, activity: `${task.id}: đã gửi anh Việt duyệt` },
          this.talk(id, "rex", d.report, "message", "Nhờ Thư ký R&D ghi bài học"),
          call(() => {
            this.emit({ type: "review.approved", agentId: id, targetAgentId: "rex", taskId: task.id, severity: "success", message: `Manager gửi ${task.id} cho anh Việt duyệt` });
            this.transition(task.id, "approved");
          }),
        ];

      case "done": {
        const note = tpl.reviewNotes[(Math.max(1, task.iteration) - 1) % tpl.reviewNotes.length]!;
        return [
          at("review"),
          { kind: "work", duration: d.lessons, status: "working", activity: `Ghi Sổ bài học ${task.id}` },
          { kind: "emote", status: "success", duration: d.celebrate, activity: "Đã ghi Sổ bài học" },
          call(() => {
            const cur = t();
            this.put({ ...cur, progress: 1, assignedAgentId: null });
            this.emit({ type: "agent.message", agentId: id, taskId: task.id, message: `Bài học ${task.id}: ${note}`, feed: false });
            this.emit({ type: "task.completed", agentId: id, taskId: task.id, severity: "success", message: `${task.id} xong, chờ anh Việt duyệt: ${short}`, metadata: { iteration: cur.iteration } });
          }),
        ];
      }

      default:
        throw new Error(`No job for phase ${job.phase}`);
    }
  }

  /** Remote talk: nobody walks. The link lives max(duration, linkDuration) so short talks still read on screen. */
  private talk(from: AgentId, to: AgentId, duration: number, kind: CommLink["kind"], activity: string): Action {
    return {
      kind: "talk",
      target: to,
      duration,
      activity,
      onStart: () => {
        this.links.push({ id: `L-${++this.linkSeq}`, from, to, kind, startedAt: this.clock, endsAt: this.clock + Math.max(duration, SIM_CONFIG.linkDuration) });
      },
    };
  }

  private message(from: AgentId, to: AgentId, taskId: string, message: string): void {
    this.emit({ type: "agent.message", agentId: from, targetAgentId: to, taskId, message });
  }

  /** Scripted outcome if the task has a script, else seeded random. Random never fails the last iteration. */
  private outcome(task: Task, gate: "qa" | "review"): boolean {
    const scripted = gate === "qa" ? task.script?.qaFailsOn : task.script?.reviewChangesOn;
    if (task.script) return (scripted ?? []).includes(task.iteration);
    const rate = gate === "qa" ? SIM_CONFIG.qaFailRate : SIM_CONFIG.reviewChangeRate;
    return this.taskRng.get(task.id)!() < rate && task.iteration < SIM_CONFIG.maxIterations;
  }

  private rework(taskId: string, signal: "tests_failed" | "changes_requested"): void {
    const task = this.tasks.get(taskId)!;
    if (task.iteration >= SIM_CONFIG.maxIterations) {
      this.transition(taskId, "abort");
      this.emit({ type: "task.failed", taskId, severity: "error", message: `${taskId} failed after ${task.iteration} iterations` });
      return;
    }
    this.transition(taskId, signal);
  }

  /** Apply a workflow signal, hand the task to the next phase owner and queue their job. */
  private transition(taskId: string, signal: WorkflowSignal): void {
    const before = this.tasks.get(taskId)!;
    const next = applySignal(before, signal, this.clock);
    const owner = PHASE_OWNER[next.phase]?.agent ?? null;
    this.put({ ...next, assignedAgentId: owner });
    this.emit({ type: "task.status_changed", taskId, agentId: owner ?? undefined, message: `${taskId}: ${before.phase} → ${next.phase}`, feed: false, metadata: { from: before.phase, to: next.phase, signal } });
    if (!owner) return;
    this.jobs.get(owner)!.push({ taskId, phase: next.phase });
    if (this.ctrl(owner).state.paused) this.block(this.tasks.get(taskId)!, `${getAgent(owner).name} is paused`);
  }

  private block(t: Task, reason: string): void {
    this.put({ ...t, status: "blocked", blockedReason: reason, updatedAt: this.clock });
    this.emit({ type: "task.blocked", agentId: t.assignedAgentId ?? undefined, taskId: t.id, severity: "warning", message: `${t.id} blocked: ${reason}` });
  }

  private onArrived(id: AgentId, location: LocationId): void {
    const c = this.ctrl(id);
    this.emit({ type: "agent.arrived", agentId: id, message: `${getAgent(id).name} đến ${LOCATIONS[location].label}`, feed: false, metadata: { location, withTask: c.state.currentTaskId !== null } });
  }

  // ───────────────────────── plumbing ─────────────────────────

  private resetAgents(): void {
    for (const a of AGENTS) {
      this.ctrl(a.id).resetToHome();
      this.jobs.set(a.id, []);
      this.currentJob.set(a.id, null);
      this.idleSince.set(a.id, 0);
      const cfg = a.active ? SIM_CONFIG.ambient : SIM_CONFIG.ambientFree;
      this.nextAmbientAt.set(a.id, rngRange(this.rng, cfg.minGap, cfg.maxGap));
    }
  }

  private ctrl(id: AgentId): AgentController {
    return this.controllers.get(id)!;
  }

  private seqOf(t: Task): number {
    return this.taskSeq.get(t.id) ?? 0;
  }

  private put(task: Task): void {
    this.tasks.set(task.id, task);
  }

  private emit(input: EmitInput): void {
    const type: AgentEventType = input.type;
    const event: AgentEvent = {
      ...input,
      id: `E-${++this.eventSeq}`,
      type,
      timestamp: this.now(),
      simTime: this.clock,
      severity: input.severity ?? "info",
      feed: input.feed ?? true,
    };
    if (event.agentId === undefined) delete event.agentId;
    this.log.push(event);
    if (this.log.length > SIM_CONFIG.maxEvents) this.log.splice(0, this.log.length - SIM_CONFIG.maxEvents);
    this.events.emit(event);
  }

  private publish(): void {
    if (this.snapshots.size > 0) this.snapshots.emit(this.snapshot());
  }

  /** Test/debug helper: agent state without cloning. */
  peekAgent(id: AgentId): Readonly<AgentState> {
    return this.ctrl(id).state;
  }
}
