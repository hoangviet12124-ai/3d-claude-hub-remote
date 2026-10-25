import type { AgentId, AgentProfile } from "./agentTypes.ts";
import type { WorkflowPhase } from "../tasks/taskTypes.ts";
import type { LocationId } from "../simulation/worldLayout.ts";

export const AGENTS: AgentProfile[] = [
  // Tổ giúp việc, giai đoạn 1. Mã nội bộ (orion, iris...) giữ nguyên để không phải sửa phần nối hook; chỉ đổi tên hiển thị.
  { id: "orion", name: "Manager", role: "orchestrator", roleLabel: "Điều phối", tagline: "Nhận việc, lập Phiếu giao việc, tổng hợp gửi anh Việt", color: "#5A8DEE", home: "hub", seat: 0 },
  { id: "iris", name: "Thủ thư", role: "researcher", roleLabel: "Kho dữ liệu chung", tagline: "Tra văn bản còn hiệu lực theo ngày thủ tục, tra Lịch sử làm việc", color: "#4FBF7A", home: "research", seat: 1 },
  { id: "piper", name: "Số hóa", role: "product_manager", roleLabel: "Số hóa hồ sơ", tagline: "Chuyển PDF, Word sang markdown, giữ bản gốc", color: "#3FB6C4", home: "product", seat: 2 },
  { id: "kai", name: "KT XDCB", role: "engineer", roleLabel: "Trưởng phòng Kiểm toán XDCB", tagline: "Kiểm tra hồ sơ đầu tư xây dựng, đấu thầu, bảo trì; soạn bản nháp", color: "#E8963A", home: "dev", seat: 3 },
  { id: "quinn", name: "QA", role: "qa", roleLabel: "Kiểm tra độc lập", tagline: "Chấm bản nháp theo tiêu chí nghiệm thu, đối chiếu nguồn", color: "#F06A6A", home: "testing", seat: 4 },
  { id: "rex", name: "Thư ký R&D", role: "reviewer", roleLabel: "Rút kinh nghiệm", tagline: "Lập Biên bản rút kinh nghiệm, ghi Sổ bài học", color: "#A78BFA", home: "review", seat: 5 },
];

export const AGENT_IDS: AgentId[] = AGENTS.map((a) => a.id);

const BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

export function getAgent(id: AgentId): AgentProfile {
  const a = BY_ID.get(id);
  if (!a) throw new Error(`Unknown agent ${id}`);
  return a;
}

/** Who owns each phase, and where they stand to do it. `done` is Orion's finalize step. */
export const PHASE_OWNER: Partial<Record<WorkflowPhase, { agent: AgentId; location: LocationId }>> = {
  intake: { agent: "orion", location: "hub" },
  planning: { agent: "piper", location: "planning" },
  research: { agent: "iris", location: "research" },
  implementation: { agent: "kai", location: "dev" },
  testing: { agent: "quinn", location: "testing" },
  review: { agent: "rex", location: "review" },
  done: { agent: "orion", location: "hub" },
};

export const STATION_OWNERS: Partial<Record<LocationId, AgentId>> = {
  ops: "orion",
  research: "iris",
  product: "piper",
  dev: "kai",
  testing: "quinn",
  review: "rex",
};
