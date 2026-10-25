import type { CameraPresetId, ViewInsets } from "@/state/useWorldStore";

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

/**
 * §6.6, authored for a wide, unobstructed view; `fitScale` stretches them for the actual free area.
 * Mọi góc nhìn cùng nhìn thẳng từ phía trước (camera x = target x), để đổi góc nhìn chỉ trượt và phóng, không xoay cảnh.
 */
export const CAMERA_PRESETS: Record<CameraPresetId, CameraPreset> = {
  overview: { id: "overview", label: "Toàn cảnh", position: [0, 35, 39.5], target: [0, 0, 1.2] },
  hub: { id: "hub", label: "Manager & QA", position: [-3, 7.4, 7.6], target: [-3, 1, -4.6] },
  development: { id: "development", label: "Phòng KT XDCB", position: [-14, 10, 18.5], target: [-14, 0.6, 6.4] },
  research: { id: "research", label: "Kho lưu trữ", position: [-14.5, 6.4, 3.4], target: [-14.5, 0.6, -5.4] },
  collaboration: { id: "collaboration", label: "Phòng họp", position: [7.5, 7.8, 5.2], target: [7.5, 0.5, -5] },
};

export const CAMERA_PRESET_IDS: CameraPresetId[] = ["overview", "hub", "collaboration", "development", "research"];

export const CAMERA_LIMITS = {
  minDistance: 3.5,
  maxDistance: 85,
  minPolarAngle: 0.18,
  maxPolarAngle: 1.36,
  target: { minX: -19, maxX: 19, minY: 0, maxY: 3, minZ: -10, maxZ: 13 },
} as const;

export const CAMERA_FOV = 40;
/** Narrow free areas widen the fov up to this so the overview still shows the whole office (phase 6). */
export const CAMERA_FOV_MAX = 60;
export const FOCUS_DISTANCE_AGENT = 7.5;
export const FOCUS_DISTANCE_STATION = 6.5;

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
