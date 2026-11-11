import type { Metadata } from "next";
import { OrgPage } from "./OrgPage";

export const metadata: Metadata = {
  title: "Sơ đồ Tổ giúp việc",
  description: "Sơ đồ đèn của Tổ giúp việc: ai đang làm, ai chờ duyệt, việc giao đi và nộp về.",
};

/** The org chart on its own, to keep open beside Antigravity or Claude Desktop. */
export default function Page() {
  return <OrgPage />;
}
