import * as THREE from "three";
import { composeInstance } from "@/world/Instanced";
import type { InstanceSpec } from "@/world/Instanced";

/** Màu nét bản vẽ: mọi đường viền tường, vách, mép sàn dùng chung một màu. */
export const LINE_COLOR = "#2a3590";

const CORNERS: [number, number, number][] = [
  [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5],
  [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
];
const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Viền 12 cạnh của các hộp (cùng cách mô tả với `Instanced`: tâm, xoay, kích thước), gộp vào một
 * LineSegments để cả lớp viền chỉ tốn một lần vẽ.
 */
export function boxEdgesGeometry(boxes: readonly InstanceSpec[]): THREE.BufferGeometry {
  const pos = new Float32Array(boxes.length * EDGES.length * 6);
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let k = 0;
  for (const b of boxes) {
    composeInstance(b, m);
    for (const [a, c] of EDGES) {
      for (const i of [a, c]) {
        v.set(...CORNERS[i]!).applyMatrix4(m);
        pos[k++] = v.x;
        pos[k++] = v.y;
        pos[k++] = v.z;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  return g;
}

/** Đường viền của các hình chữ nhật nằm trên mặt sàn (x0..x1, z0..z1) ở độ cao y. */
export function rectEdgesGeometry(rects: readonly { x0: number; x1: number; z0: number; z1: number }[], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const r of rects) {
    const c: [number, number][] = [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
    for (let i = 0; i < 4; i++) {
      const a = c[i]!;
      const b = c[(i + 1) % 4]!;
      pos.push(a[0], y, a[1], b[0], y, b[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeBoundingSphere();
  return g;
}
