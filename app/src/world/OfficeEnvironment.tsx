"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CORRIDOR_Z, FLOOR, ROOMS } from "@/simulation/worldLayout";
import { Instanced } from "@/world/Instanced";
import type { InstanceSpec } from "@/world/Instanced";
import { canvasTexture, hash, uiFont } from "@/world/proceduralTextures";
import { LINE_COLOR, boxEdgesGeometry, rectEdgesGeometry } from "@/world/edgeLines";
import { geometries, materials, sharedMaterial } from "@/world/sharedResources";
import { useRenderCount } from "@/world/renderCounts";

/**
 * Văn phòng kiểu bản vẽ (sa bàn): sàn sáng trên một bậc nền, hai tường xa, vách thấp giữa các phòng, nền
 * màu nhạt từng phòng, chậu cây và tên phòng trên sàn. Mọi mép đều có nét xanh đậm như hình vẽ kỹ thuật.
 */

const FLOOR_CENTER_Z = (FLOOR.minZ + FLOOR.maxZ) / 2;


// ───────────────────────── floor ─────────────────────────

/** Bậc nền dưới sàn: cả văn phòng như một tấm sa bàn đặt trên giấy kẻ ô. */
const BASE_H = 0.35;

function Floor() {
  const material = materials.floor();
  const corridor = sharedMaterial("corridor", () => new THREE.MeshBasicMaterial({ color: "#2a3ad0", transparent: true, opacity: 0.05, depthWrite: false, toneMapped: false }));
  const base = useMemo<InstanceSpec[]>(() => [{ p: [0, -BASE_H / 2 - 0.002, FLOOR_CENTER_Z], s: [FLOOR.width, BASE_H, FLOOR.depth] }], []);
  const baseEdges = useMemo(() => boxEdgesGeometry(base), [base]);
  useEffect(() => () => baseEdges.dispose(), [baseEdges]);
  return (
    <group>
      <mesh geometry={geometries.floorPlane()} material={material} position={[0, 0, FLOOR_CENTER_Z]} scale={[FLOOR.width, 1, FLOOR.depth]} receiveShadow />
      <Instanced name="floor-base" geometry={geometries.box()} material={materials.wall()} items={base} receiveShadow={false} />
      <lineSegments geometry={baseEdges} material={lineMaterial()} />
      {/* The corridor every route travels along. */}
      <mesh geometry={geometries.floorPlane()} material={corridor} position={[0, 0.004, CORRIDOR_Z]} scale={[FLOOR.width - 1, 1, 0.9]} />
      <RoomFloors />
    </group>
  );
}

/** Nền màu nhạt cho từng phòng, viền nét xanh, để nhìn từ xa vẫn phân biệt được phòng. Phòng chưa giao nhiệm vụ màu xám nhạt. */
function RoomFloors() {
  const items = useMemo<InstanceSpec[]>(
    () =>
      ROOMS.map((r) => ({
        p: [(r.x0 + r.x1) / 2, 0.003, (r.z0 + r.z1) / 2],
        s: [r.x1 - r.x0 - 0.3, 1, r.z1 - r.z0 - 0.3],
        c: r.note === "chưa giao nhiệm vụ" ? "#c9cfe3" : r.color,
      })),
    [],
  );
  const edges = useMemo(() => rectEdgesGeometry(ROOMS.map((r) => ({ x0: r.x0 + 0.15, x1: r.x1 - 0.15, z0: r.z0 + 0.15, z1: r.z1 - 0.15 })), 0.006), []);
  useEffect(() => () => edges.dispose(), [edges]);
  const mat = sharedMaterial("roomFloor", () => new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }));
  const edgeMat = sharedMaterial("roomEdge", () => new THREE.LineBasicMaterial({ color: LINE_COLOR, transparent: true, opacity: 0.35 }));
  return (
    <group>
      <Instanced name="room-floors" geometry={geometries.floorPlane()} material={mat} items={items} receiveShadow={false} />
      <lineSegments geometry={edges} material={edgeMat} />
    </group>
  );
}

function lineMaterial(): THREE.LineBasicMaterial {
  return sharedMaterial("blueprintLine", () => new THREE.LineBasicMaterial({ color: LINE_COLOR }));
}

// ───────────────────────── walls ─────────────────────────

/**
 * Hai bức tường xa (sau và trái) như mặt cắt sa bàn: nhìn chéo từ phía trước bên phải thì chúng làm nền,
 * không che phòng nào. Mặt trước và bên phải để hở.
 */
const WALL_H = 2.6;
const WALL_T = 0.22;
const WALLS: InstanceSpec[] = [
  { p: [0, WALL_H / 2, FLOOR.minZ - WALL_T / 2], s: [FLOOR.width + WALL_T * 2, WALL_H, WALL_T] },
  { p: [FLOOR.minX - WALL_T / 2, WALL_H / 2, FLOOR_CENTER_Z], s: [WALL_T, WALL_H, FLOOR.depth] },
];

function Walls() {
  const edges = useMemo(() => boxEdgesGeometry(WALLS), []);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <group name="walls">
      <Instanced name="walls" geometry={geometries.box()} material={materials.wall()} items={WALLS} castShadow />
      <lineSegments geometry={edges} material={lineMaterial()} />
    </group>
  );
}

// ───────────────────────── partitions ─────────────────────────

interface Partition {
  /** Centre on the floor. */
  x: number;
  z: number;
  length: number;
  /** "x": runs along x; "z": runs along z. */
  axis: "x" | "z";
}

/**
 * Vách thấp: vách ngăn giữa các phòng cạnh nhau, và ở mặt trước mỗi phòng hai đoạn ngắn ở hai góc (lối vào
 * để trống ở giữa). Không vách nào cắt ngang đường đi (§5 `route`): đường đi chỉ chạy dọc hành lang và thẳng
 * từ hành lang vào chỗ đứng.
 */
const STUB = 0.9;
export const PARTITIONS: Partition[] = (() => {
  const out: Partition[] = [];
  const seen = new Set<string>();
  for (const r of ROOMS) {
    for (const x of [r.x0, r.x1]) {
      if (x <= FLOOR.minX || x >= FLOOR.maxX) continue;
      const key = `${x}|${r.z0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, z: (r.z0 + r.z1) / 2, length: r.z1 - r.z0, axis: "z" });
    }
    if (!r.frontWall) continue;
    // Mặt trước là cạnh giáp hành lang: z1 với dãy sau, z0 với dãy trước.
    const z = r.z1 < CORRIDOR_Z ? r.z1 : r.z0;
    out.push({ x: r.x0 + STUB / 2, z, length: STUB, axis: "x" });
    out.push({ x: r.x1 - STUB / 2, z, length: STUB, axis: "x" });
  }
  return out;
})();

const PARTITION_H = 0.95;
const PARTITION_T = 0.12;

function Partitions() {
  const walls = useMemo<InstanceSpec[]>(
    () =>
      PARTITIONS.map((p) => ({
        p: [p.x, PARTITION_H / 2, p.z],
        s: p.axis === "z" ? [PARTITION_T, PARTITION_H, p.length] : [p.length, PARTITION_H, PARTITION_T],
      })),
    [],
  );
  const edges = useMemo(() => boxEdgesGeometry(walls), [walls]);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <group name="partitions">
      <Instanced geometry={geometries.box()} material={materials.wall()} items={walls} castShadow />
      <lineSegments geometry={edges} material={lineMaterial()} />
    </group>
  );
}

// ───────────────────────── plants ─────────────────────────

const PLANT_SPOTS: [number, number, number][] = [
  // x, z, size
  [-19.3, -9.8, 1.0],
  [-8.5, -9.8, 0.85],
  [-3.5, -9.8, 0.85],
  [2.5, -9.8, 0.85],
  [19.3, -9.8, 1.0],
  [-19.3, 12.9, 1.0],
  [-7.6, 12.9, 0.85],
  [13.6, 12.9, 0.85],
  [19.3, 12.9, 1.0],
];

function Plants() {
  const { pots, soil, leaves, stems } = useMemo(() => {
    const pots: InstanceSpec[] = [];
    const soil: InstanceSpec[] = [];
    const leaves: InstanceSpec[] = [];
    const stems: InstanceSpec[] = [];
    PLANT_SPOTS.forEach(([x, z, k], i) => {
      pots.push({ p: [x, 0.27 * k, z], s: [0.5 * k, 0.54 * k, 0.5 * k] });
      soil.push({ p: [x, 0.53 * k, z], s: [0.44 * k, 0.02, 0.44 * k] });
      stems.push({ p: [x, 0.8 * k, z], s: [0.04, 0.6 * k, 0.04] });
      const n = 6;
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2 + hash(i, j, 3);
        const tilt = 0.5 + hash(i, j, 4) * 0.5;
        const len = (0.45 + hash(i, j, 5) * 0.3) * k;
        const r = 0.13 * k;
        leaves.push({
          p: [x + Math.sin(a) * r * 1.4, (0.75 + hash(i, j, 6) * 0.35) * k, z + Math.cos(a) * r * 1.4],
          r: [tilt * Math.cos(a), 0, -tilt * Math.sin(a)],
          s: [0.13 * k, len, 0.06 * k],
          c: hash(i, j, 7) > 0.5 ? "#3f8a60" : "#2c6a49",
        });
      }
      leaves.push({ p: [x, 1.05 * k, z], s: [0.5 * k, 0.55 * k, 0.5 * k], c: "#357a55" });
    });
    return { pots, soil, leaves, stems };
  }, []);
  const leafMat = sharedMaterial("leafInstanced", () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.75, metalness: 0 }));
  return (
    <group name="plants">
      <Instanced geometry={geometries.cylinder()} material={materials.ceramic()} items={pots} castShadow />
      <Instanced geometry={geometries.cylinderLow()} material={materials.soil()} items={soil} />
      <Instanced geometry={geometries.cylinderLow()} material={materials.leafDark()} items={stems} />
      <Instanced geometry={geometries.sphere()} material={leafMat} items={leaves} castShadow />
    </group>
  );
}

// ───────────────────────── floor labels ─────────────────────────

interface FloorLabelDef {
  text: string;
  x: number;
  z: number;
  size: number;
}

/** Tên phòng sát lối vào (phía hành lang); dòng phụ ("chưa giao nhiệm vụ") ngay dưới. */
export const FLOOR_LABELS: FloorLabelDef[] = ROOMS.flatMap((r) => {
  const back = r.z1 < CORRIDOR_Z;
  const cx = (r.x0 + r.x1) / 2;
  const width = r.x1 - r.x0;
  const size = Math.min(1.15, (width - 0.6) / (3.2 * 1.25));
  const z = back ? r.z1 - 0.75 : r.z0 + 0.75;
  const out: FloorLabelDef[] = [{ text: r.label, x: cx, z, size }];
  if (r.note) out.push({ text: r.note, x: cx, z: back ? z - 0.7 : z + 0.7, size: size * 0.75 });
  return out;
});

const LABEL_SCALE = 1.25;

/** All labels share one canvas atlas and one merged geometry: a single draw call. */
function FloorLabels() {
  const { geometry, material } = useMemo(() => {
    const rowH = 96;
    const tex = canvasTexture(512, rowH * FLOOR_LABELS.length, (g, w) => {
      g.textAlign = "center";
      g.textBaseline = "middle";
      FLOOR_LABELS.forEach((l, i) => {
        const label = l.text.toUpperCase().split("").join(" ");
        let size = 44;
        do {
          g.font = `700 ${size}px ${uiFont()}`;
          size -= 2;
        } while (g.measureText(label).width > w - 32 && size > 16);
        g.fillStyle = "rgba(27,37,119,0.85)";
        g.fillText(label, w / 2, i * rowH + rowH / 2);
      });
    });
    tex.anisotropy = 8;
    const parts = FLOOR_LABELS.map((l, i) => {
      const p = new THREE.PlaneGeometry(3.2 * l.size * LABEL_SCALE, 0.6 * l.size * LABEL_SCALE);
      const uv = p.getAttribute("uv") as THREE.BufferAttribute;
      const n = FLOOR_LABELS.length;
      for (let k = 0; k < uv.count; k++) uv.setY(k, (n - 1 - i + uv.getY(k)) / n);
      p.rotateX(-Math.PI / 2);
      p.translate(l.x, 0.008, l.z);
      return p;
    });
    const geometry = mergeGeometries(parts) ?? new THREE.BufferGeometry();
    parts.forEach((p) => p.dispose());
    const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9 });
    return { geometry, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <mesh name="floor-labels" geometry={geometry} material={material} renderOrder={1} />;
}

export function OfficeEnvironment() {
  useRenderCount("OfficeEnvironment");
  return (
    <group name="office">
      <Floor />
      <Walls />
      <Partitions />
      <Plants />
      <FloorLabels />
    </group>
  );
}
