// The org chart's tracker (npm run test:org): runs start and stop with the hooks, parallel copies of one agent are
// separate runs, waits and errors light the right lamps, and the live source puts the chart in its snapshots.
import { OrgTracker } from "../src/live/orgTracker.ts";
import type { OrgSessionView } from "../src/live/orgTracker.ts";
import { LiveAgentBackend } from "../src/live/LiveAgentBackend.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

let t = 1_000_000;
const now = () => t;
const S = "s1";
const running: OrgSessionView[] = [{ sessionId: S, title: "Rà hồ sơ thanh toán", status: "running", lastActivity: t }];
const idle: OrgSessionView[] = [{ sessionId: S, title: "Rà hồ sơ thanh toán", status: "idle", lastActivity: t }];

console.log("\nRuns");
const org = new OrgTracker({ now, listAgents: (cwd) => (cwd === "/vault" ? ["thu-thu", "so-hoa", "qa"] : []) });
org.ingest({ hook_event_name: "UserPromptSubmit", session_id: S, cwd: "/vault", prompt: "Rà hồ sơ thanh toán đợt 2" });
let st = org.state(running);
check("agent files come from <cwd>/.claude/agents", st.agents.join(",") === "qa,so-hoa,thu-thu", st.agents.join(","));
check("the Manager is on while the session runs", st.manager.state === "on" && st.manager.task === "Rà hồ sơ thanh toán");
check("the prompt is a move", st.moves.at(-1)?.kind === "prompt" && st.moves.at(-1)!.text.includes("Rà hồ sơ"));

for (const [i, d] of ["Số hóa phần 1", "Số hóa phần 2", "Số hóa phần 3"].entries()) {
  org.ingest({ hook_event_name: "PreToolUse", session_id: S, tool_name: "Agent", tool_input: { subagent_type: "so-hoa", description: d } });
  org.ingest({ hook_event_name: "SubagentStart", session_id: S, agent_type: "so-hoa", agent_id: `a${i + 1}` });
}
st = org.state(running);
check("three copies of so-hoa are three runs", st.runs.length === 3 && st.runs.every((r) => r.agentType === "so-hoa" && r.state === "on"));
check("each run carries its task", st.runs.map((r) => r.task).join("|") === "Số hóa phần 1|Số hóa phần 2|Số hóa phần 3", st.runs.map((r) => r.task).join("|"));
check("each start is an assign move", st.moves.filter((m) => m.kind === "assign").length === 3);

console.log("\nWaiting and finishing");
t += 1000;
org.ingest({ hook_event_name: "PermissionRequest", session_id: S, agent_type: "so-hoa", agent_id: "a2", tool_name: "Bash" });
st = org.state([{ ...running[0]!, status: "waiting" }]);
check("a permission ask inside a subagent turns that run amber", st.runs.find((r) => r.id === "a2")?.state === "wait");
check("…and not the Manager", st.manager.state === "on");
org.ingest({ hook_event_name: "PreToolUse", session_id: S, agent_id: "a2", agent_type: "so-hoa", tool_name: "Bash" });
check("a tool call in the same breath keeps it waiting", org.state(running).runs.find((r) => r.id === "a2")?.state === "wait");
t += 3000;
org.ingest({ hook_event_name: "PostToolUse", session_id: S, agent_id: "a2", agent_type: "so-hoa", tool_name: "Bash" });
check("a later tool call means it was answered", org.state(running).runs.find((r) => r.id === "a2")?.state === "on");
org.ingest({ hook_event_name: "SubagentStop", session_id: S, agent_type: "so-hoa", agent_id: "a1" });
st = org.state(running);
check("SubagentStop ends that run only", st.runs.map((r) => r.id).join(",") === "a2,a3");
check("…as a report move", st.moves.at(-1)?.kind === "report" && st.moves.at(-1)?.agentType === "so-hoa");
org.ingest({ hook_event_name: "SubagentStop", session_id: S, agent_type: "so-hoa" });
check("without agent_id the newest run of that type ends", org.state(running).runs.map((r) => r.id).join(",") === "a2");

console.log("\nThe Manager waiting, errors");
org.ingest({ hook_event_name: "SubagentStop", session_id: S, agent_type: "so-hoa", agent_id: "a2" });
st = org.state([{ ...running[0]!, status: "waiting" }]);
check("the session waiting with no subagent asking: the Manager waits", st.manager.state === "wait");
org.ingest({ hook_event_name: "PreToolUse", session_id: S, tool_name: "Agent", tool_input: { subagent_type: "thu-thu", description: "Tra văn bản" } });
org.ingest({ hook_event_name: "SubagentStart", session_id: S, agent_type: "thu-thu", agent_id: "b1" });
org.ingest({ hook_event_name: "StopFailure", session_id: S, error: "You've hit your session limit · resets 6:30pm" });
st = org.state(idle);
check("an error turns the session's runs red", st.runs.length === 1 && st.runs[0]!.state === "err");
check("…and the Manager red with the error", st.manager.state === "err" && st.manager.task.includes("session limit"), st.manager.task);
t += 11 * 60_000;
st = org.state(idle);
check("red lamps go out after a while", st.runs.length === 0 && st.manager.state === "off");
org.ingest({ hook_event_name: "UserPromptSubmit", session_id: S, prompt: "tiếp tục" });
check("a new prompt clears the error", org.state(running).manager.state === "on");

console.log("\nBefore any hook");
const early = new OrgTracker({ now, cwd: "/vault", listAgents: (cwd) => (cwd === "/vault" ? ["thu-thu"] : []) });
check("the office's work folder gives the departments before the first hook", early.state([]).agents.join(",") === "thu-thu");
early.ingest({ hook_event_name: "PreToolUse", session_id: "E", cwd: "/elsewhere", tool_name: "Bash" });
check("a hook from another folder does not hide them", early.state([]).agents.join(",") === "thu-thu");

console.log("\nPrompts hidden");
const quiet = new OrgTracker({ now, showPrompts: false });
quiet.ingest({ hook_event_name: "UserPromptSubmit", session_id: S, prompt: "bí mật" });
quiet.ingest({ hook_event_name: "PreToolUse", session_id: S, tool_name: "Agent", tool_input: { subagent_type: "qa", description: "Kiểm tra bí mật" } });
quiet.ingest({ hook_event_name: "SubagentStart", session_id: S, agent_type: "qa" });
st = quiet.state(running);
check("no prompt or task text leaks", !JSON.stringify(st).includes("bí mật"), JSON.stringify(st));

console.log("\nIn the live source's snapshot");
const live = new LiveAgentBackend({ autoTick: false, now, listAgents: () => ["thu-thu"] });
await live.connect();
live.ingest({ hook_event_name: "UserPromptSubmit", session_id: "L", cwd: "/vault", prompt: "Bổ sung văn bản" });
live.ingest({ hook_event_name: "PreToolUse", session_id: "L", tool_name: "Agent", tool_input: { subagent_type: "thu-thu", description: "Bổ sung văn bản" } });
live.ingest({ hook_event_name: "SubagentStart", session_id: "L", agent_type: "thu-thu", agent_id: "x" });
const snap = live.getSnapshot();
check("the snapshot has the org chart", snap.org?.runs.length === 1 && snap.org.runs[0]!.agentType === "thu-thu" && snap.org.agents.includes("thu-thu"));
check("the Manager is on", snap.org?.manager.state === "on");
await live.disconnect();

console.log(failures === 0 ? "\nAll org chart checks passed." : `\n${failures} org chart check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
