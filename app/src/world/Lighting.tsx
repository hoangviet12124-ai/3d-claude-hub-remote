"use client";

import { useEffect, useRef } from "react";
import type * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useWorldStore } from "@/state/useWorldStore";
import { useRenderCount } from "@/world/renderCounts";

/**
 * Ánh sáng ban ngày đều cho kiểu bản vẽ: một đèn hướng tạo bóng nhẹ (2048 ở chất lượng cao, không bóng ở
 * chất lượng thấp), đèn bán cầu trắng làm sáng đều, và môi trường Lightformer trắng nhạt cho vật liệu PBR.
 * three r186 has no PCFSoftShadowMap: the Canvas uses "percentage" (PCFShadowMap) and the softness comes from
 * `shadow.radius`.
 */

export function Lighting() {
  useRenderCount("Lighting");
  const high = useWorldStore((s) => s.quality === "high");
  const sun = useRef<THREE.DirectionalLight>(null);
  const get = useThree((s) => s.get);

  // The Environment stays mounted in both qualities (it renders once, `frames={1}`); low quality only
  // detaches it from the scene. Unmounting it leaked one GPU texture per high → low → high cycle (drei
  // disposes its cube target but three's PMREM cache is keyed on the cube texture's "dispose" event; measured
  // 15 → 16 → 17 textures), and remounting re-rendered the cube and re-ran PMREM on every switch.
  const envTexture = useRef<THREE.Texture | null>(null);
  useEffect(() => {
    const scene = get().scene;
    if (scene.environment) envTexture.current = scene.environment;
    scene.environment = high ? envTexture.current : null;
  }, [high, get]);

  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    const cam = light.shadow.camera;
    cam.left = -22;
    cam.right = 22;
    cam.top = 16;
    cam.bottom = -16;
    cam.near = 2;
    cam.far = 48;
    cam.updateProjectionMatrix();
    light.shadow.radius = 6;
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.025;
    light.target.position.set(0, 0, 1.5);
    light.target.updateMatrixWorld();
  }, []);

  return (
    <>
      <hemisphereLight args={["#ffffff", "#cfd5ee", high ? 1.9 : 2.3]} />
      <ambientLight color="#ffffff" intensity={0.35} />
      <directionalLight
        ref={sun}
        color="#ffffff"
        intensity={high ? 1.5 : 1.7}
        position={[10, 18, 6]}
        castShadow={high}
        shadow-mapSize={[2048, 2048]}
      />
      <Environment resolution={64} frames={1} background={false} environmentIntensity={0.35}>
        <Lightformer form="rect" intensity={1.2} color="#ffffff" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[30, 20, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#dfe4ff" position={[0, 3, 20]} rotation-y={Math.PI} scale={[30, 6, 1]} />
      </Environment>
    </>
  );
}
