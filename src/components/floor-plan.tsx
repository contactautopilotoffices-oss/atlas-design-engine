"use client";
import type { FloorPlan } from "@/modules/core/schemas";

export type RoomState = "empty" | "submitted";

export type HoverAnchor = { xPct: number; yPct: number };

/** Interactive 2D plan. Rooms are SVG polygons in plan units; hovering shows previews and clicking selects it. */
export function FloorPlanView({
  plan,
  activeRoomId,
  hoveredRoomId,
  roomStates,
  roomTypeNames,
  onSelect,
  onHoverRoom,
}: {
  plan: FloorPlan;
  activeRoomId: string | null;
  hoveredRoomId?: string | null;
  roomStates: Record<string, RoomState>;
  roomTypeNames: Record<string, string>;
  onSelect: (roomId: string) => void;
  onHoverRoom?: (roomId: string | null, anchor?: HoverAnchor) => void;
}) {
  const pad = 0.6;
  const drawing = plan.background;
  const vbWidth = plan.width + pad * 2;
  const vbHeight = plan.height + pad * 2;
  const vb = `${-pad} ${-pad} ${vbWidth} ${vbHeight}`;
  const line = Math.max(plan.width, plan.height) / 400;
  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-100">
      {plan.isSample && (
        <div className="bg-planned px-3 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-white">Sample layout, not real property geometry</div>
      )}
      <svg viewBox={vb} className="block h-auto w-full" role="group" aria-label={plan.name}>
        <defs>
          <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#efe9df" strokeWidth="0.02" />
          </pattern>
        </defs>
        <rect x={-pad} y={-pad} width={vbWidth} height={vbHeight} fill={drawing ? "#ffffff" : "url(#grid)"} />
        {drawing ? (
          // The real drawing sits underneath; rooms are see-through click areas on top of it.
          <image href={`/api/assets/floor-plans/${drawing.key}`} x={0} y={0} width={plan.width} height={plan.height} preserveAspectRatio="none" />
        ) : (
          <rect x={0} y={0} width={plan.width} height={plan.height} fill="none" stroke="#1d1b18" strokeWidth="0.12" />
        )}
        {plan.rooms.map((room) => {
          const active = room.id === activeRoomId || room.id === hoveredRoomId;
          const state = roomStates[room.id] ?? "empty";
          const pts = room.polygon.map((p) => p.join(",")).join(" ");
          const cx = room.polygon.reduce((s, p) => s + p[0], 0) / room.polygon.length;
          const cy = room.polygon.reduce((s, p) => s + p[1], 0) / room.polygon.length;
          const anchor: HoverAnchor = {
            xPct: ((cx + pad) / vbWidth) * 100,
            yPct: ((cy + pad) / vbHeight) * 100,
          };
          const w = Math.max(...room.polygon.map((p) => p[0])) - Math.min(...room.polygon.map((p) => p[0]));
          const h = Math.max(...room.polygon.map((p) => p[1])) - Math.min(...room.polygon.map((p) => p[1]));
          // Fit the label to the room's width so names never spill into neighbouring rooms.
          const fs = Math.max(0.22, Math.min(0.6, h / 6, (w * 0.9) / (room.name.length * 0.58)));
          const sub = `${roomTypeNames[room.roomTypeId] ?? ""}${room.dimensions ? ` · ${room.dimensions.length} x ${room.dimensions.width} ${plan.unit}` : ""}`;
          const subFs = Math.min(fs * 0.7, (w * 0.9) / (sub.length * 0.55));
          return (
            <g
              key={room.id}
              role="button"
              tabIndex={0}
              aria-label={`${room.name}${state === "submitted" ? ", choice submitted" : ""}`}
              onClick={() => onSelect(room.id)}
              onMouseEnter={() => onHoverRoom?.(room.id, anchor)}
              onMouseLeave={() => onHoverRoom?.(null)}
              onFocus={() => onHoverRoom?.(room.id, anchor)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(room.id)}
              className="cursor-pointer outline-none [&:focus-visible>polygon]:stroke-[#8a6a45]"
            >
              <title>{room.name}</title>
              {drawing ? (
                <polygon
                  points={pts}
                  fill={active ? "rgba(138,106,69,0.35)" : state === "submitted" ? "rgba(47,122,91,0.22)" : "rgba(138,106,69,0.12)"}
                  stroke={active ? "#8a6a45" : state === "submitted" ? "#2f7a5b" : "rgba(138,106,69,0.75)"}
                  strokeWidth={active ? line * 2 : line}
                  className="transition-[fill] duration-200 hover:fill-[rgba(138,106,69,0.25)]"
                />
              ) : (
                <polygon
                  points={pts}
                  fill={active ? "#e9dcc8" : state === "submitted" ? "#e3f0ea" : "#faf8f4"}
                  stroke={active ? "#8a6a45" : "#3b3731"}
                  strokeWidth={active ? 0.1 : 0.05}
                  className="transition-[fill] duration-200 hover:fill-[#f1e8da]"
                />
              )}
              {drawing && state === "submitted" && <circle cx={cx} cy={cy} r={Math.min(w, h, plan.width / 40) * 0.25} fill="#2f7a5b" stroke="#fff" strokeWidth={line} pointerEvents="none" />}
              {!drawing && <text x={cx} y={cy - fs * 0.3} textAnchor="middle" fontSize={fs} fontWeight={600} fill="#1d1b18" pointerEvents="none">
                {room.name}
              </text>}
              {!drawing && <text x={cx} y={cy + fs * 0.9} textAnchor="middle" fontSize={subFs} fill="#6e6556" pointerEvents="none">
                {sub}
              </text>}
              {!drawing && state === "submitted" && <circle cx={cx} cy={cy + fs * 1.8} r={fs * 0.28} fill="#2f7a5b" pointerEvents="none" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
