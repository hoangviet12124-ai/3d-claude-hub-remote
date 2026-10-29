import type { CameraPresetId, ViewInsets } from "@/state/useWorldStore";

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

/**
 * Góc nhìn chéo cố định kiểu sa bàn (như bản vẽ isometric): camera luôn đứng phía trước bên phải, nhìn xuống
 * khoảng 35°. Mọi preset và lúc bấm vào agent đều dùng đúng hướng này, nên đổi góc chỉ trượt và phóng, không xoay.
 * `fitScale` stretches the distances for the actual free area.
 */
export const ISO_THETA = Math.PI / 4;
export const ISO_PHI = 0.96;

function iso(label: string, id: CameraPresetId, target: readonly [number, number, number], distance: number): CameraPreset {
  const h = Math.sin(ISO_PHI) * distance;
  return {
    id,
    label,
    target,
    position: [target[0] + h * Math.sin(ISO_THETA), target[1] + Math.cos(ISO_PHI) * distance, target[2] + h * Math.cos(ISO_THETA)],
  };
}

export const CAMERA_PRESETS: Record<CameraPresetId, CameraPreset> = {
  overview: iso("Toàn cảnh", "overview", [0, 0, 1.5], 105),
  hub: iso("Manager & QA", "hub", [-3, 0.6, -5], 30),
  development: iso("Phòng KT XDCB", "development", [-14, 0.6, 8], 32),
  research: iso("Kho lưu trữ", "research", [-14.5, 0.6, -5.5], 30),
  collaboration: iso("Phòng họp", "collaboration", [7.5, 0.5, -5], 28),
};

export const CAMERA_PRESET_IDS: CameraPresetId[] = ["overview", "hub", "collaboration", "development", "research"];

export const CAMERA_LIMITS = {
  minDistance: 10,
  maxDistance: 220,
  minPolarAngle: 0.18,
  maxPolarAngle: 1.36,
  target: { minX: -19, maxX: 19, minY: 0, maxY: 3, minZ: -10, maxZ: 13 },
} as const;

export const CAMERA_FOV = 22;
/** Narrow free areas widen the fov up to this so the overview still shows the whole office (phase 6). */
export const CAMERA_FOV_MAX = 34;
export const FOCUS_DISTANCE_AGENT = 16;
export const FOCUS_DISTANCE_STATION = 15;

/** Smallest free area we fit to, so a collapsed layout never divides by ~0. */
const MIN_FREE_PX = 120;

export interface FreeArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function freeArea(width: number, height: number, insets: ViewInsets): FreeArea {
  const left = Math.min(insets.left, width - MIN_FREE_PX);
  const top = Math.min(insets.top, height - MIN_FREE_PX);
  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: Math.max(MIN_FREE_PX, width - insets.left - insets.right),
    height: Math.max(MIN_FREE_PX, height - insets.top - insets.bottom),
  };
}

/** §6.6: `clamp(max(1.17·h/freeW, 0.96·h/freeH), 1, 2.2)`, where h is the canvas height. */
export function fitScale(height: number, free: FreeArea): number {
  const s = Math.max((1.17 * height) / free.width, (0.96 * height) / free.height);
  return Math.min(2.2, Math.max(1, s));
}

export function clampTarget(v: { x: number; y: number; z: number }): boolean {
  const L = CAMERA_LIMITS.target;
  const x = Math.min(L.maxX, Math.max(L.minX, v.x));
  const y = Math.min(L.maxY, Math.max(L.minY, v.y));
  const z = Math.min(L.maxZ, Math.max(L.minZ, v.z));
  const changed = x !== v.x || y !== v.y || z !== v.z;
  v.x = x;
  v.y = y;
  v.z = z;
  return changed;
}
