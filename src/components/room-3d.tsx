"use client";
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { SceneBox, SceneModel } from "@/modules/spatial/scene";

const COLOURS: Record<SceneBox["kind"], string> = {
  floor: "#cdbfa8",
  ceiling: "#f4f1ec",
  wall: "#ece6dc",
  door: "#8a6a45",
  window: "#9ec9e6",
  column: "#9b9184",
  obstruction: "#b86b55",
  furniture: "#5f7d8c",
};

function Box({ b, showCeiling }: { b: SceneBox; showCeiling: boolean }) {
  if (b.kind === "ceiling" && !showCeiling) return null;
  const transparent = b.kind === "window" || b.kind === "ceiling" || b.kind === "wall";
  return (
    <mesh position={b.position}>
      <boxGeometry args={b.size} />
      <meshStandardMaterial color={COLOURS[b.kind]} transparent={transparent} depthWrite={!transparent} opacity={b.kind === "window" ? 0.45 : b.kind === "ceiling" ? 0.25 : b.kind === "wall" ? 0.4 : 1} wireframe={false} />
    </mesh>
  );
}

/**
 * Dimensioned 3D room rendered purely from the scene model (measurements only).
 * Furniture boxes are accurately sized placeholders, not real furniture models.
 */
export default function Room3D({ scene, unit, showCeiling = false }: { scene: SceneModel; unit: "m" | "ft"; showCeiling?: boolean }) {
  const { length: L, width: W, height: H } = scene;
  const k = unit === "ft" ? 1 / 0.3048 : 1;
  const span = Math.max(L, W);
  return (
    <Canvas camera={{ position: [L * 1.25, Math.max(H * 2.2, span * 0.9), W * 1.6], fov: 45 }} dpr={[1, 2]}>
      <color attach="background" args={["#f7f4ef"]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[L, H * 4, W * 2]} intensity={1.1} />
      <group position={[-L / 2, 0, -W / 2]}>
        {scene.boxes.map((b) => (
          <Box key={b.id} b={b} showCeiling={showCeiling} />
        ))}
        {scene.boxes
          .filter((b) => b.kind === "furniture" || b.kind === "door" || b.kind === "column")
          .map((b) => (
            <Html key={`l-${b.id}`} position={[b.position[0], b.position[1] + b.size[1] / 2 + 0.15, b.position[2]]} center distanceFactor={span * 1.4} zIndexRange={[10, 0]}>
              <span className="whitespace-nowrap rounded bg-white/85 px-1 text-[10px] text-ink shadow">{b.label}</span>
            </Html>
          ))}
        <Html position={[L / 2, 0.05, W + 0.6]} center>
          <span className="whitespace-nowrap rounded-full bg-ink px-2 py-0.5 text-[11px] text-paper">Length {(L * k).toFixed(2)} {unit}</span>
        </Html>
        <Html position={[L + 0.6, 0.05, W / 2]} center>
          <span className="whitespace-nowrap rounded-full bg-ink px-2 py-0.5 text-[11px] text-paper">Width {(W * k).toFixed(2)} {unit}</span>
        </Html>
        <Html position={[0, H / 2, W + 0.2]} center>
          <span className="whitespace-nowrap rounded-full bg-ink px-2 py-0.5 text-[11px] text-paper">Height {(H * k).toFixed(2)} {unit}</span>
        </Html>
      </group>
      <gridHelper args={[Math.ceil(span * 2), Math.ceil(span * 2), "#d9d1c3", "#ebe5da"]} position={[0, -0.02, 0]} />
      <OrbitControls makeDefault target={[0, H / 3, 0]} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}
