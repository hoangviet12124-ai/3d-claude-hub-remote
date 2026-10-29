import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * Lazily created, page-lifetime pools of geometries and materials (§6.8). Meshes receive these through the
 * `geometry` / `material` props, which fiber never disposes, so StrictMode remounts and quality switches
 * reuse the same GPU resources. Per-instance materials (desk screens, the mission-control canvas) are
 * created by their components and disposed on unmount instead.
 */

const geometryPool = new Map<string, THREE.BufferGeometry>();
const materialPool = new Map<string, THREE.Material>();

export function sharedGeometry<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geometryPool.get(key) as T | undefined;
  if (!g) {
    g = make();
    geometryPool.set(key, g);
  }
  return g;
}

export function sharedMaterial<T extends THREE.Material>(key: string, make: () => T): T {
  let m = materialPool.get(key) as T | undefined;
  if (!m) {
    m = make();
    materialPool.set(key, m);
  }
  return m;
}

/** Unit primitives: scale them per mesh/instance instead of building new geometry. */
export const geometries = {
  box: () => sharedGeometry("box", () => new THREE.BoxGeometry(1, 1, 1)),
  roundedBox: () => sharedGeometry("roundedBox", () => new RoundedBoxGeometry(1, 1, 1, 3, 0.08)),
  /** Rounded slab whose corner radius stays small once scaled to a desk top. */
  slab: () => sharedGeometry("slab", () => new RoundedBoxGeometry(2.1, 0.07, 0.95, 3, 0.03)),
  capsule: () => sharedGeometry("capsule", () => new THREE.CapsuleGeometry(0.5, 1, 6, 14)),
  cylinder: () => sharedGeometry("cylinder", () => new THREE.CylinderGeometry(0.5, 0.5, 1, 28)),
  cylinderLow: () => sharedGeometry("cylinderLow", () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10)),
  sphere: () => sharedGeometry("sphere", () => new THREE.SphereGeometry(0.5, 18, 12)),
  /** Unit-radius disc lying flat (XZ plane). */
  disc: () => sharedGeometry("disc", () => new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2)),
  /** Flat ring (inner 0.9, outer 1) lying in the XZ plane. */
  ring: () => sharedGeometry("ring", () => new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2)),
  /** Unit plane facing +z. */
  plane: () => sharedGeometry("plane", () => new THREE.PlaneGeometry(1, 1)),
  /** Unit plane lying flat, facing +y. */
  floorPlane: () => sharedGeometry("floorPlane", () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
};

export const materials = {
  floor: () => sharedMaterial("floor", () => new THREE.MeshStandardMaterial({ color: "#f7f8fd", roughness: 0.9, metalness: 0 })),
  wall: () => sharedMaterial("wall", () => new THREE.MeshStandardMaterial({ color: "#f2f4fb", roughness: 0.9, metalness: 0 })),
  wallTrim: () => sharedMaterial("wallTrim", () => new THREE.MeshStandardMaterial({ color: "#2a3590", roughness: 0.7, metalness: 0 })),
  glass: () =>
    sharedMaterial(
      "glass",
      () =>
        new THREE.MeshPhysicalMaterial({
          color: "#9cc2e0",
          transparent: true,
          opacity: 0.2,
          roughness: 0.06,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    ),
  windowGlass: () =>
    sharedMaterial(
      "windowGlass",
      () =>
        new THREE.MeshPhysicalMaterial({
          color: "#6f8fb8",
          transparent: true,
          opacity: 0.1,
          roughness: 0.03,
          metalness: 0.1,
          clearcoat: 1,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    ),
  metal: () => sharedMaterial("metal", () => new THREE.MeshStandardMaterial({ color: "#c3cae6", roughness: 0.6, metalness: 0.1 })),
  darkMetal: () => sharedMaterial("darkMetal", () => new THREE.MeshStandardMaterial({ color: "#3a47a8", roughness: 0.6, metalness: 0.1 })),
  ceramic: () => sharedMaterial("ceramic", () => new THREE.MeshStandardMaterial({ color: "#d8d2c6", roughness: 0.55, metalness: 0 })),
  joint: () => sharedMaterial("joint", () => new THREE.MeshStandardMaterial({ color: "#46529e", roughness: 0.6, metalness: 0.1 })),
  desk: () => sharedMaterial("desk", () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7, metalness: 0 })),
  wood: () => sharedMaterial("wood", () => new THREE.MeshStandardMaterial({ color: "#e0a868", roughness: 0.7, metalness: 0 })),
  fabric: () => sharedMaterial("fabric", () => new THREE.MeshStandardMaterial({ color: "#6f7fd6", roughness: 0.92, metalness: 0 })),
  fabricWarm: () => sharedMaterial("fabricWarm", () => new THREE.MeshStandardMaterial({ color: "#9a6fd0", roughness: 0.9, metalness: 0 })),
  plastic: () => sharedMaterial("plastic", () => new THREE.MeshStandardMaterial({ color: "#2d3a9c", roughness: 0.6, metalness: 0 })),
  screenOff: () => sharedMaterial("screenOff", () => new THREE.MeshStandardMaterial({ color: "#1d2a7a", roughness: 0.4, metalness: 0 })),
  leaf: () => sharedMaterial("leaf", () => new THREE.MeshStandardMaterial({ color: "#2f6b4c", roughness: 0.78, metalness: 0 })),
  leafDark: () => sharedMaterial("leafDark", () => new THREE.MeshStandardMaterial({ color: "#245a40", roughness: 0.8, metalness: 0 })),
  soil: () => sharedMaterial("soil", () => new THREE.MeshStandardMaterial({ color: "#2a2018", roughness: 1, metalness: 0 })),
  whiteboard: () => sharedMaterial("whiteboard", () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5, metalness: 0 })),
  /** Instanced pieces that carry per-instance colour (`setColorAt`). */
  instanceWhite: () => sharedMaterial("instanceWhite", () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7, metalness: 0 })),
};
