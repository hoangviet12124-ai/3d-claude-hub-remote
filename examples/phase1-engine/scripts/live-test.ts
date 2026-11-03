// Live Claude Code source checks (npm run test:live).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LiveAgentBackend, NEEDS_PERMISSION, classifyTool, subagentRole } from "../src/live/LiveAgentBackend.ts";
import type { HookPayload } from "../src/live/LiveAgentBackend.ts";
import { WebSocketAgentBackend } from "../src/integrations/WebSocketAgentBackend.ts";
import { startWorldServer } from "../server/worldServer.ts";
import { createHookRoute } from "../server/hookRoute.ts";
import { AGENTS } from "../src/agents/AgentRegistry.ts";
import { LOCATIONS, slotFor } from "../src/simulation/worldLayout.ts";
import type { AgentEvent } from "../src/events/eventTypes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(5);
  return cond();
}

console.log("\nLive Claude Code source");

// ── classification: what a tool call is, in words (which robot does it is decided by the session) ──
{
  const cwd = "/p";
  const cases: [string, Record<string, unknown>, string, string][] = [
    ["Read", { file_path: "/p/src/a.ts" }, "work", "Đọc · src/a.ts"],
    ["Grep", { pattern: "login" }, "work", "Tìm · login"],
    ["WebSearch", { query: "nghị định 175" }, "work", "Tra trên web · nghị định 175"],
    ["Edit", { file_path: "/p/src/a.ts" }, "work", "Sửa · src/a.ts"],
    ["Write", { file_path: "/p/Báo cáo.md" }, "work", "Ghi · Báo cáo.md"],
    ["Bash", { command: "npm test -- auth" }, "work", "Chạy lệnh · npm test -- auth"],
    ["PowerShell", { command: "Get-ChildItem" }, "work", "Chạy lệnh · Get-ChildItem"],
    ["TodoWrite", {}, "plan", "Cập nhật danh sách việc"],
    ["ExitPlanMode", {}, "plan", "Lập kế hoạch"],
    ["Agent", { subagent_type: "thu-thu" }, "work", "Giao việc · thu-thu"],
    ["Skill", { skill: "kiem-toan-xdcb-agent" }, "work", "Dùng skill · kiem-toan-xdcb-agent"],
    ["AskUserQuestion", {}, "ask", "Hỏi anh một câu"],
    ["mcp__github__get_issue", {}, "work", "github · get_issue"],
  ];
  const wrong = cases.filter(([tool, input, kind, label]) => {
    const c = classifyTool(tool, input, cwd);
    return c?.kind !== kind || c.label !== label;
  });
  check(`tool calls are described in Vietnamese (${cases.length} cases)`, wrong.length === 0, wrong.map(([t, i]) => `${t} ${JSON.stringify(i)} → ${JSON.stringify(classifyTool(t, i, cwd))}`).join("; "));
  check("Claude Code plumbing (ToolSearch) is not shown", classifyTool("ToolSearch", { query: "select:TodoWrite" }) === null);
  const win = "C:\\Users\\ACV\\Desktop\\Brainstorm";
  check("Windows paths are shown relative to the project, with /", classifyTool("Read", { file_path: `${win}\\Tổ giúp việc\\Sổ.md` }, win)?.label === "Đọc · Tổ giúp việc/Sổ.md");
  const roles: [string, string][] = [
    ["qa", "quinn"], ["truong-phong-xdcb", "kai"], ["truong-phong-xdcb-b", "kai"], ["thu-thu", "iris"], ["so-hoa", "piper"],
    ["so-hoa-scan", "piper"], ["thu-ky-rnd", "rex"], ["ky-su-cai-tien", "caitien"], ["truong-phong-nghien-cuu-phuong-phap", "chuyende"],
    ["chuyen-vien-tai-chinh-a", "taichinh"], ["chuyen-vien-tai-chinh-b", "taichinh"], ["tom-tat-vu-viec", "troly1"],
    ["trich-du-kien", "troly2"], ["Explore", "troly2"], ["general-purpose", "troly2"], ["", "troly2"],
  ];
  const badRoles = roles.filter(([t, want]) => subagentRole(t) !== want);
  check(`each agent file of the Tổ has its own robot (${roles.length} names)`, badRoles.length === 0, badRoles.map(([t]) => `${t} → ${subagentRole(t)}`).join("; "));
  check("every robot's room exists in the layout", AGENTS.every((a) => a.home in LOCATIONS));
  {
    const wrapped = "<ide_selection>The user selected the lines 116 to 116 from /x/app.ts:\nfoo()\n</ide_selection>\nsửa đi em";
    const live2 = new LiveAgentBackend({ autoTick: false });
    live2.ingest({ hook_event_name: "UserPromptSubmit", session_id: "w", prompt: wrapped });
    live2.ingest({ hook_event_name: "UserPromptSubmit", session_id: "c", prompt: "<command-name>/clear</command-name>\n<command-message>clear</command-message>" });
    const titles = live2.snapshot().tasks.map((t) => t.title);
    check("task titles show what you typed, not IDE selections or slash-command wrappers", titles.includes("sửa đi em") && titles.includes("/clear"), titles.join(" | "));
  }
}

function replay(file: string, watch?: (live: LiveAgentBackend, p: HookPayload) => void): { live: LiveAgentBackend; events: AgentEvent[] } {
  const lines = readFileSync(join(root, "bridge", file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { t: number; payload: HookPayload });
  const live = new LiveAgentBackend({ autoTick: false, now: () => 0 });
  const events: AgentEvent[] = [];
  live.subscribe((e) => events.push(e));
  let now = 0;
  for (const { t, payload } of lines) {
    while (now < t / 1000) { live.tick(1 / 30); now += 1 / 30; }
    live.ingest(payload);
    watch?.(live, payload);
  }
  for (let k = 0; k < 30 * 20; k++) live.tick(1 / 30);
  return { live, events };
}
const at = (live: LiveAgentBackend, id: string) => live.snapshot().agents.find((a) => a.id === id)!;
const there = (live: LiveAgentBackend, id: string, loc: string) => { const a = at(live, id); return a.location === loc || a.destination === loc; };

// ── a Tổ giúp việc session (Windows paths): Manager → Thủ thư → Trưởng phòng XDCB → QA → Manager ──
{
  const seen: Record<string, boolean> = {};
  const r = replay("to-giup-viec-session.jsonl", (live, p) => {
    const key = `${p.hook_event_name}:${p.agent_type ?? p.tool_name ?? ""}`;
    if (process.env.DEBUG_LIVE) console.log(key, ["orion", "iris", "kai", "quinn"].map((id) => { const a = at(live, id); return `${id}:${a.location}>${a.destination}:${a.status}:${a.activity}`; }).join(" | "));
    if (key === "PreToolUse:Read" && !p.agent_type) seen.managerReads = there(live, "orion", "hub") && at(live, "orion").activity === "Đọc · CLAUDE.md";
    if (key === "SubagentStart:thu-thu") seen.irisGoes = there(live, "iris", "research") && at(live, "orion").status === "thinking";
    if (key === "PreToolUse:Grep") seen.untaggedOnSubagent = at(live, "iris").activity.startsWith("Tìm ·") && !at(live, "orion").activity.startsWith("Tìm");
    if (key === "PreToolUse:truong-phong-xdcb-b" && p.tool_name === "Write") seen.kaiWrites = there(live, "kai", "dev") && at(live, "kai").activity === "Ghi · …/Kết quả/Báo cáo kết quả.md";
    if (key === "SubagentStop:thu-thu") seen.irisReleased = at(live, "iris").status === "idle" && at(live, "orion").activity === "Đọc báo cáo của agent";
    if (key === "SubagentStart:qa") seen.quinnGoes = there(live, "quinn", "testing");
    if (key === "PermissionRequest:Bash") seen.waits = there(live, "orion", "hub") && live.snapshot().live?.sessions[0]?.status === "waiting";
  });
  const { live, events } = r;
  const task = live.snapshot().tasks[0]!;
  const phases = [task.history[0]!.from, ...task.history.map((h) => h.to)].join(" → ");
  check("Tổ: the prompt becomes the task, titled with what Việt typed", task.title.startsWith("Rà soát hồ sơ gói thầu mẫu"));
  check("Tổ: phases follow which agent works: Thủ thư (research), Trưởng phòng (implementation), QA (testing)", phases === "queued → intake → research → implementation → testing → done", phases);
  check("Tổ: the Manager reads at the hub", seen.managerReads === true);
  check("Tổ: SubagentStart sends that agent's robot to its room while the Manager waits", seen.irisGoes === true && seen.quinnGoes === true);
  check("Tổ: a tool call with no agent_type during a subagent is shown on that subagent, not the Manager", seen.untaggedOnSubagent === true);
  check("Tổ: Trưởng phòng XDCB (bản b) writes the report at the XDCB desk", seen.kaiWrites === true);
  check("Tổ: SubagentStop frees the robot (back at its own desk) and the Manager reads the report", seen.irisReleased === true);
  check("Tổ: a permission ask puts the session in waiting, Manager at the hub", seen.waits === true);
  check("Tổ: each assignment and report shows as Manager ↔ agent", ["iris", "kai", "quinn"].every((id) => events.some((e) => e.type === "task.assigned" && e.agentId === "orion" && e.targetAgentId === id) && events.some((e) => e.agentId === id && e.targetAgentId === "orion")));
  check("Tổ: QA's failed read is reported on QA", events.some((e) => e.agentId === "quinn" && e.message.startsWith("Lỗi · Đọc")));
  check("Tổ: the permission warning starts with the Vietnamese prefix the sounds listen for", events.some((e) => e.agentId === "orion" && e.message.startsWith(`${NEEDS_PERMISSION} · Chạy lệnh`)));
  check("Tổ: Claude's todo list becomes the task cards", task.subtasks.length === 3 && task.subtasks[1]!.title === "Trưởng phòng XDCB rà hồ sơ");
  check("Tổ: Stop is worded as the end of a turn", events.some((e) => e.type === "task.completed" && e.message.includes("Xong lượt")));
  check("Tổ: the project is the folder name, even from a Windows path", live.snapshot().live?.sessions[0]?.project === "Brainstorm");
  const home = live.snapshot().agents.every((a) => {
    const pos = slotFor(AGENTS.find((x) => x.id === a.id)!.home, 0).position;
    return Math.hypot(a.position.x - pos.x, a.position.z - pos.z) < 1e-6 && a.status === "idle";
  });
  check("Tổ: after the session everyone is home and idle", home, live.snapshot().agents.filter((a) => a.status !== "idle").map((a) => `${a.id}:${a.status}@${a.location}`).join(" "));
}

// ── two subagents at once (Manager runs Thủ thư and Trích dữ kiện in parallel) ──
{
  const live = new LiveAgentBackend({ autoTick: false, now: () => 0 });
  const base = { session_id: "par", cwd: "/p" };
  live.ingest({ ...base, hook_event_name: "UserPromptSubmit", prompt: "song song" });
  live.ingest({ ...base, hook_event_name: "SubagentStart", agent_type: "thu-thu" });
  live.ingest({ ...base, hook_event_name: "SubagentStart", agent_type: "trich-du-kien" });
  live.ingest({ ...base, hook_event_name: "PreToolUse", tool_name: "Read", agent_type: "thu-thu", tool_input: { file_path: "/p/a.md" } });
  live.ingest({ ...base, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/p/b.md" } });
  for (let k = 0; k < 30; k++) live.tick(1 / 30);
  const both = there(live, "iris", "research") && there(live, "troly2", "bot2");
  const split = at(live, "iris").activity === "Đọc · a.md" && at(live, "troly2").activity === "Đọc · b.md";
  live.ingest({ ...base, hook_event_name: "SubagentStop", agent_type: "trich-du-kien" });
  for (let k = 0; k < 30; k++) live.tick(1 / 30);
  const oneLeft = there(live, "iris", "research") && at(live, "iris").status === "working" && at(live, "orion").status === "thinking";
  check("parallel subagents: both robots work in their rooms at once", both);
  check("…a tagged call goes to its agent, an untagged one to the newest subagent", split, `${at(live, "iris").activity} | ${at(live, "troly2").activity}`);
  check("…when one stops, the other keeps working and the Manager keeps waiting", oneLeft);
}

// ── the original sample session (a coding session): everything not in a subagent is the Manager ──
const sample = readFileSync(join(root, "bridge", "sample-session.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { t: number; payload: HookPayload });
{
  let managerEdits = true;
  const r = replay("sample-session.jsonl", (live, p) => {
    if (p.hook_event_name === "PreToolUse" && p.tool_name === "Edit") managerEdits &&= there(live, "orion", "hub") && at(live, "orion").status === "working" && at(live, "kai").status === "idle";
  });
  const { live, events } = r;
  const task = live.snapshot().tasks[0]!;
  const phases = [task.history[0]!.from, ...task.history.map((h) => h.to)].join(" → ");
  check("sample: the Explore subagent is Trợ lý 2, the only phase change", phases === "queued → intake → research → done", phases);
  check("sample: the main session's own edits are the Manager's, at the hub", managerEdits);
  check("sample: a failed test run is reported, without guessing pass or fail", events.some((e) => e.agentId === "orion" && e.message.startsWith("Lỗi · Chạy lệnh · npm test")) && !events.some((e) => e.type === "qa.passed" || e.type === "qa.failed"));
  check("sample: task.completed is emitted", events.some((e) => e.type === "task.completed"));

  const refusals = await Promise.all([
    live.submitTask({ title: "x" }).then(() => "ok", (e: Error) => e.message),
    live.setSpeed(2).then(() => "ok", (e: Error) => e.message),
    live.pauseAgent("kai").then(() => "ok", (e: Error) => e.message),
  ]);
  check("the live view is read-only: submit, speed and pause are refused with a reason", refusals.every((x) => x.includes("real time") || x.includes("read-only")), refusals.join(" | "));

  const hidden = new LiveAgentBackend({ autoTick: false, showPrompts: false });
  hidden.ingest(sample[1]!.payload);
  check("--hide-prompts keeps prompt text out of the world", hidden.snapshot().tasks[0]?.title === "Prompt 1" && hidden.snapshot().tasks[0]?.description === "");
}

// ── recorded real sessions (Claude Code 2.1.304, claude -p) ──
{
  const { live, events } = replay("real-session-discount-bug.jsonl");
  check("real session: ToolSearch does not appear in the world", !events.some((e) => e.message.includes("ToolSearch")));
  const task = live.snapshot().tasks[0]!;
  check("real session: Claude's todo list and the final Stop come through", task.subtasks.length >= 3 && task.phase === "done", `${task.subtasks.length} cards, ${task.phase}`);
}
{
  const { live } = replay("real-session-fail-fix-pass.jsonl");
  const task = live.snapshot().tasks[0]!;
  check("real session 3: all four todo cards end up done", task.subtasks.length === 4 && task.subtasks.every((x) => x.done));
}
{
  const { events } = replay("real-session-permission.jsonl");
  check("real session 2: each PermissionRequest shows the Manager asking for permission", events.filter((e) => e.agentId === "orion" && e.message.startsWith(`${NEEDS_PERMISSION} · Chạy lệnh · node --test`)).length === 2);
}

// ── several sessions at once: one focused session drives the robots ──
// Interleaved sessions are built from the recordings: each copy gets its own session_id, cwd and time offset.
type Line = { t: number; payload: HookPayload };
function recording(file: string, opts: { id?: string; offsetMs?: number; cwd?: string; drop?: string[] } = {}): Line[] {
  return readFileSync(join(root, "bridge", file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line)
    .filter((l) => !opts.drop?.includes(l.payload.hook_event_name))
    .map((l) => ({ t: l.t + (opts.offsetMs ?? 0), payload: { ...l.payload, ...(opts.id ? { session_id: opts.id } : {}), ...(opts.cwd ? { cwd: opts.cwd } : {}) } }));
}
const merge = (...lists: Line[][]): Line[] => lists.flat().sort((a, b) => a.t - b.t);
// None of these recordings run a subagent at the moments checked, so the robot holding a session is the Manager.
const STATION: Record<string, string> = { orion: "hub" };
const holderOf = (_l: Line): string => "orion";
const HOME = Object.fromEntries(AGENTS.map((a) => [a.id, a.home])) as Record<string, string>;

/** Replays lines on a simulated clock (30 Hz ticks; the backend's wall clock is the same simulated time). */
function multi(lines: Line[], hooks: { after?: (live: LiveAgentBackend, l: Line, ms: number) => void; tick?: (live: LiveAgentBackend, ms: number) => void; at?: [number, (live: LiveAgentBackend) => void][] } = {}) {
  let ms = 0;
  const live = new LiveAgentBackend({ autoTick: false, now: () => ms });
  const events: AgentEvent[] = [];
  live.subscribe((e) => events.push(e));
  const pending = [...(hooks.at ?? [])].sort((a, b) => a[0] - b[0]);
  const step = (toMs: number) => {
    while (ms < toMs) {
      while (pending.length && pending[0]![0] <= ms) pending.shift()![1](live);
      live.tick(1 / 30);
      ms += 1000 / 30;
      hooks.tick?.(live, ms);
    }
  };
  for (const l of lines) {
    step(l.t);
    live.ingest(l.payload);
    hooks.after?.(live, l, ms);
  }
  return { live, events, run: step, now: () => ms };
}
const agentSig = (live: LiveAgentBackend) => live.snapshot().agents.map((a) => `${a.id}:${a.position.x.toFixed(4)},${a.position.z.toFixed(4)}:${a.status}:${a.activity}`).join("|");

{
  // A: the sample session (shop-api). B: the fail-fix-pass recording as another project, starting 3 s later.
  // A never goes 8 s without a hook while B runs, so auto focus must stay on A the whole time.
  const A = recording("sample-session.jsonl");
  const B = recording("real-session-fail-fix-pass.jsonl", { id: "B-billing", cwd: "/Users/you/projects/billing", offsetMs: 3000 });
  const soloAt = new Map<number, string>();
  multi(A, { after: (live, l) => soloAt.set(l.t, agentSig(live)) });
  const focusSeen = new Set<string | null>();
  const mismatches: number[] = [];
  const { live, events } = multi(merge(A, B), {
    after: (lv, l) => {
      if (l.payload.session_id === "sample-0001" && soloAt.get(l.t) !== agentSig(lv)) mismatches.push(l.t);
    },
    tick: (lv) => focusSeen.add(lv.focus.sessionId),
  });
  check("two interleaved sessions: auto focus stays on the session that started first while it keeps working (no flicker)",
    focusSeen.size === 1 && focusSeen.has("sample-0001"), [...focusSeen].join(","));
  check("…and the robots move exactly as they do with that session alone (the other session never moves a robot)",
    mismatches.length === 0, `differs at ${mismatches.slice(0, 5).join(", ")} ms`);
  const bEvents = events.filter((e) => e.metadata?.["session"] === "B-billing");
  check("…while the other session's events still reach the feed, tagged with its session and project",
    bEvents.some((e) => e.type === "task.created") && bEvents.some((e) => e.type === "task.completed") &&
    bEvents.every((e) => e.metadata?.["project"] === "billing"), `${bEvents.length} events`);
  const s = live.snapshot();
  const bTask = s.tasks.find((t) => t.origin?.sessionId === "B-billing");
  check("…and its task keeps its own phases and its origin (session, project)",
    bTask?.phase === "done" && bTask.origin?.project === "billing" && s.tasks.find((t) => t.origin?.sessionId === "sample-0001")?.phase === "done",
    `${bTask?.phase} ${bTask?.origin?.project}`);
  const listed = s.live?.sessions.map((x) => `${x.project}:${x.status}`).join(",");
  check("the snapshot lists both sessions, newest first, with title, project and status",
    listed === "shop-api:idle,billing:ended" && s.live?.sessions[0]?.title.startsWith("Add rate limiting") === true && s.live?.focus.mode === "auto", listed);
}

{
  // A: fail-fix-pass without its SessionEnd (the turn ends at 40.4 s and the session stays open).
  // B: the discount-bug session as another project, 5 s later; its hooks continue to 52.2 s.
  const A = recording("real-session-fail-fix-pass.jsonl", { id: "A", drop: ["SessionEnd"] });
  const B = recording("real-session-discount-bug.jsonl", { id: "B", cwd: "/Users/you/projects/cart", offsetMs: 5000 });
  const aStop = A.find((l) => l.payload.hook_event_name === "Stop")!.t;
  const switches: { ms: number; to: string | null }[] = [];
  let last: string | null = null;
  const watch = (lv: LiveAgentBackend, ms: number) => {
    if (lv.focus.sessionId !== last) {
      switches.push({ ms, to: lv.focus.sessionId });
      last = lv.focus.sessionId;
    }
  };
  let restaged = "";
  const { live } = multi(merge(A, B), {
    after: (lv, _l, ms) => watch(lv, ms),
    tick: (lv, ms) => {
      const before = last;
      watch(lv, ms);
      if (before === "A" && last === "B") {
        // Re-staging: B's holder is the robot of B's latest tool call; everyone else heads home.
        const lastTool = [...B].reverse().find((l) => l.t <= ms && l.payload.hook_event_name === "PreToolUse")!;
        const holder = holderOf(lastTool);
        lv.tick(1 / 30);
        const agents = lv.snapshot().agents;
        const h = agents.find((a) => a.id === holder)!;
        const atStation = h.location === STATION[holder] || h.destination === STATION[holder];
        const othersHome = agents.filter((a) => a.id !== holder).every((a) => a.location === HOME[a.id] || a.destination === HOME[a.id]);
        restaged = `${holder}:${atStation}:${othersHome}`;
      }
    },
  });
  const toB = switches.filter((x) => x.to === "B");
  check("auto hysteresis: B's hooks 4 s after A's turn ended do not take focus; it moves once A has been idle 8 s",
    switches.length === 3 && switches[0]!.to === "A" && toB.length === 1 && toB[0]!.ms >= aStop + 8000 && toB[0]!.ms < aStop + 8100,
    switches.map((x) => `${x.to}@${Math.round(x.ms)}`).join(" "));
  check("re-staging on a focus change: the new session's robot goes to its station, every other robot heads home",
    /^\w+:true:true$/.test(restaged), restaged);
  const bEnd = B.find((l) => l.payload.hook_event_name === "SessionEnd")!.t;
  check("when the focused session ends, focus returns at once to the session still open", switches[2]?.to === "A" && switches[2].ms >= bEnd && switches[2].ms < bEnd + 50 && live.focus.sessionId === "A",
    switches.map((x) => `${x.to}@${Math.round(x.ms)}`).join(" "));
}

{
  // A: the sample session. B: the permission recording as another project; B asks for permission at 18.7 s
  // while A is busy, and its session ends at 31.7 s.
  const A = recording("sample-session.jsonl");
  const B = recording("real-session-permission.jsonl", { id: "B-perm", cwd: "/Users/you/projects/infra" });
  const ask = B.find((l) => l.payload.hook_event_name === "PermissionRequest")!.t;
  const end = B.find((l) => l.payload.hook_event_name === "SessionEnd")!.t;
  let focusAtAsk: string | null = null;
  let orionAtAsk = "";
  let focusAtEnd: string | null = null;
  let stayedOnB = true;
  const { events } = multi(merge(A, B), {
    after: (lv, l) => {
      if (l.t === ask && l.payload.hook_event_name === "PermissionRequest") {
        focusAtAsk = lv.focus.sessionId;
        const o = lv.snapshot().agents.find((a) => a.id === "orion")!;
        orionAtAsk = `${o.destination ?? o.location}`;
      }
      if (l.t > ask && l.t < end && l.payload.session_id === "sample-0001" && lv.focus.sessionId !== "B-perm") stayedOnB = false;
      if (l.t === end && l.payload.hook_event_name === "SessionEnd") focusAtEnd = lv.focus.sessionId;
    },
  });
  check("a session that starts waiting for you takes focus at once, and Orion heads to the hub", focusAtAsk === "B-perm" && orionAtAsk === "hub", `${focusAtAsk} ${orionAtAsk}`);
  check("…it keeps focus while it waits, however busy the other session is", stayedOnB);
  check("…and when it ends, focus goes straight back to the session still working", focusAtEnd === "sample-0001", `${focusAtEnd}`);
  const asks = events.filter((e) => e.agentId === "orion" && e.message.startsWith(NEEDS_PERMISSION));
  check("the permission warning carries the waiting session's id, title and project", asks.length === 2 && asks.every((e) => e.metadata?.["session"] === "B-perm" && e.metadata?.["project"] === "infra" && typeof e.metadata?.["sessionTitle"] === "string"));
}

{
  // Pinned: the same pair, with A pinned at 3 s. B's permission ask must not take focus.
  const A = recording("sample-session.jsonl");
  const B = recording("real-session-permission.jsonl", { id: "B-perm", cwd: "/Users/you/projects/infra" });
  const seen = new Set<string>();
  let pinError = "";
  const { live, run, now } = multi(merge(A, B), {
    at: [[3000, (lv) => {
      void lv.focusSession("sample-0001");
      void lv.focusSession("nope").catch((e: Error) => { pinError = e.message; });
    }]],
    tick: (lv, ms) => { if (ms > 3100) seen.add(`${lv.focus.sessionId}/${lv.focus.mode}`); },
  });
  check("a pinned focus holds: another session's permission ask and activity do not move it", seen.size === 1 && seen.has("sample-0001/pinned"), [...seen].join(","));
  // Pin B (ended) and back to auto.
  await live.focusSession("B-perm");
  const pinnedB = live.focus;
  await live.focusSession(null);
  check("pinning a session the server has not seen is refused with a reason", /No hooks from that session/.test(pinError), pinError);
  check("choosing auto again follows the most active session at once", pinnedB.sessionId === "B-perm" && pinnedB.mode === "pinned" && live.focus.mode === "auto" && live.focus.sessionId === "sample-0001", JSON.stringify(live.focus));
  run(now() + 181_000);
  const left = live.snapshot().live?.sessions.map((x) => x.sessionId).join(",");
  check("ended sessions drop out of the snapshot after a few minutes; the idle one stays", left === "sample-0001", left);
}

{
  // Re-staging on a pin: B is mid-work when you pin it; its robot goes to its station, A's robot goes home.
  const A = recording("sample-session.jsonl");
  const B = recording("real-session-fail-fix-pass.jsonl", { id: "B-billing", cwd: "/Users/you/projects/billing", offsetMs: 3000 });
  const lines = merge(A, B);
  const { live, run } = multi(lines.filter((l) => l.t <= 25_000));
  const bTool = [...lines].reverse().find((l) => l.t <= 25_000 && l.payload.session_id === "B-billing" && l.payload.hook_event_name === "PreToolUse")!;
  const aTool = [...lines].reverse().find((l) => l.t <= 25_000 && l.payload.session_id === "sample-0001" && l.payload.hook_event_name === "PreToolUse")!;
  const bHolder = holderOf(bTool);
  const aHolder = holderOf(aTool);
  run(25_200);
  await live.focusSession("B-billing");
  run(25_200 + 8000);
  const agents = live.snapshot().agents;
  const b = agents.find((a) => a.id === bHolder)!;
  const a = agents.find((x) => x.id === aHolder)!;
  check(`re-staging on a pin: B's robot (${bHolder}) is at its station holding B's activity; A's robot (${aHolder}) went home`,
    b.location === STATION[bHolder] && b.status !== "idle" && b.activity === classifyTool(bTool.payload.tool_name!, bTool.payload.tool_input, bTool.payload.cwd)!.label &&
    (aHolder === bHolder || a.location === HOME[aHolder]),
    `${b.id}@${b.location}/${b.status}/${b.activity} · ${a.id}@${a.location}`);
}

// ── focusSession over the wire: a world command, so no token is needed on loopback when the token guards sessions ──
{
  const live = new LiveAgentBackend();
  await live.connect();
  const server = await startWorldServer({ backend: live, port: 0, token: "secret", tokenScope: "sessions" });
  const client = new WebSocketAgentBackend({ url: server.url });
  await client.connect();
  live.ingest({ hook_event_name: "UserPromptSubmit", session_id: "one", cwd: "/p/alpha", prompt: "first" });
  live.ingest({ hook_event_name: "UserPromptSubmit", session_id: "two", cwd: "/p/beta", prompt: "second" });
  await until(() => client.getSnapshot()?.live?.sessions.length === 2);
  const auto = client.getSnapshot()?.live?.focus;
  await client.focusSession("two");
  const pinned = await until(() => client.getSnapshot()?.live?.focus.sessionId === "two" && client.getSnapshot()?.live?.focus.mode === "pinned");
  const refused = await client.focusSession("three").then(() => "", (e: Error) => e.message);
  await client.focusSession(null);
  const back = await until(() => client.getSnapshot()?.live?.focus.mode === "auto");
  check("focusSession works over WebSocket without the sessions token (loopback), and the snapshot carries the focus",
    auto?.sessionId === "one" && auto.mode === "auto" && pinned && back && /No hooks/.test(refused), `${JSON.stringify(auto)} ${pinned} ${back} ${refused}`);
  check("the snapshot's session list says which project each session is in", client.getSnapshot()?.live?.sessions.map((s) => s.project).sort().join(",") === "alpha,beta");
  await client.disconnect();
  await server.close();
  await live.disconnect();
}

// ── over HTTP and WebSocket, plus the real forwarder script ──
{
  const live = new LiveAgentBackend();
  await live.connect();
  const server = await startWorldServer({ backend: live, port: 0, http: createHookRoute({ live }) });
  const httpUrl = server.url.replace(/^ws/, "http");
  const client = new WebSocketAgentBackend({ url: server.url });
  await client.connect();
  check("WebSocket clients see the live source as not simulated", client.simulated === false && client.label === "Live · Claude Code");
  const seen: AgentEvent[] = [];
  client.subscribe((e) => seen.push(e));

  const res = await fetch(`${httpUrl}/hook`, { method: "POST", body: JSON.stringify(sample[1]!.payload) });
  check("POST /hook answers 204 with an empty body", res.status === 204 && (await res.text()) === "");
  check("…and the prompt reaches WebSocket clients", await until(() => seen.some((e) => e.type === "task.created")));
  const created = () => seen.filter((e) => e.type === "task.created").length;
  const before = created();
  await fetch(`${httpUrl}/hook`, { method: "POST", body: JSON.stringify({ ...sample[1]!.payload, prompt: "dup check" }) });
  await fetch(`${httpUrl}/hook`, { method: "POST", body: JSON.stringify({ ...sample[1]!.payload, prompt: "dup check" }) });
  await until(() => created() > before);
  await sleep(150);
  check("a payload delivered twice (hooks at user and project level) counts once", created() === before + 1, `${created() - before}`);
  const bad = await fetch(`${httpUrl}/hook`, { method: "POST", body: "{not json" });
  check("malformed payloads are still answered 204 (never a hook error in Claude Code)", bad.status === 204);

  const payload = JSON.stringify({ hook_event_name: "SubagentStart", session_id: sample[1]!.payload.session_id, agent_type: "thu-thu" });
  const irisMoves = () => until(() => there2(client, "iris", "research"));
  const there2 = (c: WebSocketAgentBackend, id: string, loc: string) => { const a = c.getSnapshot()?.agents.find((x) => x.id === id); return a?.destination === loc || a?.location === loc; };
  // forward-hook.mjs: what the installer sets up (`node "…/forward-hook.mjs"`), so it needs no Git Bash or curl on Windows.
  const mjs = join(root, "bridge", "forward-hook.mjs");
  const runMjs = (env: Record<string, string>) => spawnSync(process.execPath, [mjs], { input: payload, env: { ...process.env, ...env }, encoding: "utf8" });
  const run = runMjs({ AAW_HOOK_URL: `${httpUrl}/hook` });
  check("forward-hook.mjs exits 0 and prints nothing", run.status === 0 && run.stdout === "" && run.stderr === "", `${run.status} ${JSON.stringify(run.stdout)} ${JSON.stringify(run.stderr)}`);
  check("…and its payload sends Thủ thư to her room", await irisMoves());

  // forward-hook.sh: the older shell forwarder, still accepted by the installer. Needs sh and curl.
  const sh = join(root, "bridge", "forward-hook.sh");
  if (process.platform !== "win32") {
    const r2 = spawnSync(sh, { input: JSON.stringify({ hook_event_name: "SubagentStart", session_id: "sh", agent_type: "qa" }), env: { ...process.env, AAW_HOOK_URL: `${httpUrl}/hook` }, encoding: "utf8" });
    check("forward-hook.sh exits 0 and prints nothing", r2.status === 0 && r2.stdout === "" && r2.stderr === "", `${r2.status} ${JSON.stringify(r2.stderr)}`);
  }

  await client.disconnect();
  await server.close();
  await live.disconnect();

  const t0 = Date.now();
  const down = runMjs({ AAW_HOOK_URL: "http://127.0.0.1:9/hook" });
  check("with no server running it still exits 0, silently, within 3 s", down.status === 0 && down.stdout === "" && down.stderr === "" && Date.now() - t0 < 3000, `${down.status} in ${Date.now() - t0} ms`);
}

console.log(failures === 0 ? "\nAll live checks passed." : `\n${failures} live check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
