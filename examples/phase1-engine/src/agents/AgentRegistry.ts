import type { AgentId, AgentProfile } from "./agentTypes.ts";
import type { WorkflowPhase } from "../tasks/taskTypes.ts";
import type { LocationId } from "../simulation/worldLayout.ts";

export const AGENTS: AgentProfile[] = [
  // Tổ giúp việc. Mã nội bộ (orion, iris...) giữ nguyên để không phải sửa phần nối hook; chỉ đổi tên hiển thị.
  // Giai đoạn 1: sáu vai đang làm việc, cộng hai trợ lý (subagent) của phòng KT XDCB.
  { id: "orion", name: "Manager", role: "orchestrator", roleLabel: "Điều phối", tagline: "Nhận việc từ anh Việt, họp giao việc với trưởng phòng và QA, tổng hợp gửi anh duyệt", color: "#5A8DEE", home: "hub", seat: 0, active: true },
  { id: "quinn", name: "QA", role: "qa", roleLabel: "Kiểm tra độc lập", tagline: "Dự họp giao việc để thống nhất tiêu chí; chấm báo cáo, đối chiếu nguồn", color: "#F06A6A", home: "testing", seat: 1, active: true },
  { id: "kai", name: "KT XDCB", role: "engineer", roleLabel: "Trưởng phòng Kiểm toán XDCB (bản a, b)", tagline: "Rà hồ sơ XDCB, đấu thầu theo quy trình chuẩn, soạn báo cáo kết quả", color: "#E8963A", home: "dev", seat: 2, active: true },
  { id: "troly1", name: "Trợ lý 1", role: "assistant", roleLabel: "Tóm tắt vụ việc", tagline: "Agent tom-tat-vu-viec: tóm tắt hồ sơ vụ việc cho Manager", color: "#F4C27A", home: "bot1", seat: 3, active: true },
  { id: "troly2", name: "Trợ lý 2", role: "assistant", roleLabel: "Trích dữ kiện · việc chung", tagline: "Agent trich-du-kien (Bảng dữ kiện), và các agent chưa có phòng riêng", color: "#C9773F", home: "bot2", seat: 4, active: true },
  { id: "iris", name: "Thủ thư", role: "researcher", roleLabel: "Kho lưu trữ · văn bản", tagline: "Tra văn bản còn hiệu lực theo ngày thủ tục, giao cho trợ lý", color: "#4FBF7A", home: "research", seat: 5, active: true },
  { id: "piper", name: "Số hóa", role: "product_manager", roleLabel: "Kho lưu trữ · hồ sơ cũ", tagline: "Chuyển PDF, Word, bản scan sang markdown (so-hoa, so-hoa-scan)", color: "#3FB6C4", home: "product", seat: 6, active: true },
  { id: "rex", name: "Thư ký R&D", role: "reviewer", roleLabel: "Rút kinh nghiệm", tagline: "Ghi Sổ bài học sau mỗi vụ việc", color: "#A78BFA", home: "review", seat: 7, active: true },
  // Chưa có mô tả chức năng, nhiệm vụ: trong mô phỏng chỉ đi dạo.
  { id: "taichinh", name: "Tài chính", role: "engineer", roleLabel: "Chuyên viên Tài chính (bản a, b)", tagline: "Phân tích báo cáo tài chính, công nợ", color: "#D4B44A", home: "fin", seat: 8, active: true },
  { id: "quytrinh", name: "KT TC & QT", role: "engineer", roleLabel: "Trưởng phòng KT tài chính & quy trình · chưa giao nhiệm vụ", tagline: "Chưa có mô tả chức năng, nhiệm vụ", color: "#5BC0A8", home: "proc", seat: 9, active: false },
  { id: "gopy", name: "Góp ý VB", role: "engineer", roleLabel: "Trưởng phòng Góp ý văn bản · chưa giao nhiệm vụ", tagline: "Chưa có mô tả chức năng, nhiệm vụ", color: "#E07AB0", home: "draft", seat: 10, active: false },
  { id: "chuyende", name: "NC & Phương pháp", role: "engineer", roleLabel: "Trưởng phòng Nghiên cứu và Phương pháp", tagline: "Nghiên cứu chuyên đề, quy trình chuẩn và phương pháp kiểm toán", color: "#8FA8D8", home: "study", seat: 11, active: true },
  { id: "caitien", name: "Kỹ sư cải tiến", role: "product_manager", roleLabel: "R&D · cải tiến", tagline: "Định kỳ đọc Sổ nguồn lực và bài học, đề xuất cải tiến quy trình, skill, model", color: "#C084FC", home: "ops", seat: 12, active: true },
];

export const AGENT_IDS: AgentId[] = AGENTS.map((a) => a.id);

const BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

export function getAgent(id: AgentId): AgentProfile {
  const a = BY_ID.get(id);
  if (!a) throw new Error(`Unknown agent ${id}`);
  return a;
}

/**
 * Who owns each phase, and where they stand to do it. Luồng của Tổ: Manager họp giao việc (intake), KT XDCB lập
 * kế hoạch (planning), trợ lý lấy tài liệu ở Kho (research), KT XDCB soạn báo cáo (implementation), QA chấm
 * (testing), Manager tổng hợp gửi anh Việt (review), Thư ký R&D ghi bài học (done).
 */
export const PHASE_OWNER: Partial<Record<WorkflowPhase, { agent: AgentId; location: LocationId }>> = {
  intake: { agent: "orion", location: "collab" },
  planning: { agent: "kai", location: "planning" },
  research: { agent: "troly1", location: "kho_vb" },
  implementation: { agent: "kai", location: "dev" },
  testing: { agent: "quinn", location: "testing" },
  review: { agent: "orion", location: "hub" },
  done: { agent: "rex", location: "review" },
};

export const STATION_OWNERS: Partial<Record<LocationId, AgentId>> = {
  research: "iris",
  product: "piper",
  testing: "quinn",
  review: "rex",
  ops: "caitien",
  dev: "kai",
  bot1: "troly1",
  bot2: "troly2",
  fin: "taichinh",
  proc: "quytrinh",
  draft: "gopy",
  study: "chuyende",
};
