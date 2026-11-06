import { STATION_OWNERS } from "@/agents/AgentRegistry";
import type { AgentId } from "@/agents/agentTypes";
import { LOCATIONS } from "@/simulation/worldLayout";
import type { Vec2 } from "@/simulation/worldLayout";

/**
 * Desks (§5): each sits 1.2 m in front of its stand slot, on the side the agent faces. Back-row desks have
 * rotation 0 (monitors face +z, towards the agent); front-row desks rotation π (monitors face -z).
 * The owner only decides whose status lights the desk's screens; it says nothing about where agents live.
 */
export type StationId = "ops" | "research" | "product" | "dev" | "testing" | "review" | "bot1" | "bot2" | "fin" | "proc" | "draft" | "study";

export interface StationDef {
  id: StationId;
  label: string;
  owner: AgentId;
  /** Desk centre on the floor. */
  position: Vec2;
  rotation: number;
  monitors: number;
}

export const STATION_IDS: StationId[] = ["research", "product", "testing", "review", "ops", "dev", "bot1", "bot2", "fin", "proc", "draft", "study"];

const MONITORS: Record<StationId, number> = { ops: 2, research: 2, product: 2, dev: 3, testing: 2, review: 2, bot1: 2, bot2: 2, fin: 2, proc: 2, draft: 2, study: 2 };

export const STATIONS: StationDef[] = STATION_IDS.map((id) => {
  const slot = LOCATIONS[id].slots[0]!;
  // The agent faces π (back row) or 0 (front row); the desk is 1.2 m ahead of them either way.
  const front = Math.abs(LOCATIONS[id].facing[0]!) < 1;
  return {
    id,
    label: LOCATIONS[id].label,
    owner: STATION_OWNERS[id]!,
    position: { x: slot.x, z: slot.z + (front ? 1.2 : -1.2) },
    rotation: front ? Math.PI : 0,
    monitors: MONITORS[id],
  };
});

const BY_ID = new Map(STATIONS.map((s) => [s.id, s]));

export function getStation(id: StationId): StationDef {
  return BY_ID.get(id)!;
}

