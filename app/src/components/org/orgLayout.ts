// The org chart's layout (sơ đồ), worked out from the live OrgState. Pure: no React, no DOM.
//
// Work flows left to right on a fixed 1100-wide stage: Boss → Manager (QA below it) → one framed group per
// department → round staff dots. Departments are built from the agent files in .claude/agents, so adding an
// agent file adds its department; nothing is drawn for a department the team does not have yet.
import type { OrgLamp, OrgRun, OrgState } from "@/integrations/AgentBackend";

export const STAGE_W = 1100;
const ROW = 120;
const CARD_H = 56;
/** Staff dots per department; more runs than this show as "+k" on the last dot. */
export const DOTS = 3;

export type Lamp = OrgLamp | "done";
export type IconName = "boss" | "hub" | "shield" | "build" | "coins" | "flow" | "pen" | "flask" | "db" | "scan" | "bulb" | "more";

interface Dept {
  key: string;
  label: string;
  head: string;
  staff: string;
  icon: IconName;
  acc: string;
  match: RegExp;
}

/** Order matters: the first match wins (quy-trinh before tai-chinh, so "kiem-toan-tai-chinh-quy-trinh" lands right). */
const DEPTS: Dept[] = [
  { key: "xdcb", label: "Kiểm toán XDCB", head: "Trưởng phòng", staff: "Kiểm toán viên", icon: "build", acc: "#60a5fa", match: /xdcb/ },
  { key: "quytrinh", label: "KT tài chính & quy trình", head: "Trưởng phòng", staff: "Chuyên viên", icon: "flow", acc: "#facc15", match: /quy-trinh/ },
  { key: "tc", label: "Tài chính", head: "Trưởng nhóm", staff: "Chuyên viên", icon: "coins", acc: "#f472b6", match: /tai-chinh/ },
  { key: "gopy", label: "Góp ý văn bản", head: "Trưởng phòng", staff: "Chuyên viên", icon: "pen", acc: "#e879f9", match: /gop-y/ },
  { key: "kho", label: "Kho dữ liệu chung", head: "Thủ thư", staff: "Số hóa", icon: "db", acc: "#2dd4bf", match: /thu-thu|so-hoa/ },
  { key: "nc", label: "Nghiên cứu & Phương pháp", head: "Trưởng phòng", staff: "Nghiên cứu viên", icon: "flask", acc: "#a78bfa", match: /nghien-cuu|phuong-phap|chuyen-de/ },
  { key: "rnd", label: "R&D", head: "Thư ký R&D", staff: "Kỹ sư", icon: "bulb", acc: "#fb923c", match: /rnd|r-d|cai-tien|thu-ky/ },
];
const OTHER: Dept = { key: "khac", label: "Trợ lý khác", head: "Trợ lý", staff: "Trợ lý", icon: "more", acc: "#94a3b8", match: /$^/ };
const QA_MATCH = /^qa$|^qa-|-qa$|kiem-tra/;
const SOHOA_MATCH = /so-hoa/;

/** Which card an agent type's runs light: "qa", "sohoa", or a department key. */
export function unitOf(agentType: string): string {
  const t = agentType.toLowerCase();
  if (QA_MATCH.test(t)) return "qa";
  if (SOHOA_MATCH.test(t)) return "sohoa";
  return (DEPTS.find((d) => d.match.test(t)) ?? OTHER).key;
}

/** A readable name for an agent type: its department ("Kiểm toán XDCB"), or the file name when it has none. */
export function displayName(agentType: string): string {
  const u = unitOf(agentType);
  if (u === "qa") return "QA";
  if (u === "sohoa") return "Số hóa";
  if (u === "kho") return "Thủ thư";
  if (u === "rnd") return "R&D";
  const d = DEPTS.find((x) => x.key === u);
  return d ? d.label : agentType;
}

/** The cards a flow passes from the Manager to the card of that agent type. */
export function pathTo(agentType: string): string[] {
  const u = unitOf(agentType);
  return u === "sohoa" ? ["mgr", "kho", "sohoa"] : ["mgr", u];
}

export interface CardNode {
  kind: "card";
  id: string;
  x: number;
  y: number;
  w: number;
  title: string;
  icon: IconName;
  acc: string;
  idle: string;
  state: Lamp;
  status: string;
  tip: string;
  group?: string;
  ports: { in: boolean; out: boolean; down?: boolean; up?: boolean };
}

export interface DotNode {
  kind: "dot";
  id: string;
  cx: number;
  cy: number;
  num: string;
  label: string;
  acc: string;
  state: Lamp;
  tip: string;
  group: string;
}

export interface GroupBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  acc: string;
  busy: boolean;
}

export interface Edge {
  key: string;
  from: string;
  to: string;
  d: string;
  acc: string;
  sub: boolean;
  live: boolean;
}

export interface OrgLayout {
  height: number;
  cards: CardNode[];
  dots: DotNode[];
  groups: GroupBox[];
  edges: Edge[];
  counts: { on: number; wait: number; err: number };
  /** No agent file and nothing running: only Boss and the Manager are drawn. */
  empty: boolean;
}

const WORST: Record<OrgLamp, number> = { off: 0, on: 1, wait: 2, err: 3 };
function worst(runs: OrgRun[]): OrgLamp {
  let s: OrgLamp = "off";
  for (const r of runs) if (WORST[r.state] > WORST[s]) s = r.state;
  return s;
}

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(36, (x2 - x1) * 0.5);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
};

function statusOf(state: OrgLamp, task: string, idle: string, raw = false): string {
  if (state === "off") return idle;
  if (raw) return task;
  if (state === "wait") return task ? `chờ duyệt: ${task}` : "chờ duyệt";
  if (state === "err") return task || "lỗi";
  return task || "đang làm";
}

const STATE_TEXT: Record<Lamp, string> = { off: "rảnh", on: "đang làm", wait: "chờ duyệt", err: "lỗi", done: "xong" };

/**
 * One unit (a department head, Số hóa, QA): one run lights the card with its task; two or more light it with
 * "N việc cùng lúc" and hand one dot to each run.
 */
function unitLamp(runs: OrgRun[]): { state: OrgLamp; task: string; raw: boolean } {
  const state = worst(runs);
  if (runs.length === 0) return { state, task: "", raw: false };
  if (runs.length === 1) return { state, task: runs[0]!.task || runs[0]!.agentType, raw: false };
  const n = runs.length;
  const some = runs.filter((r) => r.state === state).length;
  if (state === "wait") return { state, task: `${some}/${n} chờ duyệt`, raw: true };
  if (state === "err") return { state, task: `${some}/${n} lỗi`, raw: true };
  return { state, task: `${n} việc cùng lúc`, raw: true };
}

/** `flash`: cards and dots that just finished (lit green for a moment). */
export function layoutOrg(org: OrgState, flash: ReadonlySet<string> = new Set()): OrgLayout {
  const byUnit = new Map<string, OrgRun[]>();
  for (const r of org.runs) {
    const u = unitOf(r.agentType);
    byUnit.set(u, [...(byUnit.get(u) ?? []), r]);
  }
  const haveUnit = new Set<string>([...org.agents.map(unitOf), ...byUnit.keys()]);
  const deptKeys = new Set<string>();
  for (const u of haveUnit) if (u !== "qa") deptKeys.add(u === "sohoa" ? "kho" : u);
  const depts = [...DEPTS, OTHER].filter((d) => deptKeys.has(d.key));

  const rows = depts.length;
  const height = Math.max(380, rows * ROW + 24);
  const cards: CardNode[] = [];
  const dots: DotNode[] = [];
  const groups: GroupBox[] = [];
  const edges: Edge[] = [];
  const lit = (s: Lamp) => s === "on" || s === "wait";
  const flashed = (id: string, s: OrgLamp): Lamp => (s === "off" && flash.has(id) ? "done" : s);

  // Boss and the Manager sit in the middle of the rows; QA hangs below the Manager.
  const midY = Math.round(height / 2 - CARD_H / 2) - (haveUnit.has("qa") ? 50 : 0);
  const boss: CardNode = {
    kind: "card", id: "boss", x: 30, y: midY, w: 140, title: "Boss", icon: "boss", acc: "#fcd34d", idle: "giao việc",
    state: flash.has("boss:on") ? "on" : flash.has("boss") ? "done" : "off", status: "", tip: "", ports: { in: false, out: true },
  };
  boss.status = boss.state === "on" ? "giao việc" : boss.state === "done" ? "nhận kết quả" : boss.idle;
  boss.tip = `Boss: ${boss.status}`;
  const mState = flashed("mgr", org.manager.state);
  const mgr: CardNode = {
    kind: "card", id: "mgr", x: 230, y: midY, w: 170, title: "Manager", icon: "hub", acc: "#5fd4ff", idle: "rảnh",
    state: mState, status: mState === "done" ? "xong" : statusOf(org.manager.state, org.manager.task, "rảnh"), tip: "",
    ports: { in: true, out: rows > 0, down: haveUnit.has("qa") },
  };
  mgr.tip = `Manager: ${STATE_TEXT[mgr.state]}${org.manager.task ? ` · ${org.manager.task}` : ""}`;
  cards.push(boss, mgr);
  edges.push({ key: "boss>mgr", from: "boss", to: "mgr", d: curve(170, midY + 28, 230, midY + 28), acc: mgr.acc, sub: false, live: lit(mgr.state) });

  if (haveUnit.has("qa")) {
    const runs = byUnit.get("qa") ?? [];
    const l = unitLamp(runs);
    const state = flashed("qa", l.state);
    cards.push({
      kind: "card", id: "qa", x: 245, y: midY + 148, w: 140, title: "QA", icon: "shield", acc: "#a3e635", idle: "rảnh", state,
      status: state === "done" ? "xong" : statusOf(l.state, l.task, "rảnh", l.raw), tip: `QA: ${STATE_TEXT[state]}${l.task ? ` · ${l.task}` : ""}`,
      ports: { in: false, out: false, up: true },
    });
    edges.push({ key: "mgr>qa", from: "mgr", to: "qa", d: `M315,${midY + CARD_H} C315,${midY + 98} 315,${midY + 108} 315,${midY + 148}`, acc: "#a3e635", sub: true, live: lit(state) });
  }

  depts.forEach((dept, i) => {
    const yc = 70 + i * ROW;
    const hasSohoa = dept.key === "kho" && haveUnit.has("sohoa");
    const headRuns = byUnit.get(dept.key) ?? [];
    const sohoaRuns = hasSohoa ? (byUnit.get("sohoa") ?? []) : [];
    const head = unitLamp(headRuns);
    const headState = flashed(dept.key, head.state);
    const headCard: CardNode = {
      kind: "card", id: dept.key, x: 490, y: yc - 22, w: 170, title: dept.head, icon: dept.icon, acc: dept.acc, idle: "rảnh",
      state: headState, status: headState === "done" ? "xong" : statusOf(head.state, head.task, "rảnh", head.raw),
      tip: `${dept.label}: ${STATE_TEXT[headState]}${head.task ? ` · ${head.task}` : ""}`,
      group: dept.key, ports: { in: true, out: true },
    };
    cards.push(headCard);

    // Dots hang off Số hóa in the Kho row, off the head elsewhere.
    let parent = headCard;
    let staffRuns = headRuns;
    let staff = dept.staff;
    let sx = 760;
    if (hasSohoa) {
      const s = unitLamp(sohoaRuns);
      const st = flashed("sohoa", s.state);
      parent = {
        kind: "card", id: "sohoa", x: 720, y: yc - 22, w: 150, title: "Số hóa", icon: "scan", acc: "#22d3ee", idle: "rảnh", state: st,
        status: st === "done" ? "xong" : statusOf(s.state, s.task, "rảnh", s.raw), tip: `Số hóa: ${STATE_TEXT[st]}${s.task ? ` · ${s.task}` : ""}`,
        group: dept.key, ports: { in: true, out: true },
      };
      cards.push(parent);
      edges.push({ key: "kho>sohoa", from: "kho", to: "sohoa", d: curve(660, yc + 6, 720, yc + 6), acc: parent.acc, sub: false, live: lit(st) });
      staffRuns = sohoaRuns;
      staff = "Số hóa";
      sx = 930;
    } else if (dept.key === "kho") {
      staffRuns = []; // Thủ thư alone: several runs show on the card ("N việc cùng lúc"), there is no staff column.
      sx = 0;
    }

    const anyLit = [headCard.state, parent.state].some((s) => s !== "off" && s !== "done") || staffRuns.length > 0;
    groups.push({ key: dept.key, x: 470, y: yc - 54, w: 615, h: 108, label: dept.label, acc: dept.acc, busy: anyLit });
    const intoDept = hasSohoa && !lit(headCard.state) ? lit(parent.state) : lit(headCard.state);
    edges.push({ key: `mgr>${dept.key}`, from: "mgr", to: dept.key, d: curve(400, midY + 28, 490, yc + 6), acc: dept.acc, sub: false, live: intoDept });

    if (sx === 0) return;
    const shown = staffRuns.length >= 2 ? staffRuns : [];
    for (let j = 0; j < DOTS; j++) {
      const cy = yc + 6 + (j - 1) * 34;
      const id = `${parent.id}${j + 1}`;
      const run = shown[j];
      const overflow = j === DOTS - 1 && shown.length > DOTS ? shown.length - (DOTS - 1) : 0;
      let state: Lamp = run ? run.state : "off";
      if (overflow) state = worst(shown.slice(DOTS - 1));
      if (state === "off" && flash.has(id)) state = "done";
      const label = overflow ? `${overflow} việc nữa` : run ? run.task || run.agentType : `${staff} ${j + 1}`;
      dots.push({
        kind: "dot", id, cx: sx, cy, num: overflow ? `+${overflow}` : String(j + 1), label: state === "err" && run ? `Lỗi · ${label}` : label,
        acc: parent.acc, state, group: dept.key, tip: run ? `${run.agentType}: ${STATE_TEXT[state]}${run.task ? ` · ${run.task}` : ""}` : `${staff} ${j + 1}: rảnh`,
      });
      edges.push({ key: `${parent.id}>${id}`, from: parent.id, to: id, d: curve(parent.x + parent.w, yc + 6, sx - 13, cy), acc: parent.acc, sub: false, live: lit(state) });
    }
  });

  const counts = { on: 0, wait: 0, err: 0 };
  const tally = (s: OrgLamp) => {
    if (s !== "off") counts[s]++;
  };
  tally(org.manager.state);
  for (const r of org.runs) tally(r.state);
  return { height, cards, dots, groups, edges, counts, empty: rows === 0 && !haveUnit.has("qa") };
}
