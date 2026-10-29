import type { LocationId, Vec2 } from "../simulation/worldLayout.ts";

/**
 * Mã nội bộ. Sáu mã đầu giữ từ bản gốc vì phần nối dữ liệu thật dùng chúng; các mã sau là của Tổ giúp việc.
 */
export type AgentId =
  | "orion"
  | "iris"
  | "piper"
  | "kai"
  | "quinn"
  | "rex"
  | "troly1"
  | "troly2"
  | "taichinh"
  | "quytrinh"
  | "gopy"
  | "chuyende"
  | "caitien";
export type AgentRole = "orchestrator" | "researcher" | "product_manager" | "engineer" | "qa" | "reviewer" | "assistant";

/** Thứ robot đang cầm: tài nguyên nghiên cứu lấy từ Kho, hoặc bộ báo cáo đưa sang QA. */
export type CarryKind = "docs" | "records" | "report";
export type AgentStatus = "idle" | "walking" | "working" | "thinking" | "communicating" | "success" | "error";

export interface AgentProfile {
  id: AgentId;
  name: string;
  role: AgentRole;
  roleLabel: string;
  tagline: string;
  color: string;
  home: LocationId;
  seat: number;
  /** false: chưa có mô tả chức năng, nhiệm vụ; trong mô phỏng chỉ đi dạo. */
  active: boolean;
}

/** Serialisable; a real backend sends the same shape. */
export interface AgentState {
  id: AgentId;
  status: AgentStatus;
  activity: string;
  currentTaskId: string | null;
  progress: number;
  location: LocationId | null;
  destination: LocationId | null;
  position: Vec2;
  heading: number;
  path: Vec2[];
  facingAgentId: AgentId | null;
  paused: boolean;
  /** Optional: live backends that predate it leave it out. */
  carrying?: CarryKind | null;
}
