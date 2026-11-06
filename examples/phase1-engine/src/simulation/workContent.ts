// Canned work output. Nothing here is generated: templates are picked by regex on the task text.

export interface WorkTemplate {
  key: string;
  match: RegExp;
  subtasks: string[];
  findings: string[];
  tests: string[];
  reviewNotes: string[];
}

// Mẫu nội dung cho vụ việc của Tổ giúp việc. Không trích số hiệu văn bản cụ thể để tránh hiểu nhầm là căn cứ thật.
// subtasks: hạng mục KT XDCB làm; findings: Thủ thư tra được; tests: tiêu chí QA chấm; reviewNotes: bài học Thư ký R&D ghi.
// Không dùng \b vì \b của JavaScript không nhận chữ có dấu.
export const WORK_TEMPLATES: WorkTemplate[] = [
  {
    key: "dutoan",
    match: /dự toán|định mức|đơn giá/i,
    subtasks: ["Lập Bảng dữ kiện: hạng mục, khối lượng, đơn giá, số trang", "Đối chiếu căn cứ lập dự toán", "Kiểm tra định mức và đơn giá áp dụng", "Kiểm tra khối lượng so với thiết kế", "Soạn bản nháp phát hiện"],
    findings: ["Đã lọc văn bản về quản lý chi phí còn hiệu lực tại ngày lập dự toán", "Có bản công bố giá địa phương cùng kỳ trong Kho", "Lịch sử làm việc có một vụ việc dự toán tương tự để tham khảo"],
    tests: ["mỗi phát hiện có tên file và số trang", "đơn giá đối chiếu đúng kỳ công bố", "trích dẫn đúng điều khoản còn hiệu lực"],
    reviewNotes: ["Ghi rõ kỳ công bố giá ngay trong Bảng dữ kiện", "Thêm bước kiểm tra hiệu lực văn bản trước khi soạn nháp"],
  },
  {
    key: "quyettoan",
    match: /quyết toán|thanh toán|hợp đồng/i,
    subtasks: ["Lập Bảng dữ kiện từ hồ sơ thanh toán, quyết toán", "Đối chiếu giá trị với hợp đồng và phụ lục", "Kiểm tra biên bản nghiệm thu khối lượng", "Kiểm tra điều kiện thanh toán theo hợp đồng", "Soạn bản nháp phát hiện"],
    findings: ["Đã tra điều khoản thanh toán trong hợp đồng và phụ lục", "Đã lọc văn bản về hợp đồng xây dựng còn hiệu lực tại ngày ký", "Không có vụ việc cũ cùng hợp đồng trong Lịch sử làm việc"],
    tests: ["giá trị đề nghị khớp biên bản nghiệm thu", "mỗi chênh lệch có bảng tính kèm nguồn", "trích dẫn hợp đồng đúng điều, đúng phụ lục"],
    reviewNotes: ["Đưa bước đối chiếu phụ lục hợp đồng lên trước", "Bảng dữ kiện cần cột ngày ký từng phụ lục"],
  },
  {
    key: "gopy",
    match: /góp ý|dự thảo|quy chế/i,
    subtasks: ["Số hóa dự thảo và văn bản hiện hành", "Lập bảng so sánh từng điều", "Đánh dấu điểm chưa thống nhất", "Đề xuất cách sửa", "Soạn bản góp ý"],
    findings: ["Đã tìm được văn bản hiện hành tương ứng trong Kho", "Có hai văn bản đang sửa đổi cùng nội dung", "Góp ý lần trước đã lưu trong Lịch sử làm việc"],
    tests: ["mỗi ý góp có điều khoản dự thảo và điều khoản hiện hành", "không góp ý dựa trên văn bản ngoài Kho", "văn phong hành chính, ngắn gọn"],
    reviewNotes: ["Cần skill góp ý văn bản riêng", "Mẫu bảng so sánh nên cố định cột"],
  },
  {
    key: "tonghop",
    match: /tổng hợp|phát hiện/i,
    subtasks: ["Lọc vụ việc đã chốt theo kỳ", "Gom phát hiện theo nhóm", "Đếm số lần lặp", "Lập bảng tổng hợp", "Soạn nhận xét chung"],
    findings: ["Lịch sử làm việc có đủ bản tóm tắt các vụ việc trong kỳ", "Hai nhóm phát hiện lặp lại từ kỳ trước", "Tri thức chung có danh mục nhóm phát hiện đã duyệt"],
    tests: ["mỗi dòng tổng hợp dẫn về bản tóm tắt gốc", "số liệu cộng khớp", "không đưa vụ việc chưa chốt"],
    reviewNotes: ["Thủ thư nên gắn nhãn nhóm phát hiện ngay khi lưu"],
  },
  {
    key: "baotri",
    match: /bảo trì|sửa chữa|kết cấu hạ tầng/i,
    subtasks: ["Lập Bảng dữ kiện từ kế hoạch và quy trình bảo trì", "Đối chiếu hạng mục với hiện trạng", "Kiểm tra tần suất bảo trì theo quy trình", "Kiểm tra dự toán bảo trì", "Soạn bản nháp phát hiện"],
    findings: ["Đã tra quy trình bảo trì công trình trong Kho", "Đã lọc văn bản về bảo trì công trình còn hiệu lực", "Lịch sử làm việc có kết quả kiểm tra bảo trì năm trước"],
    tests: ["hạng mục bảo trì khớp quy trình được duyệt", "mỗi phát hiện có nguồn và số trang", "trích dẫn đúng văn bản còn hiệu lực"],
    reviewNotes: ["Lưu kết quả năm trước vào Tri thức chung để so sánh"],
  },
  {
    key: "dauthau",
    match: /thầu|mua sắm/i,
    subtasks: ["Lập Bảng dữ kiện từ hồ sơ mời thầu và hồ sơ dự thầu", "Kiểm tra kế hoạch lựa chọn nhà thầu", "Kiểm tra tiêu chuẩn đánh giá", "Kiểm tra báo cáo đánh giá và kết quả", "Soạn bản nháp phát hiện"],
    findings: ["Đã lọc văn bản về đấu thầu còn hiệu lực tại ngày phát hành hồ sơ mời thầu", "Tri thức chung có danh mục kiểm tra hồ sơ lựa chọn nhà thầu", "Lịch sử làm việc không có vụ việc cùng gói thầu"],
    tests: ["mỗi phát hiện có tên file và số trang", "trích dẫn đúng điều khoản còn hiệu lực tại ngày thủ tục", "không kết luận mức độ nghiêm trọng thay người dùng"],
    reviewNotes: ["Ghi ngày thực hiện thủ tục ngay đầu Phiếu giao việc", "Thêm mục kiểm tra hiệu lực văn bản vào danh mục"],
  },
];

export const GENERIC_TEMPLATE: WorkTemplate = {
  key: "generic",
  match: /.*/,
  subtasks: ["Làm rõ mục đích và tiêu chí nghiệm thu", "Lập Bảng dữ kiện", "Thực hiện phần việc chính", "Tự kiểm tra trước khi nộp", "Soạn Báo cáo ngược"],
  findings: ["Đã tra Kho dữ liệu chung theo từ khóa của vụ việc", "Chưa có vụ việc tương tự trong Lịch sử làm việc", "Không cần văn bản ngoài Kho"],
  tests: ["có nguồn cho mỗi nhận định", "tách rõ điều đã kiểm chứng và điều suy luận", "đúng mẫu sản phẩm trong phiếu"],
  reviewNotes: ["Ghi lại bước làm mất nhiều thời gian nhất"],
};

export function templateFor(title: string, description = ""): WorkTemplate {
  const text = `${title} ${description}`;
  return WORK_TEMPLATES.find((t) => t.match.test(text)) ?? GENERIC_TEMPLATE;
}

export function shortTitle(title: string, max = 42): string {
  return title.length <= max ? title : `${title.slice(0, max - 1).trimEnd()}…`;
}
