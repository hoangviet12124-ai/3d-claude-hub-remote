"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { AGENTS, getAgent } from "@/agents/AgentRegistry";
import type { AgentId, AgentState, AgentStatus } from "@/agents/agentTypes";
import type { LiveWorldState } from "@/integrations/AgentBackend";
import { PHASE_LABEL } from "@/components/ui";
import { isTerminal } from "@/simulation/WorkflowStateMachine";
import { shortTitle } from "@/simulation/workContent";
import { FLOOR, HUB_CENTER, LOCATIONS, LOUNGE_CENTER, MEETING_CENTER, MISSION_CONTROL } from "@/simulation/worldLayout";
import { liveWorld, useWorldStore } from "@/state/useWorldStore";
import type { Task } from "@/tasks/taskTypes";
import { Instanced } from "@/world/Instanced";
import type { InstanceSpec } from "@/world/Instanced";
import { canvasTexture, glowTexture, screenTexture, uiFont } from "@/world/proceduralTextures";
import { geometries, materials, sharedGeometry, sharedMaterial } from "@/world/sharedResources";
import { STATIONS } from "@/world/stationOwners";
import type { StationDef } from "@/world/stationOwners";
import { useRenderCount } from "@/world/renderCounts";

/**
 * §6.3. Desks whose screens glow while their owner works, the operations hub, the mission-control wall,
 * the planning board, the collaboration table and the lounge. Furniture repeated across desks is one
 * InstancedMesh per part; only things with their own live state (screens, the hub ring, the two canvas
 * boards) are separate draw calls. Everything live reads `liveWorld` inside `useFrame` and never re-renders.
 */

const DESK_TOP_Y = 0.76;

function agentOf(id: AgentId): AgentState | undefined {
  return liveWorld.snapshot?.agents.find((a) => a.id === id);
}

/**
 * How brightly a desk's screens glow for its owner's status. Only while the owner is actually at this desk:
 * with robots on screen, a lit desk whose owner is visibly working at the planning board would be a lie.
 */
function glowFor(a: AgentState | undefined, running: boolean, here: boolean): number {
  if (!a || a.paused) return 0.08;
  if (!here) return 0.14;
  switch (a.status) {
    case "working":
      return running ? 2.1 : 1.3;
    case "thinking":
      return 0.6;
    case "communicating":
      return 0.4;
    case "success":
      return 1.2;
    case "error":
      return 0.6;
    default:
      return 0.14;
  }
}

/** Rotate a local (x, z) offset by heading `ry` about +y and add the origin. */
function place(ox: number, oz: number, ry: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return [ox + lx * c + lz * s, oz - lx * s + lz * c];
}

function monitorLayout(n: number): { dx: number; ry: number }[] {
  if (n >= 3) return [
    { dx: -0.68, ry: 0.32 },
    { dx: 0, ry: 0 },
    { dx: 0.68, ry: -0.32 },
  ];
  return [
    { dx: -0.36, ry: 0.12 },
    { dx: 0.36, ry: -0.12 },
  ];
}

const MONITOR_Y = 1.14;
const MONITOR_Z = -0.2;

// ───────────────────────── desk furniture (instanced across all stations) ─────────────────────────

function useDeskParts() {
  return useMemo(() => {
    const slabs: InstanceSpec[] = [];
    const legs: InstanceSpec[] = [];
    const panels: InstanceSpec[] = [];
    const bezels: InstanceSpec[] = [];
    const stands: InstanceSpec[] = [];
    const feet: InstanceSpec[] = [];
    const keyboards: InstanceSpec[] = [];
    const mugs: InstanceSpec[] = [];
    const strips: InstanceSpec[] = [];
    const seats: InstanceSpec[] = [];
    const backs: InstanceSpec[] = [];
    const posts: InstanceSpec[] = [];
    const bases: InstanceSpec[] = [];
    for (const s of STATIONS) {
      const { x, z } = s.position;
      const R = s.rotation;
      // Desk-local (lx, lz) → world; +lz is the side the agent stands on.
      const at = (lx: number, lz: number) => place(x, z, R, lx, lz);
      slabs.push({ p: [x, DESK_TOP_Y, z], r: [0, R, 0] });
      for (const sx of [-0.98, 0.98]) for (const sz of [-0.4, 0.4]) {
        const [lx, lz] = at(sx, sz);
        legs.push({ p: [lx, DESK_TOP_Y / 2, lz], s: [0.06, DESK_TOP_Y, 0.06] });
      }
      const [px0, pz0] = at(0, -0.4);
      panels.push({ p: [px0, 0.47, pz0], r: [0, R, 0], s: [1.9, 0.42, 0.025] });
      for (const m of monitorLayout(s.monitors)) {
        const [mx, mz] = at(m.dx, MONITOR_Z);
        bezels.push({ p: [mx, MONITOR_Y, mz], r: [0, R + m.ry, 0], s: [0.64, 0.4, 0.035] });
        const [px, pz] = place(mx, mz, R + m.ry, 0, -0.04);
        stands.push({ p: [px, 0.94, pz], s: [0.04, 0.3, 0.04] });
        feet.push({ p: [px, DESK_TOP_Y + 0.045, pz], r: [0, R + m.ry, 0], s: [0.24, 0.015, 0.15] });
      }
      const [kx, kz] = at(-0.05, 0.2);
      keyboards.push({ p: [kx, DESK_TOP_Y + 0.045, kz], r: [0, R, 0], s: [0.52, 0.02, 0.17] });
      const [ux, uz] = at(0.82, 0.22);
      mugs.push({ p: [ux, DESK_TOP_Y + 0.085, uz], s: [0.08, 0.1, 0.08] });
      const [sx0, sz0] = at(0, 0.477);
      strips.push({ p: [sx0, DESK_TOP_Y - 0.02, sz0], r: [0, R, 0], s: [1.95, 0.012, 0.012], c: getAgent(s.owner).color });
      // Chair pushed back and turned aside, clear of the stand slot 1.2 m in front of the desk.
      const cr = R + 0.55;
      const [cx, cz] = at(0.78, 0.72);
      seats.push({ p: [cx, 0.48, cz], r: [0, cr, 0], s: [0.5, 0.08, 0.48] });
      const [bx, bz] = place(cx, cz, cr, 0, 0.24);
      backs.push({ p: [bx, 0.8, bz], r: [-0.12, cr, 0], s: [0.48, 0.52, 0.07] });
      posts.push({ p: [cx, 0.25, cz], s: [0.06, 0.42, 0.06] });
      bases.push({ p: [cx, 0.03, cz], s: [0.56, 0.04, 0.56] });
    }
    return { slabs, legs, panels, bezels, stands, feet, keyboards, mugs, strips, seats, backs, posts, bases };
  }, []);
}

function DeskFurniture() {
  const parts = useDeskParts();
  const strip = sharedMaterial("deskStrip", () => new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }));
  return (
    <group name="desk-furniture">
      <Instanced geometry={geometries.slab()} material={materials.desk()} items={parts.slabs} castShadow />
      <Instanced geometry={geometries.box()} material={materials.metal()} items={parts.legs} castShadow />
      <Instanced geometry={geometries.box()} material={materials.darkMetal()} items={parts.panels} castShadow />
      <Instanced geometry={geometries.box()} material={materials.plastic()} items={parts.bezels} castShadow />
      <Instanced geometry={geometries.box()} material={materials.metal()} items={parts.stands} />
      <Instanced geometry={geometries.box()} material={materials.darkMetal()} items={parts.feet} />
      <Instanced geometry={geometries.box()} material={materials.plastic()} items={parts.keyboards} />
      <Instanced geometry={geometries.cylinderLow()} material={materials.ceramic()} items={parts.mugs} />
      <Instanced geometry={geometries.box()} material={strip} items={parts.strips} receiveShadow={false} />
      <Instanced geometry={geometries.roundedBox()} material={materials.fabric()} items={parts.seats} castShadow />
      <Instanced geometry={geometries.roundedBox()} material={materials.fabric()} items={parts.backs} castShadow />
      <Instanced geometry={geometries.cylinderLow()} material={materials.darkMetal()} items={parts.posts} />
      <Instanced geometry={geometries.cylinder()} material={materials.darkMetal()} items={parts.bases} castShadow />
    </group>
  );
}

// ───────────────────────── per-desk live parts ─────────────────────────

/** The screens of one desk: one InstancedMesh with its own scrolling texture and emissive level. */
function DeskScreens({ station }: { station: StationDef }) {
  useRenderCount("DeskScreens");
  const items = useMemo<InstanceSpec[]>(() => {
    const { x, z } = station.position;
    const R = station.rotation;
    return monitorLayout(station.monitors).map((m) => {
      const [mx, mz] = place(x, z, R, m.dx, MONITOR_Z);
      const [sx, sz] = place(mx, mz, R + m.ry, 0, 0.019);
      return { p: [sx, MONITOR_Y + 0.005, sz], r: [0, R + m.ry, 0], s: [0.6, 0.355, 1] };
    });
  }, [station]);

  const { material, texture } = useMemo(() => {
    const texture = screenTexture().clone();
    texture.repeat.set(1, 0.55);
    texture.offset.set(0, Math.abs(Math.sin(station.position.x)) % 1);
    const material = new THREE.MeshStandardMaterial({
      color: "#03060b",
      roughness: 0.22,
      metalness: 0.2,
      emissive: "#ffffff",
      emissiveMap: texture,
      emissiveIntensity: 0.14,
    });
    return { material, texture };
  }, [station]);
  useEffect(
    () => () => {
      material.dispose();
      texture.dispose();
    },
    [material, texture],
  );

  const meshRef = useRef<THREE.InstancedMesh>(null);
  useFrame((_, rawDt) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const dt = Math.min(rawDt, 0.1);
    const snap = liveWorld.snapshot;
    const running = snap?.status === "running";
    const owner = agentOf(station.owner);
    const here = owner?.location === station.id;
    const goal = glowFor(owner, running, here);
    mat.emissiveIntensity = THREE.MathUtils.damp(mat.emissiveIntensity, goal, 3, dt);
    const working = here && owner?.status === "working" && !owner.paused;
    // Scrolling code says "working"; reduced motion keeps it, slower.
    const scroll = (working && running ? 0.09 : 0.004) * (useWorldStore.getState().reducedMotion ? 0.3 : 1);
    if (mat.emissiveMap) mat.emissiveMap.offset.y = (mat.emissiveMap.offset.y + dt * scroll) % 1;
  });

  return <Instanced name={`screens-${station.id}`} meshRef={meshRef} geometry={geometries.plane()} material={material} items={items} receiveShadow={false} />;
}

/** Floor glow under a desk while it is hovered or its owner is selected. */
function DeskHighlight({ station }: { station: StationDef }) {
  const ref = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: getAgent(station.owner).color,
        map: glowTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    [station],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const st = useWorldStore.getState();
    const hovered = st.hovered === `station:${station.id}`;
    const selected = st.selectedAgentId === station.owner && st.selectedAgentId !== null;
    const goal = hovered ? 0.5 : selected ? 0.3 : 0;
    const mesh = ref.current;
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = THREE.MathUtils.damp(mat.opacity, goal, 8, dt);
    mesh.visible = mat.opacity > 0.004;
  });
  return (
    <mesh
      ref={ref}
      geometry={geometries.floorPlane()}
      material={material}
      position={[station.position.x, 0.012, station.position.z + 0.3 * Math.cos(station.rotation)]}
      scale={[3.6, 1, 2.6]}
      visible={false}
      renderOrder={1}
    />
  );
}

function Desks() {
  return (
    <group name="desks">
      <DeskFurniture />
      {STATIONS.map((s) => (
        <group key={s.id}>
          <DeskScreens station={s} />
          <DeskHighlight station={s} />
        </group>
      ))}
    </group>
  );
}

// ───────────────────────── operations hub ─────────────────────────

function OperationsHub() {
  const color = getAgent("orion").color;
  const ringRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const topRef = useRef<THREE.Mesh>(null);
  const torus = sharedGeometry("hubTorus", () => new THREE.TorusGeometry(0.98, 0.035, 10, 72).rotateX(Math.PI / 2));
  const { ringMat, haloMat, topMat } = useMemo(
    () => ({
      ringMat: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, toneMapped: false }),
      haloMat: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      topMat: new THREE.MeshStandardMaterial({ color: "#e6eaf8", emissive: color, emissiveIntensity: 0.08, roughness: 0.15, metalness: 0.4 }),
    }),
    [color],
  );
  useEffect(
    () => () => {
      ringMat.dispose();
      haloMat.dispose();
      topMat.dispose();
    },
    [ringMat, haloMat, topMat],
  );
  const level = useRef(0.3);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = state.clock.elapsedTime;
    const snap = liveWorld.snapshot;
    const running = snap?.status === "running";
    const orion = agentOf("orion");
    const working = !!orion && !orion.paused && orion.location === "hub" && (orion.status === "working" || orion.status === "thinking") && running;
    level.current = THREE.MathUtils.damp(level.current, working ? 1 : 0.3, 3, dt);
    const reduced = useWorldStore.getState().reducedMotion;
    const pulse = working && !reduced ? 0.5 + 0.5 * Math.sin(t * 4.2) : 0.5;
    const ring = ringRef.current;
    const top = topRef.current;
    if (ring) (ring.material as THREE.MeshBasicMaterial).opacity = 0.25 + level.current * (0.35 + 0.35 * pulse);
    if (top) (top.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.04 + level.current * 0.14;
    if (haloRef.current) {
      (haloRef.current.material as THREE.MeshBasicMaterial).opacity = 0.06 + level.current * 0.22 * (0.6 + 0.4 * pulse);
      if (!reduced) {
        haloRef.current.rotation.y += dt * (0.15 + level.current * 0.6);
        haloRef.current.position.y = 1.28 + Math.sin(t * 1.3) * 0.03;
      }
    }
  });

  const { x, z } = HUB_CENTER;
  return (
    <group name="operations-hub" position={[x, 0, z]}>
      <mesh geometry={geometries.cylinder()} material={materials.desk()} position={[0, 0.42, 0]} scale={[2.0, 0.84, 2.0]} castShadow receiveShadow />
      <mesh geometry={geometries.cylinder()} material={materials.darkMetal()} position={[0, 0.04, 0]} scale={[2.2, 0.08, 2.2]} receiveShadow />
      <mesh ref={topRef} geometry={geometries.cylinder()} material={topMat} position={[0, 0.875, 0]} scale={[1.9, 0.05, 1.9]} receiveShadow />
      <mesh ref={ringRef} geometry={torus} material={ringMat} position={[0, 0.9, 0]} />
      <mesh ref={haloRef} geometry={geometries.ring()} material={haloMat} position={[0, 1.28, 0]} scale={[0.62, 1, 0.62]} />
    </group>
  );
}

// ───────────────────────── mission control wall screen ─────────────────────────

const MC_W = 1024;
const MC_H = 384;
const MC_REDRAW_MS = 250;

function missionSignature(tasks: readonly Task[], agents: readonly AgentState[], simulated: boolean, live: LiveWorldState | undefined): string {
  let sig = `${simulated ? 1 : 0}|${tasks.length}|`;
  if (live) {
    sig += `${live.focus.mode}:${live.focus.sessionId ?? ""}|`;
    for (const s of live.sessions) sig += `${s.sessionId}:${s.status}:${s.title};`;
  }
  for (const t of tasks) sig += `${t.id}:${t.phase}:${t.status}:${t.assignedAgentId ?? ""}:${t.iteration}:${Math.round(t.progress * 50)};`;
  for (const a of agents) sig += `${a.status}${a.paused ? "p" : ""};`;
  return sig;
}

/**
 * Live with several sessions: the wall shows the session the robots follow (its tasks only), and a line for the rest.
 * Returns the tasks to list and the header/footer text; with no live state it is the whole task list as before.
 */
function focusView(tasks: readonly Task[], live: LiveWorldState | undefined): { tasks: readonly Task[]; following: string | null; others: string | null } {
  if (!live || live.sessions.length === 0) return { tasks, following: null, others: null };
  const focused = live.sessions.find((s) => s.sessionId === live.focus.sessionId) ?? null;
  const mine = focused ? tasks.filter((t) => !t.origin || t.origin.sessionId === focused.sessionId) : tasks;
  const rest = live.sessions.filter((s) => s.sessionId !== live.focus.sessionId && s.status !== "ended");
  const waiting = rest.filter((s) => s.status === "waiting").length;
  const running = rest.filter((s) => s.status === "running").length;
  const detail = [running ? `${running} running` : "", waiting ? `${waiting} waiting for you` : ""].filter(Boolean).join(", ");
  return {
    tasks: mine,
    following: focused ? `${live.focus.mode === "pinned" ? "PINNED" : "FOLLOWING"}: ${shortTitle(focused.title, 34)}${focused.project ? ` · ${focused.project}` : ""}` : null,
    others: rest.length ? `+${rest.length} other session${rest.length === 1 ? "" : "s"}${detail ? ` (${detail})` : ""}` : null,
  };
}

function drawMissionControl(g: CanvasRenderingContext2D, allTasks: readonly Task[], agents: readonly AgentState[], simulated: boolean, live?: LiveWorldState): void {
  const view = focusView(allTasks, live);
  const tasks = view.tasks;
  const font = uiFont();
  g.fillStyle = "#060a11";
  g.fillRect(0, 0, MC_W, MC_H);
  // faint grid
  g.strokeStyle = "rgba(124,196,214,0.05)";
  g.lineWidth = 1;
  for (let x = 0; x < MC_W; x += 32) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, MC_H);
    g.stroke();
  }
  g.textBaseline = "alphabetic";
  g.fillStyle = "#7c8797";
  g.font = `600 17px ${font}`;
  g.textAlign = "left";
  g.fillText(`BẢNG VỤ VIỆC  ·  ${simulated ? "MÔ PHỎNG · KHÔNG GỌI AI" : view.following ?? "DỮ LIỆU THẬT"}`, 28, 38);
  const done = tasks.filter((t) => t.phase === "done").length;
  const open = tasks.filter((t) => !isTerminal(t.phase)).length;
  g.textAlign = "right";
  g.fillText(`${done} xong · ${open} đang làm`, MC_W - 28, 38);
  g.textAlign = "left";
  g.fillStyle = "rgba(124,196,214,0.25)";
  g.fillRect(28, 50, MC_W - 56, 1);

  const active = tasks.filter((t) => !isTerminal(t.phase)).slice(0, view.others ? 4 : 5);
  if (view.others) {
    g.fillStyle = "#f2b46a";
    g.font = `600 16px ${font}`;
    g.fillText(view.others, 28, MC_H - 72);
  }
  if (active.length === 0) {
    g.fillStyle = "#b7c1cf";
    g.font = `500 26px ${font}`;
    g.fillText(simulated ? "Chưa có vụ việc." : "Đang chờ phiên làm việc…", 28, 120);
    g.fillStyle = "#7c8797";
    g.font = `500 18px ${font}`;
    g.fillText(simulated ? "Bấm Chạy thử hoặc Tạo việc để giao việc cho Manager." : "Vụ việc hiện ở đây khi có dữ liệu.", 28, 152);
  }
  active.forEach((t, i) => {
    const y = 88 + i * 48;
    const owner = t.assignedAgentId ? getAgent(t.assignedAgentId) : null;
    g.fillStyle = "#eef2f7";
    g.font = `600 20px ${font}`;
    g.fillText(`${t.id}  ${shortTitle(t.title, 44)}`, 28, y);
    g.fillStyle = t.status === "blocked" ? "#f2b46a" : owner ? owner.color : "#7c8797";
    g.font = `500 16px ${font}`;
    const phase = t.status === "blocked" ? "Tạm dừng" : PHASE_LABEL[t.phase];
    g.textAlign = "right";
    g.fillText(`${phase}${owner ? ` · ${owner.name}` : ""}${t.iteration > 1 ? ` · làm lại ${t.iteration - 1}` : ""}`, MC_W - 28, y);
    g.textAlign = "left";
    g.fillStyle = "#1c2534";
    g.fillRect(28, y + 10, MC_W - 56, 6);
    g.fillStyle = t.status === "blocked" ? "#f2b46a" : owner ? owner.color : "#7cc4d6";
    g.fillRect(28, y + 10, (MC_W - 56) * Math.min(1, Math.max(0, t.progress)), 6);
  });

  // Agent status row
  g.fillStyle = "rgba(124,196,214,0.18)";
  g.fillRect(28, MC_H - 58, MC_W - 56, 1);
  const ids: AgentId[] = AGENTS.filter((p) => p.active).map((p) => p.id);
  const step = (MC_W - 56) / ids.length;
  // A status strip, drawn as screen UI (colour bar, caps name, status under it) rather than "● Name · status":
  // close up, the old one-line form read as stray DOM speech bubbles floating over the scene (phase 6).
  ids.forEach((id, i) => {
    const p = getAgent(id);
    const a = agents.find((x) => x.id === id);
    const x = 28 + i * step;
    g.fillStyle = p.color;
    g.fillRect(x, MC_H - 48, 3, 34);
    g.fillStyle = "#7f8a9b";
    g.font = `600 12px ${font}`;
    g.fillText(p.name.toUpperCase(), x + 12, MC_H - 36);
    g.fillStyle = "#c9d2de";
    g.font = `500 15px ${font}`;
    g.fillText(a ? (a.paused ? "tạm dừng" : STATUS_VI[a.status]) : "ngoại tuyến", x + 12, MC_H - 16);
  });
}

const STATUS_VI: Record<AgentStatus, string> = {
  idle: "rảnh",
  walking: "đang đi",
  working: "đang làm",
  thinking: "đang nghĩ",
  communicating: "đang trao đổi",
  success: "xong",
  error: "trả về",
};

function MissionControl() {
  useRenderCount("MissionControl");
  const { texture, material } = useMemo(() => {
    const texture = canvasTexture(MC_W, MC_H, () => undefined);
    texture.anisotropy = 8;
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    return { texture, material };
  }, []);
  useEffect(
    () => () => {
      material.dispose();
      texture.dispose();
    },
    [material, texture],
  );
  const last = useRef({ at: -Infinity, sig: "" });
  const screenRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const screen = screenRef.current;
    const map = screen ? (screen.material as THREE.MeshBasicMaterial).map : null;
    const ctx = map ? (map.image as HTMLCanvasElement).getContext("2d") : null;
    if (!map || !ctx) return;
    const now = performance.now();
    if (now - last.current.at < MC_REDRAW_MS) return;
    last.current.at = now;
    const snap = liveWorld.snapshot;
    const simulated = useWorldStore.getState().backend.simulated;
    const tasks = snap?.tasks ?? [];
    const agents = snap?.agents ?? [];
    const sig = missionSignature(tasks, agents, simulated, snap?.live);
    if (sig === last.current.sig) return;
    last.current.sig = sig;
    drawMissionControl(ctx, tasks, agents, simulated, snap?.live);
    map.needsUpdate = true;
  });

  const { x, z } = MISSION_CONTROL;
  const W = 7;
  const H = W * (MC_H / MC_W);
  const frame = useMemo<InstanceSpec[]>(
    () => [
      { p: [x, 2.35, z - 0.09], s: [W + 0.3, H + 0.3, 0.12] },
      { p: [x - W / 2 + 0.6, 4.05, z - 0.12], s: [0.06, 0.95, 0.06] },
      { p: [x + W / 2 - 0.6, 4.05, z - 0.12], s: [0.06, 0.95, 0.06] },
      // low console under the screen
      { p: [x, 0.4, z + 0.15], s: [5.2, 0.8, 0.55] },
    ],
    [x, z, H],
  );
  const consoleGlow = sharedMaterial("mcGlow", () => new THREE.MeshBasicMaterial({ color: "#7cc4d6", transparent: true, opacity: 0.55, toneMapped: false }));
  return (
    <group name="mission-control">
      <Instanced geometry={geometries.box()} material={materials.wallTrim()} items={frame} castShadow />
      <mesh ref={screenRef} geometry={geometries.plane()} material={material} position={[x, 2.35, z - 0.02]} scale={[W, H, 1]} />
      <mesh geometry={geometries.box()} material={consoleGlow} position={[x, 0.81, z + 0.43]} scale={[5.1, 0.012, 0.012]} />
    </group>
  );
}

// ───────────────────────── planning board ─────────────────────────

const BOARD = { x: FLOOR.minX + 0.4, z: LOCATIONS.planning.slots[0]!.z, y: 1.55, w: 2.9, h: 1.8 };
export const MAX_STICKIES = 24;
const STICKY_PENDING = "#ffd98a";
const STICKY_DONE = "#9fe3b8";

/** Latest in-flight task with subtasks, else the latest that had any. */
function boardTask(tasks: readonly Task[]): Task | null {
  for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i]!.subtasks.length && !isTerminal(tasks[i]!.phase)) return tasks[i]!;
  for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i]!.subtasks.length) return tasks[i]!;
  return null;
}

function drawBoard(g: CanvasRenderingContext2D, w: number, h: number, task: Task | null): void {
  const font = uiFont();
  g.fillStyle = "#e9ecf1";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#3a4558";
  g.font = `700 22px ${font}`;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText("KẾ HOẠCH KIỂM TRA", 22, 36);
  g.font = `500 16px ${font}`;
  g.fillStyle = "#5b6678";
  g.textAlign = "right";
  g.fillText(task ? `${task.id} · ${shortTitle(task.title, 26)}` : "Chưa có kế hoạch", w - 22, 36);
  g.textAlign = "left";
  g.fillStyle = "#c7ced9";
  g.fillRect(22, 50, w - 44, 2);
  g.fillRect(w / 2 - 1, 62, 2, h - 80);
  g.fillStyle = "#7c8797";
  g.font = `600 15px ${font}`;
  g.fillText("CẦN LÀM", 24, 76);
  g.fillText("ĐÃ XONG", w / 2 + 14, 76);
}

/** Sticky slot (board-local, metres from the board centre; u to the right as seen from the front). */
function stickySlot(i: number, done: boolean): { u: number; v: number } {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const half = BOARD.w / 2;
  const u0 = done ? 0.12 : -half + 0.14;
  return { u: u0 + 0.22 + col * 0.42, v: BOARD.h / 2 - 0.42 - row * 0.32 };
}

function PlanningBoard() {
  const cards = useRef<THREE.InstancedMesh>(null);
  const { texture, material } = useMemo(() => {
    const texture = canvasTexture(640, 400, (g, w, h) => drawBoard(g, w, h, null));
    texture.anisotropy = 8;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.4, metalness: 0 });
    return { texture, material };
  }, []);
  useEffect(
    () => () => {
      material.dispose();
      texture.dispose();
    },
    [material, texture],
  );
  const cardMat = sharedMaterial("sticky", () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, metalness: 0 }));
  const last = useRef({ at: -Infinity, sig: "" });

  useLayoutEffect(() => {
    const mesh = cards.current;
    if (!mesh) return;
    const c = new THREE.Color(STICKY_PENDING);
    for (let i = 0; i < MAX_STICKIES; i++) mesh.setColorAt(i, c);
    mesh.count = 0;
  }, []);

  const boardRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = cards.current;
    const board = boardRef.current;
    const map = board ? (board.material as THREE.MeshStandardMaterial).map : null;
    const ctx = map ? (map.image as HTMLCanvasElement).getContext("2d") : null;
    if (!mesh || !map || !ctx) return;
    const now = performance.now();
    if (now - last.current.at < MC_REDRAW_MS) return;
    last.current.at = now;
    const task = boardTask(liveWorld.snapshot?.tasks ?? []);
    const sig = task ? `${task.id}|${task.title}|${task.subtasks.map((s) => (s.done ? 1 : 0)).join("")}` : "none";
    if (sig === last.current.sig) return;
    last.current.sig = sig;
    drawBoard(ctx, 640, 400, task);
    map.needsUpdate = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI / 2);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(0.36, 0.26, 0.012);
    const col = new THREE.Color();
    const subtasks = task?.subtasks.slice(0, MAX_STICKIES) ?? [];
    let pending = 0;
    let done = 0;
    subtasks.forEach((st, i) => {
      const k = st.done ? done++ : pending++;
      const slot = stickySlot(Math.min(k, 11), st.done);
      // Board faces +x; its local +u runs towards −z in the world.
      const tilt = ((i * 37) % 7) / 7 - 0.5;
      q.setFromEuler(new THREE.Euler(0, Math.PI / 2, tilt * 0.08));
      p.set(BOARD.x + 0.06, BOARD.y + slot.v, BOARD.z - slot.u);
      mesh.setMatrixAt(i, m4.compose(p, q, s));
      mesh.setColorAt(i, col.set(st.done ? STICKY_DONE : STICKY_PENDING));
    });
    mesh.count = subtasks.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const frame = useMemo<InstanceSpec[]>(
    () => [
      { p: [BOARD.x - 0.02, BOARD.y, BOARD.z], s: [0.06, BOARD.h + 0.12, BOARD.w + 0.12] },
      { p: [BOARD.x - 0.02, 0.4, BOARD.z - BOARD.w / 2 + 0.2], s: [0.06, 0.8, 0.06] },
      { p: [BOARD.x - 0.02, 0.4, BOARD.z + BOARD.w / 2 - 0.2], s: [0.06, 0.8, 0.06] },
      { p: [BOARD.x + 0.1, BOARD.y - BOARD.h / 2 - 0.04, BOARD.z], s: [0.16, 0.03, BOARD.w * 0.9] },
    ],
    [],
  );
  return (
    <group name="planning-board">
      <Instanced geometry={geometries.box()} material={materials.darkMetal()} items={frame} castShadow />
      <mesh ref={boardRef} geometry={geometries.plane()} material={material} position={[BOARD.x + 0.015, BOARD.y, BOARD.z]} rotation={[0, Math.PI / 2, 0]} scale={[BOARD.w, BOARD.h, 1]} receiveShadow />
      <instancedMesh ref={cards} args={[geometries.box(), cardMat, MAX_STICKIES]} castShadow={false} receiveShadow frustumCulled={false} />
    </group>
  );
}

// ───────────────────────── meeting table + lounge + archive shelves ─────────────────────────

/** Bàn họp tròn, ghế đặt sau từng chỗ đứng (§5 `collab`). */
function MeetingTable() {
  const c = MEETING_CENTER;
  const parts = useMemo(() => {
    const seats: InstanceSpec[] = [];
    const backs: InstanceSpec[] = [];
    for (const slot of LOCATIONS.collab.slots) {
      const a = Math.atan2(slot.x - c.x, slot.z - c.z);
      const x = c.x + Math.sin(a) * 2.45;
      const z = c.z + Math.cos(a) * 2.45;
      seats.push({ p: [x, 0.46, z], r: [0, a, 0], s: [0.52, 0.08, 0.5] });
      const [bx, bz] = place(x, z, a, 0, 0.24);
      backs.push({ p: [bx, 0.78, bz], r: [-0.1, a, 0], s: [0.5, 0.56, 0.07] });
    }
    return { seats, backs };
  }, [c]);
  return (
    <group name="meeting-table">
      <mesh geometry={geometries.cylinder()} material={materials.wood()} position={[c.x, 0.76, c.z]} scale={[2.1, 0.06, 2.1]} castShadow receiveShadow />
      <mesh geometry={geometries.cylinder()} material={materials.darkMetal()} position={[c.x, 0.38, c.z]} scale={[0.22, 0.76, 0.22]} castShadow />
      <mesh geometry={geometries.cylinder()} material={materials.darkMetal()} position={[c.x, 0.02, c.z]} scale={[1.0, 0.04, 1.0]} receiveShadow />
      <Instanced geometry={geometries.roundedBox()} material={materials.fabric()} items={parts.seats} castShadow />
      <Instanced geometry={geometries.roundedBox()} material={materials.fabric()} items={parts.backs} castShadow />
    </group>
  );
}

/** Góc giải lao: sofa ở nửa vòng phía trong, chỗ đứng ở nửa phía hành lang. */
function Lounge() {
  const c = LOUNGE_CENTER;
  const parts = useMemo(() => {
    const seats: InstanceSpec[] = [];
    const backs: InstanceSpec[] = [];
    for (const deg of [-55, 0, 55]) {
      const a = (deg * Math.PI) / 180;
      const x = c.x + Math.sin(a) * 2.6;
      const z = c.z + Math.cos(a) * 2.6;
      const face = a + Math.PI;
      seats.push({ p: [x, 0.2, z], r: [0, face, 0], s: [1.35, 0.36, 0.62] });
      const [bx, bz] = place(x, z, face, 0, -0.3);
      backs.push({ p: [bx, 0.42, bz], r: [0, face, 0], s: [1.35, 0.5, 0.18] });
    }
    return { seats, backs };
  }, [c]);
  const rug = sharedMaterial("rug", () => new THREE.MeshStandardMaterial({ color: "#dfe4f6", roughness: 0.95, metalness: 0 }));
  return (
    <group name="lounge">
      <mesh geometry={geometries.disc()} material={rug} position={[c.x, 0.006, c.z]} scale={3.3} receiveShadow />
      <mesh geometry={geometries.cylinder()} material={materials.wood()} position={[c.x, 0.4, c.z]} scale={[1.5, 0.05, 1.5]} castShadow receiveShadow />
      <mesh geometry={geometries.cylinder()} material={materials.darkMetal()} position={[c.x, 0.2, c.z]} scale={[1.0, 0.36, 1.0]} castShadow />
      <Instanced geometry={geometries.roundedBox()} material={materials.fabricWarm()} items={parts.seats} castShadow />
      <Instanced geometry={geometries.roundedBox()} material={materials.fabricWarm()} items={parts.backs} castShadow />
    </group>
  );
}

/**
 * Kho lưu trữ: hai dãy kệ sát tường sau, mỗi ô có khối "tài nguyên nghiên cứu" phát sáng (xanh lá: văn bản,
 * xanh ngọc: hồ sơ cũ đã số hóa). Khối sáng hơn khi Thủ thư hoặc Số hóa đang làm việc.
 */
function ArchiveShelves() {
  const SHELF_Z = FLOOR.minZ + 0.55;
  const { frames, boxes } = useMemo(() => {
    const frames: InstanceSpec[] = [];
    const boxes: InstanceSpec[] = [];
    const units = [
      { x0: -19.5, x1: -14.6, color: getAgent("iris").color },
      { x0: -14.2, x1: -9.5, color: getAgent("piper").color },
    ];
    units.forEach((u, ui) => {
      const cx = (u.x0 + u.x1) / 2;
      const w = u.x1 - u.x0;
      frames.push({ p: [cx, 1.25, SHELF_Z - 0.25], s: [w, 2.5, 0.06] });
      for (const x of [u.x0, u.x1]) frames.push({ p: [x, 1.25, SHELF_Z], s: [0.06, 2.5, 0.55] });
      for (let row = 0; row < 4; row++) {
        const y = 0.25 + row * 0.6;
        frames.push({ p: [cx, y, SHELF_Z], s: [w, 0.04, 0.55] });
        const n = Math.floor(w / 0.42);
        for (let k = 0; k < n; k++) {
          if (hash01(ui, row, k) < 0.25) continue;
          const h = 0.22 + hash01(ui, row, k + 50) * 0.22;
          boxes.push({ p: [u.x0 + 0.25 + k * 0.42, y + 0.02 + h / 2, SHELF_Z], s: [0.3, h, 0.36], c: u.color });
        }
      }
    });
    return { frames, boxes };
  }, [SHELF_Z]);
  const boxMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, toneMapped: false }), []);
  useEffect(() => () => boxMat.dispose(), [boxMat]);
  const boxesRef = useRef<THREE.InstancedMesh>(null);
  useFrame((_, rawDt) => {
    const mesh = boxesRef.current;
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const dt = Math.min(rawDt, 0.1);
    const busy = (["iris", "piper", "troly1", "troly2"] as AgentId[]).some((id) => {
      const a = agentOf(id);
      return !!a && (a.location === "research" || a.location === "product" || a.location === "kho_vb" || a.location === "kho_hs") && a.status !== "idle";
    });
    mat.opacity = THREE.MathUtils.damp(mat.opacity, busy ? 0.95 : 0.5, 3, dt);
  });
  return (
    <group name="archive-shelves">
      <Instanced geometry={geometries.box()} material={materials.darkMetal()} items={frames} castShadow />
      <Instanced meshRef={boxesRef} geometry={geometries.box()} material={boxMat} items={boxes} receiveShadow={false} />
    </group>
  );
}

function hash01(a: number, b: number, c: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

export function Workstations() {
  useRenderCount("Workstations");
  return (
    <group name="workstations">
      <Desks />
      <OperationsHub />
      <MissionControl />
      <PlanningBoard />
      <MeetingTable />
      <Lounge />
      <ArchiveShelves />
    </group>
  );
}
