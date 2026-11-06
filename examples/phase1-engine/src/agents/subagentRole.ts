import type { AgentId } from "./agentTypes.ts";

/**
 * Which robot a Claude Code subagent is, from the name of its agent file in .claude/agents (Tổ giúp việc, Ma trận
 * phân vai 1.1). Agents with no room of their own (general-purpose, Explore, a new file not listed here) are shown
 * on Trợ lý 2. Used by the live source (who moves) and by the meeting board (who presents).
 */
export function subagentRole(agentType: string): AgentId {
  const t = agentType.toLowerCase();
  if (/^qa\b|kiem-tra/.test(t)) return "quinn";
  if (/truong-phong-xdcb|xdcb/.test(t)) return "kai";
  if (/thu-thu/.test(t)) return "iris";
  if (/so-hoa/.test(t)) return "piper";
  if (/thu-ky-rnd|rnd/.test(t)) return "rex";
  if (/ky-su-cai-tien|cai-tien/.test(t)) return "caitien";
  if (/nghien-cuu|phuong-phap|chuyen-de/.test(t)) return "chuyende";
  if (/tai-chinh/.test(t)) return "taichinh";
  if (/quy-trinh/.test(t)) return "quytrinh";
  if (/gop-y/.test(t)) return "gopy";
  if (/tom-tat/.test(t)) return "troly1";
  return "troly2";
}
