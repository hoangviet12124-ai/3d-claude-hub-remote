import type { CreateTaskInput } from "./taskTypes.ts";

// Vụ việc mẫu cho chế độ mô phỏng của Tổ giúp việc. Tên gói thầu, dự án là ví dụ, không phải hồ sơ thật.
// Giai đoạn 1 chỉ phòng KT XDCB hoạt động, nên mọi vụ việc mẫu đều thuộc mảng kiểm toán XDCB.
export const HOTFIX_TITLE = "Kiểm tra hồ sơ lựa chọn nhà thầu gói thầu cải tạo sân đỗ (ví dụ)";
export const MIGRATION_TITLE = "Rà soát hồ sơ quyết toán hợp đồng bảo trì đường lăn (ví dụ)";

export const TASK_BACKLOG: CreateTaskInput[] = [
  { title: HOTFIX_TITLE, description: "Đối chiếu hồ sơ mời thầu, đánh giá hồ sơ dự thầu và kết quả lựa chọn nhà thầu với quy định còn hiệu lực tại ngày thực hiện thủ tục.", priority: "critical", script: { qaFailsOn: [1] } },
  { title: MIGRATION_TITLE, description: "Kiểm tra khối lượng, đơn giá và hồ sơ nghiệm thu trong bộ hồ sơ quyết toán; lập bảng dữ kiện có số trang.", priority: "high", script: { qaFailsOn: [1, 2, 3] } },
  { title: "Kiểm tra hồ sơ dự toán gói thầu sửa chữa nhà ga (ví dụ)", description: "Rà soát căn cứ lập dự toán, định mức và đơn giá áp dụng.", priority: "high" },
  { title: "Rà soát kế hoạch bảo trì kết cấu hạ tầng năm sau (ví dụ)", description: "Đối chiếu kế hoạch bảo trì với quy trình bảo trì và hiện trạng công trình.", priority: "medium" },
  { title: "Kiểm tra hồ sơ mua sắm vật tư bảo trì sân bay (ví dụ)", description: "Đối chiếu trình tự mua sắm và hồ sơ nghiệm thu vật tư với kế hoạch bảo trì.", priority: "medium" },
  { title: "Tra cứu văn bản hướng dẫn về chỉ định thầu (ví dụ)", description: "Lập danh sách văn bản còn hiệu lực và điều khoản liên quan.", priority: "low" },
  { title: "Kiểm tra hồ sơ thanh toán hợp đồng tư vấn giám sát (ví dụ)", description: "Đối chiếu giá trị đề nghị thanh toán với hợp đồng và biên bản nghiệm thu.", priority: "medium" },
  { title: "Tổng hợp phát hiện kiểm toán quý (ví dụ)", description: "Gom các phát hiện đã chốt trong Lịch sử làm việc thành bảng tổng hợp.", priority: "low" },
  { title: "Kiểm tra đơn giá vật liệu trong dự toán nâng cấp đường cất hạ cánh (ví dụ)", description: "Đối chiếu đơn giá vật liệu với công bố giá địa phương tại thời điểm lập dự toán.", priority: "high" },
  { title: "Rà soát hồ sơ mua sắm thiết bị phòng cháy nhà ga (ví dụ)", description: "Kiểm tra trình tự mua sắm, dự toán gói thầu và kết quả lựa chọn nhà thầu.", priority: "medium" },
  { title: "Kiểm tra nhật ký bảo trì hệ thống đèn tiếp cận (ví dụ)", description: "Đối chiếu nhật ký bảo trì với kế hoạch và quy trình bảo trì được duyệt.", priority: "medium" },
  { title: "Rà soát điều khoản thanh toán trong hợp đồng thi công nhà ga (ví dụ)", description: "Đối chiếu điều khoản tạm ứng, thanh toán, quyết toán với hồ sơ thực tế.", priority: "low" },
  { title: "Kiểm tra hồ sơ phát sinh khối lượng gói thầu xây lắp nhà để xe (ví dụ)", description: "Xác định căn cứ, thẩm quyền phê duyệt và cách tính giá trị khối lượng phát sinh.", priority: "high" },
  { title: "Rà soát hồ sơ quyết toán dự án hoàn thành hạ tầng kỹ thuật (ví dụ)", description: "Kiểm tra thành phần hồ sơ quyết toán và đối chiếu giá trị với hợp đồng.", priority: "medium" },
  { title: "Tổng hợp phát hiện lặp lại từ các cuộc kiểm toán năm trước (ví dụ)", description: "Tìm phát hiện xuất hiện nhiều lần để đề xuất rút kinh nghiệm.", priority: "low" },
  { title: "Kiểm tra định mức áp dụng cho công tác sửa chữa mặt đường (ví dụ)", description: "Đối chiếu mã định mức trong dự toán với nội dung công việc thực tế.", priority: "medium" },
];

const SPRINT_TITLES = [
  HOTFIX_TITLE,
  MIGRATION_TITLE,
  "Kiểm tra hồ sơ dự toán gói thầu sửa chữa nhà ga (ví dụ)",
  "Rà soát kế hoạch bảo trì kết cấu hạ tầng năm sau (ví dụ)",
  "Kiểm tra hồ sơ mua sắm vật tư bảo trì sân bay (ví dụ)",
  "Tra cứu văn bản hướng dẫn về chỉ định thầu (ví dụ)",
  "Kiểm tra hồ sơ thanh toán hợp đồng tư vấn giám sát (ví dụ)",
  "Tổng hợp phát hiện kiểm toán quý (ví dụ)",
];

export const SPRINT_TASKS: CreateTaskInput[] = SPRINT_TITLES.map((title) => {
  const t = TASK_BACKLOG.find((b) => b.title === title);
  if (!t) throw new Error(`Sprint task missing from backlog: ${title}`);
  return t;
});

export const TASK_SUGGESTIONS: string[] = TASK_BACKLOG.slice(2, 6).map((t) => t.title);

export function pickRandomTask(exclude: ReadonlySet<string> = new Set(), rng: () => number = Math.random): CreateTaskInput {
  const pool = TASK_BACKLOG.filter((t) => !exclude.has(t.title));
  const list = pool.length > 0 ? pool : TASK_BACKLOG;
  return list[Math.floor(rng() * list.length)]!;
}
