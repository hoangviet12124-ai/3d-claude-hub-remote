import type { AgentId } from "../agents/agentTypes.ts";
import { isTerminal } from "../simulation/WorkflowStateMachine.ts";
import type { CreateTaskInput, Task } from "./taskTypes.ts";

export const DEMO_TASK: CreateTaskInput = {
  title: "Kiểm tra hồ sơ gói thầu mua sắm thiết bị soi chiếu (ví dụ)",
  description: "Đối chiếu hồ sơ mời thầu, báo cáo đánh giá và kết quả lựa chọn nhà thầu với quy định còn hiệu lực tại ngày thủ tục.",
  priority: "high",
  isDemo: true,
  script: { qaFailsOn: [1], reviewChangesOn: [] },
};

export const activeTasks = (tasks: readonly Task[]) => tasks.filter((t) => t.phase !== "queued" && !isTerminal(t.phase));
export const queuedTasks = (tasks: readonly Task[]) => tasks.filter((t) => t.phase === "queued");
export const doneTasks = (tasks: readonly Task[]) => tasks.filter((t) => isTerminal(t.phase));
export const tasksForAgent = (tasks: readonly Task[], id: AgentId) => tasks.filter((t) => t.assignedAgentId === id);
