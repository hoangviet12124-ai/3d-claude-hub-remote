// Pure layout data in metres. x: left(-)/right(+), z: back(-)/front(+).
// Heading convention: heading = atan2(dx, dz), so heading π faces -z (towards the back wall).
//
// Mặt bằng Tổ giúp việc: dãy phòng phía sau (Kho lưu trữ, Phòng Manager, Phòng QA, Phòng họp, Phòng R&D),
// hành lang ở giữa, dãy phòng phía trước (Phòng KT XDCB, bốn phòng chưa giao nhiệm vụ, Góc giải lao).

export interface Vec2 {
  x: number;
  z: number;
}

export type LocationId =
  // Mã cũ, giữ lại vì phần nối dữ liệu thật (live) còn gửi các mã này.
  | "hub"
  | "ops"
  | "research"
  | "product"
  | "dev"
  | "testing"
  | "review"
  | "planning"
  | "collab"
  | "lounge"
  // Mã mới của Tổ giúp việc.
  | "kho_vb"
  | "kho_hs"
  | "qa_in"
  | "dev_help"
  | "bot1"
  | "bot2"
  | "fin"
  | "proc"
  | "draft"
  | "study"
  | "view";

export type ZoneId = "operations" | "research" | "development" | "collaboration";

export interface LocationDef {
  id: LocationId;
  label: string;
  slots: Vec2[];
  /** Heading per slot (same length as slots). */
  facing: number[];
  /**
   * Optional waypoints per slot between the corridor and the slot, for slots a straight walk from the corridor
   * would cut through furniture (the far side of the meeting table). Walked in order on the way in, reversed out.
   */
  via?: (Vec2[] | undefined)[];
  zone: ZoneId;
}

export const FLOOR = { width: 40, depth: 24, minX: -20, maxX: 20, minZ: -10.5, maxZ: 13.5 } as const;
export const CORRIDOR_Z = 1.5;

/** Phòng trên mặt bằng: dùng cho vách kính, thảm màu và nhãn tên phòng. */
export interface RoomDef {
  id: string;
  label: string;
  /** Dòng phụ dưới tên phòng, ví dụ "chưa giao nhiệm vụ". */
  note?: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  color: string;
  /** Vách trước có hai đoạn ngắn ở hai góc (lối vào để trống ở giữa). */
  frontWall: boolean;
}

const BACK = { z0: -10.5, z1: -0.5 } as const;
const FRONT = { z0: 3, z1: 13.5 } as const;

export const ROOMS: RoomDef[] = [
  { id: "kho", label: "Kho lưu trữ", note: "văn bản · hồ sơ cũ · tri thức", x0: -20, x1: -9, ...BACK, color: "#4FBF7A", frontWall: true },
  { id: "manager", label: "Phòng Manager", x0: -9, x1: -3, ...BACK, color: "#5A8DEE", frontWall: true },
  { id: "qa", label: "Phòng QA", x0: -3, x1: 3, ...BACK, color: "#F06A6A", frontWall: true },
  { id: "meeting", label: "Phòng họp", x0: 3, x1: 12, ...BACK, color: "#7cc4d6", frontWall: true },
  { id: "rnd", label: "Phòng R&D", x0: 12, x1: 20, ...BACK, color: "#A78BFA", frontWall: true },
  { id: "xdcb", label: "Phòng KT XDCB", x0: -20, x1: -8, ...FRONT, color: "#E8963A", frontWall: true },
  { id: "fin", label: "Phòng Tài chính", note: "chưa giao nhiệm vụ", x0: -8, x1: -2.5, ...FRONT, color: "#D4B44A", frontWall: true },
  { id: "proc", label: "Phòng KT TC & quy trình", note: "chưa giao nhiệm vụ", x0: -2.5, x1: 3, ...FRONT, color: "#5BC0A8", frontWall: true },
  { id: "draft", label: "Phòng Góp ý văn bản", note: "chưa giao nhiệm vụ", x0: 3, x1: 8.5, ...FRONT, color: "#E07AB0", frontWall: true },
  { id: "study", label: "Phòng Nghiên cứu chuyên đề", note: "chưa giao nhiệm vụ", x0: 8.5, x1: 14, ...FRONT, color: "#8FA8D8", frontWall: true },
  { id: "lounge", label: "Góc giải lao", x0: 14, x1: 20, ...FRONT, color: "#c9a27a", frontWall: false },
];

const headingTo = (from: Vec2, to: Vec2) => Math.atan2(to.x - from.x, to.z - from.z);
const BACK_SLOT_Z = -4.5;
const FRONT_SLOT_Z = 7;

const single = (x: number, z: number, facing: number) => ({ slots: [{ x, z }], facing: [facing] });
/** Đứng trước bàn ở dãy sau (bàn phía sau lưng hướng -z). */
const backDesk = (x: number) => single(x, BACK_SLOT_Z, Math.PI);
/** Đứng trước bàn ở dãy trước (bàn phía trước mặt hướng +z). */
const frontDesk = (x: number, z = FRONT_SLOT_Z) => single(x, z, 0);

export const MEETING_CENTER: Vec2 = { x: 7.5, z: -5 };
export const LOUNGE_CENTER: Vec2 = { x: 17, z: 8.6 };

const meetingSlots: Vec2[] = [
  { x: MEETING_CENTER.x, z: MEETING_CENTER.z - 1.75 }, // 0: Manager, phía trong, quay ra
  { x: MEETING_CENTER.x - 1.75, z: MEETING_CENTER.z }, // 1: trưởng phòng
  { x: MEETING_CENTER.x + 1.75, z: MEETING_CENTER.z }, // 2: QA
  { x: MEETING_CENTER.x, z: MEETING_CENTER.z + 1.75 }, // 3
];
const loungeSlots: Vec2[] = [
  { x: 15.1, z: 7.4 },
  { x: 16.3, z: 6.7 },
  { x: 17.7, z: 6.7 },
  { x: 18.9, z: 7.4 },
  { x: 15.0, z: 8.9 },
];

export const KHO_DESK = { librarian: -16.5, digitiser: -12 } as const;

export const LOCATIONS: Record<LocationId, LocationDef> = {
  // Dãy sau
  hub: { id: "hub", label: "Bàn Manager", zone: "operations", ...single(-6, -3.85, Math.PI) },
  testing: { id: "testing", label: "Bàn QA", zone: "operations", ...backDesk(0) },
  qa_in: { id: "qa_in", label: "Khay nhận hồ sơ QA", zone: "operations", ...single(1.7, -3.3, headingTo({ x: 1.7, z: -3.3 }, { x: 0, z: -4.5 })) },
  research: { id: "research", label: "Bàn Thủ thư", zone: "research", ...backDesk(KHO_DESK.librarian) },
  product: { id: "product", label: "Bàn Số hóa", zone: "research", ...backDesk(KHO_DESK.digitiser) },
  kho_vb: { id: "kho_vb", label: "Quầy văn bản", zone: "research", ...single(-15.1, -3.3, headingTo({ x: -15.1, z: -3.3 }, { x: KHO_DESK.librarian, z: BACK_SLOT_Z })) },
  kho_hs: { id: "kho_hs", label: "Quầy hồ sơ cũ", zone: "research", ...single(-10.6, -3.3, headingTo({ x: -10.6, z: -3.3 }, { x: KHO_DESK.digitiser, z: BACK_SLOT_Z })) },
  collab: {
    id: "collab",
    label: "Phòng họp",
    zone: "collaboration",
    slots: meetingSlots,
    facing: meetingSlots.map((s) => headingTo(s, MEETING_CENTER)),
    // Chỗ phía trong bàn: đi vòng bên phải bàn để không xuyên qua bàn.
    via: [[{ x: MEETING_CENTER.x + 3.0, z: MEETING_CENTER.z - 1.75 }], undefined, undefined, undefined],
  },
  review: { id: "review", label: "Bàn Thư ký R&D", zone: "collaboration", ...backDesk(14) },
  ops: { id: "ops", label: "Bàn Kỹ sư cải tiến", zone: "collaboration", ...backDesk(18) },
  // Dãy trước
  dev: { id: "dev", label: "Bàn KT XDCB", zone: "development", ...frontDesk(-14) },
  planning: { id: "planning", label: "Bảng kế hoạch", zone: "development", ...single(-18.5, 5, -Math.PI / 2) },
  dev_help: {
    id: "dev_help",
    label: "Cạnh bàn KT XDCB",
    zone: "development",
    slots: [
      { x: -15.6, z: 7.6 },
      { x: -12.4, z: 7.6 },
    ],
    facing: [Math.PI / 2, -Math.PI / 2],
  },
  bot1: { id: "bot1", label: "Bàn Trợ lý 1", zone: "development", ...frontDesk(-10.5, 9.5) },
  bot2: { id: "bot2", label: "Bàn Trợ lý 2", zone: "development", ...frontDesk(-17, 9.5) },
  fin: { id: "fin", label: "Bàn Tài chính", zone: "development", ...frontDesk(-5.25) },
  proc: { id: "proc", label: "Bàn KT TC & quy trình", zone: "development", ...frontDesk(0.25) },
  draft: { id: "draft", label: "Bàn Góp ý văn bản", zone: "development", ...frontDesk(5.75) },
  study: { id: "study", label: "Bàn Nghiên cứu chuyên đề", zone: "development", ...frontDesk(11.25) },
  lounge: { id: "lounge", label: "Góc giải lao", zone: "collaboration", slots: loungeSlots, facing: loungeSlots.map((s) => headingTo(s, LOUNGE_CENTER)) },
  view: {
    id: "view",
    label: "Cửa kính",
    zone: "collaboration",
    slots: [
      { x: -18.9, z: 0.6 },
      { x: -18.9, z: 2.4 },
    ],
    facing: [-Math.PI / 2, -Math.PI / 2],
  },
};

/** Tâm bàn tròn của Manager (sau lưng chỗ đứng). */
export const HUB_CENTER: Vec2 = { x: -6, z: -5.6 };
/** Màn hình lớn trên tường phòng họp. */
export const MISSION_CONTROL: Vec2 = { x: MEETING_CENTER.x, z: -9.2 };

export function slotFor(location: LocationId, seat: number): { position: Vec2; facing: number } {
  const def = LOCATIONS[location];
  const i = ((seat % def.slots.length) + def.slots.length) % def.slots.length;
  return { position: def.slots[i]!, facing: def.facing[i]! };
}

export function viaFor(location: LocationId | null, seat: number): Vec2[] {
  if (!location) return [];
  const def = LOCATIONS[location];
  if (!def.via) return [];
  const i = ((seat % def.slots.length) + def.slots.length) % def.slots.length;
  return def.via[i] ?? [];
}

const EPS = 1e-6;

/**
 * Go to the corridor, travel along x, then to the destination. Never returns the start point.
 * `exitVia` leads out of the current spot (in walking order), `enterVia` into the destination.
 */
export function route(from: Vec2, to: Vec2, exitVia: Vec2[] = [], enterVia: Vec2[] = []): Vec2[] {
  // Already there: no detour via the corridor.
  if (Math.hypot(to.x - from.x, to.z - from.z) < 1e-3) return [];
  const leave = exitVia.length ? exitVia[exitVia.length - 1]! : from;
  const arrive = enterVia.length ? enterVia[0]! : to;
  const points: Vec2[] = [...exitVia, { x: leave.x, z: CORRIDOR_Z }, { x: arrive.x, z: CORRIDOR_Z }, ...enterVia, { x: to.x, z: to.z }];
  const out: Vec2[] = [];
  let prev = from;
  for (const p of points) {
    if (Math.abs(p.x - prev.x) > EPS || Math.abs(p.z - prev.z) > EPS) {
      out.push(p);
      prev = p;
    }
  }
  return out;
}

export function pathLength(from: Vec2, path: Vec2[]): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return total;
}
