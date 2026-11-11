// The org chart's layout (npm run test:org): departments come from the agent files, runs light the right lamps.
import { displayName, layoutOrg, pathTo, unitOf } from "../src/components/org/orgLayout.ts";
import type { OrgState } from "../src/integrations/AgentBackend.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const agents = ["qa", "thu-thu", "so-hoa", "truong-phong-xdcb", "truong-phong-xdcb-b", "chuyen-vien-tai-chinh-a", "truong-phong-nghien-cuu-phuong-phap", "ky-su-cai-tien"];
const base: OrgState = { agents, manager: { state: "off", task: "" }, runs: [], moves: [] };

console.log("\nDepartments");
check("agent files map to departments", unitOf("truong-phong-xdcb-b") === "xdcb" && unitOf("chuyen-vien-tai-chinh-a") === "tc" && unitOf("ky-su-cai-tien") === "rnd" && unitOf("so-hoa") === "sohoa" && unitOf("qa") === "qa");
check("an unknown agent goes to Trợ lý khác", unitOf("trich-du-kien") === "khac");
let l = layoutOrg(base);
check("one group per department the team has", l.groups.map((g) => g.key).join(",") === "xdcb,tc,kho,nc,rnd", l.groups.map((g) => g.key).join(","));
check("Số hóa sits in the Kho row with its own card", l.cards.some((c) => c.id === "sohoa" && c.group === "kho"));
check("QA is drawn under the Manager", l.cards.some((c) => c.id === "qa"));
check("a flow to Số hóa passes through Thủ thư", pathTo("so-hoa").join(">") === "mgr>kho>sohoa");
check("names in the log are readable", displayName("truong-phong-xdcb") === "Kiểm toán XDCB" && displayName("so-hoa") === "Số hóa");
check("nothing yet: only Boss and the Manager", layoutOrg({ ...base, agents: [] }).empty);

console.log("\nLamps");
const run = (id: string, agentType: string, task: string, state: "on" | "wait" | "err" = "on") => ({ id, agentType, task, state, since: 1 });
const tdBase = { ...base, agents: [...agents, "chuyen-gia-tham-dinh"] };
let td = layoutOrg(tdBase);
const tdCard = td.cards.find((c) => c.id === "td");
const qaCard = td.cards.find((c) => c.id === "qa")!;
check("Chuyên gia thẩm định hangs under QA, not in a department", unitOf("chuyen-gia-tham-dinh") === "td" && !!tdCard && tdCard.y > qaCard.y && !td.groups.some((g) => g.key === "khac"));
check("a flow to the expert passes QA", pathTo("chuyen-gia-tham-dinh").join(">") === "mgr>qa>td" && td.edges.some((e) => e.from === "qa" && e.to === "td"));
td = layoutOrg({ ...tdBase, runs: [run("t", "chuyen-gia-tham-dinh", "Thẩm định HSMT")] }, new Set(), true);
check("wallpaper: the expert is \"Expert Review\", no task", td.cards.find((c) => c.id === "td")!.title === "Expert Review" && !JSON.stringify(td).includes("HSMT") && displayName("chuyen-gia-tham-dinh", true) === "Expert Review");
check("every card fits the stage height", td.cards.every((c) => c.y >= 0 && c.y + 56 <= td.height));
l = layoutOrg({ ...base, manager: { state: "on", task: "Rà hồ sơ" }, runs: [run("a", "truong-phong-xdcb", "Khối lượng")] });
const head = l.cards.find((c) => c.id === "xdcb")!;
check("one run lights the head with its task", head.state === "on" && head.status === "Khối lượng");
check("…and no staff dot", l.dots.filter((d) => d.group === "xdcb").every((d) => d.state === "off"));
l = layoutOrg({ ...base, runs: [run("a", "truong-phong-xdcb", "A"), run("b", "truong-phong-xdcb", "B", "wait"), run("c", "truong-phong-xdcb-b", "C"), run("d", "truong-phong-xdcb", "D")] });
const xd = l.dots.filter((d) => d.group === "xdcb");
check("several runs: one dot each", xd[0]!.state === "on" && xd[1]!.state === "wait" && xd[0]!.label === "A");
check("more runs than dots: the last dot counts the rest", xd[2]!.num === "+2" && xd[2]!.label === "2 việc nữa", `${xd[2]!.num} ${xd[2]!.label}`);
check("the head shows the worst lamp", l.cards.find((c) => c.id === "xdcb")!.state === "wait");
check("meters count runs", l.counts.on === 3 && l.counts.wait === 1);
l = layoutOrg({ ...base, runs: [run("s", "so-hoa", "OCR")] });
check("a Số hóa run lights Số hóa and the line into Kho", l.cards.find((c) => c.id === "sohoa")!.state === "on" && l.edges.find((e) => e.key === "mgr>kho")!.live);
l = layoutOrg(base, new Set(["xdcb"]));
check("a report flashes the card green", l.cards.find((c) => c.id === "xdcb")!.state === "done");

console.log("\nWallpaper (English, no task text)");
l = layoutOrg({ ...base, manager: { state: "on", task: "Rà hồ sơ bí mật" }, runs: [run("a", "truong-phong-xdcb", "Hồ sơ bí mật"), run("b", "truong-phong-xdcb", "Khác bí mật")] }, new Set(), true);
const text = JSON.stringify([l.cards, l.dots, l.groups]);
check("no task text on the wallpaper", !text.includes("bí mật"), text.slice(0, 200));
check("no Vietnamese words on the wallpaper", !/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text), text.match(/"[^"]*[ảạđờữựệàáốớ][^"]*"/)?.[0] ?? "");
check("departments in English", l.groups[0]!.label === "Construction Audit" && displayName("so-hoa", true) === "Digitizer");
l = layoutOrg(base);
check("the normal chart stays Vietnamese", l.groups[0]!.label === "Kiểm toán XDCB");

console.log(failures === 0 ? "\nAll org layout checks passed." : `\n${failures} org layout check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
