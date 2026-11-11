import * as THREE from "three";

/**
 * Canvas-generated textures (§0.6: no binary assets). Each one is built once on first use and cached for the
 * page's lifetime; colour maps are tagged sRGB. Client-only: everything here touches `document`.
 */

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export function canvasTexture(w: number, h: number, draw: Draw, colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = colorSpace;
  t.anisotropy = 4;
  return t;
}

/** Deterministic hash noise in [0, 1): textures look the same on every load. */
export function hash(x: number, y: number, seed = 0): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

const cache = new Map<string, THREE.Texture>();
function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Syntax-coloured "code" lines; repeats vertically so screens can scroll it. */
export function screenTexture(): THREE.CanvasTexture {
  return cached("screen", () => {
    const t = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = "#081120";
      g.fillRect(0, 0, w, h);
      const cols = ["#7cc4d6", "#a78bfa", "#6fe3a4", "#b7c1cf", "#f2b46a", "#6c9eff"];
      for (let y = 8, i = 0; y < h - 4; y += 10, i++) {
        const indent = 10 + (Math.floor(hash(i, 0, 1) * 4) % 4) * 12;
        let x = indent;
        const words = 1 + Math.floor(hash(i, 1, 2) * 5);
        for (let k = 0; k < words && x < w - 16; k++) {
          const len = 8 + Math.floor(hash(i, k, 3) * 40);
          g.fillStyle = cols[Math.floor(hash(i, k, 4) * cols.length)]!;
          g.globalAlpha = 0.9;
          g.fillRect(x, y, Math.min(len, w - 10 - x), 4);
          x += len + 7;
        }
      }
      g.globalAlpha = 1;
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

/** Soft dark radial blob: contact shadows under robots and furniture. */
export function blobTexture(): THREE.CanvasTexture {
  return cached("blob", () =>
    canvasTexture(128, 128, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, "rgba(0,0,0,0.6)");
      gr.addColorStop(0.55, "rgba(0,0,0,0.28)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, w, w);
    }),
  );
}

/** Soft white radial glow: dust motes, floor highlights, light pools. */
export function glowTexture(): THREE.CanvasTexture {
  return cached("glow", () =>
    canvasTexture(64, 64, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.35, "rgba(255,255,255,0.45)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, w, w);
    }),
  );
}

/** The page's resolved UI font stack (next/font hashes the Inter family name, so read it from the body). */
export function uiFont(): string {
  const fallback = "Inter, ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.body).fontFamily || fallback;
}
