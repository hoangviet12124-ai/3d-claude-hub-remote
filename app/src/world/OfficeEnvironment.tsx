"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { useFrame } from "@react-three/fiber";
import { CORRIDOR_Z, FLOOR, ROOMS } from "@/simulation/worldLayout";
import { useWorldStore } from "@/state/useWorldStore";
import { Instanced } from "@/world/Instanced";
import type { InstanceSpec } from "@/world/Instanced";
import { canvasTexture, glowTexture, hash, skyTexture, uiFont, windowsTexture } from "@/world/proceduralTextures";
import { geometries, materials, sharedGeometry, sharedMaterial } from "@/world/sharedResources";
import { useRenderCount } from "@/world/renderCounts";

/**
 * §6.2. Dark glass office at blue hour: tiled floor, a back window wall onto a dusk sky and an instanced
 * skyline, side walls, low glass partitions between zones, potted plants, drifting dust motes and floor labels.
 * Everything repeated is instanced; the whole skyline is one draw call.
 */

const WALL_H = 4.4;
const BACK_Z = FLOOR.minZ;
const FLOOR_CENTER_Z = (FLOOR.minZ + FLOOR.maxZ) / 2;

export const SKYLINE_COUNT = { high: 260, low: 120 } as const;
export const DUST_COUNT = { high: 260, low: 90 } as const;

// ───────────────────────── floor ─────────────────────────

function Floor() {
  const material = materials.floor();
  const corridor = sharedMaterial("corridor", () => new THREE.MeshBasicMaterial({ color: "#7cc4d6", transparent: true, opacity: 0.045, depthWrite: false }));
  return (
    <group>
      <mesh geometry={geometries.floorPlane()} material={material} position={[0, 0, FLOOR_CENTER_Z]} scale={[FLOOR.width, 1, FLOOR.depth]} receiveShadow />
      {/* The corridor every route travels along. */}
      <mesh geometry={geometries.floorPlane()} material={corridor} position={[0, 0.004, CORRIDOR_Z]} scale={[FLOOR.width - 1, 1, 0.9]} />
      <RoomFloors />
    </group>
  );
}

/** Thảm màu nhạt cho từng phòng, để nhìn từ xa vẫn phân biệt được phòng. Phòng chưa giao nhiệm vụ nhạt hơn. */
function RoomFloors() {
  const items = useMemo<InstanceSpec[]>(
    () =>
      ROOMS.map((r) => ({
        p: [(r.x0 + r.x1) / 2, 0.003, (r.z0 + r.z1) / 2],
        s: [r.x1 - r.x0 - 0.3, 1, r.z1 - r.z0 - 0.3],
        c: r.note === "chưa giao nhiệm vụ" ? "#1a1f29" : r.color,
      })),
    [],
  );
  const mat = sharedMaterial("roomFloor", () => new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.07, depthWrite: false, toneMapped: false }));
  return <Instanced name="room-floors" geometry={geometries.floorPlane()} material={mat} items={items} receiveShadow={false} />;
}

// ───────────────────────── walls + windows ─────────────────────────

const MULLION_STEP = 3.75;

const MULLIONS: InstanceSpec[] = (() => {
  const out: InstanceSpec[] = [];
  // Back window wall: full-height mullions, sill, transom and header.
  for (let x = FLOOR.minX; x <= FLOOR.maxX + 1e-6; x += MULLION_STEP) out.push({ p: [x, WALL_H / 2, BACK_Z], s: [0.12, WALL_H, 0.22] });
  out.push({ p: [0, 0.09, BACK_Z], s: [FLOOR.width + 0.3, 0.18, 0.34] });
  out.push({ p: [0, 3.05, BACK_Z], s: [FLOOR.width, 0.06, 0.12] });
  out.push({ p: [0, WALL_H, BACK_Z], s: [FLOOR.width + 0.3, 0.3, 0.34] });
  // Side walls: glass above a low parapet, same rhythm.
  for (const x of [FLOOR.minX - 0.1, FLOOR.maxX + 0.1]) {
    for (let z = FLOOR.minZ + MULLION_STEP; z < FLOOR.maxZ - 0.5; z += MULLION_STEP) out.push({ p: [x, WALL_H / 2, z], s: [0.2, WALL_H, 0.12] });
    out.push({ p: [x, WALL_H, FLOOR_CENTER_Z], s: [0.32, 0.3, FLOOR.depth + 0.3] });
    out.push({ p: [x, 3.05, FLOOR_CENTER_Z], s: [0.12, 0.06, FLOOR.depth] });
  }
  return out;
})();

const PARAPET_H = 0.9;
const PARAPETS: InstanceSpec[] = [
  { p: [FLOOR.minX - 0.1, PARAPET_H / 2, FLOOR_CENTER_Z], s: [0.3, PARAPET_H, FLOOR.depth + 0.3] },
  { p: [FLOOR.maxX + 0.1, PARAPET_H / 2, FLOOR_CENTER_Z], s: [0.3, PARAPET_H, FLOOR.depth + 0.3] },
  // Front edge of the floor plate: a slim lip so the open side reads as a building edge.
  { p: [0, -0.06, FLOOR.maxZ + 0.1], s: [FLOOR.width + 0.5, 0.18, 0.2] },
];

const PANES: InstanceSpec[] = [
  { p: [0, WALL_H / 2, BACK_Z + 0.04], s: [FLOOR.width, WALL_H, 1] },
  { p: [FLOOR.minX - 0.06, (WALL_H + PARAPET_H) / 2, FLOOR_CENTER_Z], r: [0, Math.PI / 2, 0], s: [FLOOR.depth, WALL_H - PARAPET_H, 1] },
  { p: [FLOOR.maxX + 0.06, (WALL_H + PARAPET_H) / 2, FLOOR_CENTER_Z], r: [0, -Math.PI / 2, 0], s: [FLOOR.depth, WALL_H - PARAPET_H, 1] },
];

function Walls() {
  const sky = sharedMaterial("sky", () => new THREE.MeshBasicMaterial({ map: skyTexture(), fog: false, depthWrite: false }));
  return (
    <group>
      <mesh geometry={geometries.plane()} material={sky} position={[0, 10, -150]} scale={[600, 280, 1]} renderOrder={-10} />
      <Instanced name="mullions" geometry={geometries.box()} material={materials.wallTrim()} items={MULLIONS} />
      <Instanced name="parapets" geometry={geometries.box()} material={materials.wall()} items={PARAPETS} castShadow />
      <Instanced name="window-glass" geometry={geometries.plane()} material={materials.windowGlass()} items={PANES} receiveShadow={false} />
    </group>
  );
}

// ───────────────────────── skyline ─────────────────────────

/**
 * Towers below and beyond the window wall (the office is high up). Window rows are scaled by each instance's
 * size in the vertex shader, so a tall tower gets more floors instead of stretched ones; roofs stay dark.
 */
function skylineMaterial(): THREE.MeshStandardMaterial {
  return sharedMaterial("skyline", () => {
    const m = new THREE.MeshStandardMaterial({
      color: "#0a0e16",
      roughness: 0.85,
      metalness: 0.2,
      emissive: "#ffffff",
      emissiveMap: windowsTexture(),
      emissiveIntensity: 0.9,
    });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
#if defined( USE_INSTANCING ) && defined( USE_EMISSIVEMAP )
  {
    float sx = length( instanceMatrix[0].xyz );
    float sy = length( instanceMatrix[1].xyz );
    vec2 jitter = vec2( instanceMatrix[3].x * 0.37, instanceMatrix[3].z * 0.11 );
    vEmissiveMapUv = abs( normal.y ) > 0.5 ? vec2( 0.0 ) : vec2( uv.x * sx * 0.08, uv.y * sy * 0.012 ) + jitter;
  }
#endif`,
      );
    };
    m.customProgramCacheKey = () => "aaw-skyline";
    return m;
  });
}

function Skyline() {
  useRenderCount("Skyline");
  const high = useWorldStore((s) => s.quality === "high");
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = sharedGeometry("towerBox", () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const material = skylineMaterial();
  const max = SKYLINE_COUNT.high;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    // Interleave near and far so the low-quality prefix still covers the whole view.
    for (let i = 0; i < max; i++) {
      const r = (k: number) => hash(i, k, 11);
      const far = r(1);
      const z = -24 - far * 80;
      const spread = 50 + far * 90;
      let x = (r(2) - 0.5) * 2 * spread;
      // Keep a gap around our own tower.
      if (Math.abs(x) < 24 && z > -40) x += Math.sign(x || 1) * 24;
      const w = 8 + r(3) * 12;
      const d = 8 + r(4) * 12;
      const h = 60 + r(5) * r(5) * 90;
      p.set(x, -120, z);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (r(6) - 0.5) * 0.4);
      s.set(w, h, d);
      mesh.setMatrixAt(i, m4.compose(p, q, s));
      mesh.setColorAt(i, c.setHSL(0.6 + r(7) * 0.05, 0.25, 0.45 + r(8) * 0.55));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [max]);

  useLayoutEffect(() => {
    if (ref.current) ref.current.count = high ? SKYLINE_COUNT.high : SKYLINE_COUNT.low;
  }, [high]);

  return (
    <group>
      <instancedMesh ref={ref} name="skyline" args={[geometry, material, max]} frustumCulled={false} />
      {/* Our own tower under the floor plate, so nothing below the office shows through the open front. */}
      <mesh geometry={geometries.box()} material={materials.wallTrim()} position={[0, -60.04, FLOOR_CENTER_Z]} scale={[FLOOR.width + 0.6, 120, FLOOR.depth + 0.6]} />
    </group>
  );
}

// ───────────────────────── glass partitions ─────────────────────────

interface Partition {
  /** Centre on the floor. */
  x: number;
  z: number;
  length: number;
  /** "x": runs along x; "z": runs along z. */
  axis: "x" | "z";
}

/**
 * Vách kính thấp: vách ngăn giữa các phòng cạnh nhau, và ở mặt trước mỗi phòng hai đoạn ngắn ở hai góc (lối vào
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

const PARTITION_H = 1.15;

function Partitions() {
  const { panes, rails, posts } = useMemo(() => {
    const panes: InstanceSpec[] = [];
    const rails: InstanceSpec[] = [];
    const posts: InstanceSpec[] = [];
    for (const p of PARTITIONS) {
      const ry = p.axis === "z" ? Math.PI / 2 : 0;
      panes.push({ p: [p.x, PARTITION_H / 2 + 0.04, p.z], r: [0, ry, 0], s: [p.length, PARTITION_H, 1] });
      rails.push({ p: [p.x, PARTITION_H + 0.05, p.z], r: [0, ry, 0], s: [p.length + 0.04, 0.035, 0.05] });
      rails.push({ p: [p.x, 0.03, p.z], r: [0, ry, 0], s: [p.length + 0.04, 0.06, 0.07] });
      for (const t of [-0.5, 0.5]) {
        const dx = p.axis === "x" ? t * p.length : 0;
        const dz = p.axis === "z" ? t * p.length : 0;
        posts.push({ p: [p.x + dx, (PARTITION_H + 0.07) / 2, p.z + dz], s: [0.05, PARTITION_H + 0.07, 0.05] });
      }
    }
    return { panes, rails, posts };
  }, []);
  return (
    <group name="partitions">
      <Instanced geometry={geometries.box()} material={materials.metal()} items={rails} castShadow />
      <Instanced geometry={geometries.box()} material={materials.metal()} items={posts} castShadow />
      <Instanced geometry={geometries.plane()} material={materials.glass()} items={panes} receiveShadow={false} />
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

// ───────────────────────── dust motes ─────────────────────────

function DustMotes() {
  useRenderCount("DustMotes");
  const high = useWorldStore((s) => s.quality === "high");
  const ref = useRef<THREE.Points>(null);
  const max = DUST_COUNT.high;
  const { geometry, base } = useMemo(() => {
    const base = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) {
      base[i * 3] = FLOOR.minX + 0.5 + hash(i, 1, 21) * (FLOOR.width - 1);
      base[i * 3 + 1] = 0.3 + hash(i, 2, 21) * 3.6;
      base[i * 3 + 2] = FLOOR.minZ + 0.5 + hash(i, 3, 21) * (FLOOR.depth - 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(base.slice(), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, FLOOR_CENTER_Z), 20);
    return { geometry: g, base };
  }, [max]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = sharedMaterial(
    "dust",
    () =>
      new THREE.PointsMaterial({
        size: 0.07,
        map: glowTexture(),
        color: "#ffe2bf",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
  );

  useLayoutEffect(() => {
    geometry.setDrawRange(0, high ? DUST_COUNT.high : DUST_COUNT.low);
  }, [geometry, high]);

  // Own clock: with reduced motion the motes hold still (pure decoration).
  const time = useRef(0);
  useFrame((_, rawDt) => {
    if (useWorldStore.getState().reducedMotion) return;
    time.current += Math.min(rawDt, 0.1);
    const t = time.current;
    const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const n = high ? DUST_COUNT.high : DUST_COUNT.low;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const phase = i * 1.37;
      arr[k] = base[k]! + Math.sin(t * 0.07 + phase) * 0.6;
      // slow rise, wrapping inside a 3.6 m band
      const y = base[k + 1]! - 0.3 + t * 0.025 * (0.5 + (i % 5) * 0.15);
      arr[k + 1] = 0.3 + (y % 3.6);
      arr[k + 2] = base[k + 2]! + Math.cos(t * 0.05 + phase) * 0.5;
    }
    attr.needsUpdate = true;
  });

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
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
        g.fillStyle = "rgba(214,224,238,0.92)";
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
      <Skyline />
      <Partitions />
      <Plants />
      <DustMotes />
      <FloorLabels />
    </group>
  );
}
