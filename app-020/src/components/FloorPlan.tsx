import { memo, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import type { FacilityKind, Floor, Facility, Pt, Room } from '../model';
import { USAGE_FILLS, FacilityGlyph } from './symbols';

export type Tool = 'select' | 'pan' | 'room' | 'corridor' | FacilityKind;
export type Selection = { type: 'room' | 'facility'; id: string } | null;
export type View = { cx: number; cy: number; zoom: number }; // zoom: px per mm

export type DragState = {
  kind: 'room' | 'facility' | 'mark' | 'pan';
  id?: string;
  startMm: Pt;
  orig: Pt[] | Pt | { cx: number; cy: number };
  moved: boolean;
} | null;

export function mmFromEvent(svg: SVGSVGElement, view: View, e: { clientX: number; clientY: number }): Pt {
  const rect = svg.getBoundingClientRect();
  return {
    x: Math.round(view.cx + (e.clientX - rect.left - rect.width / 2) / view.zoom),
    y: Math.round(view.cy + (e.clientY - rect.top - rect.height / 2) / view.zoom),
  };
}

const RoomShape = memo(function RoomShape({
  room,
  selected,
  delta,
  onPointerDown,
}: {
  room: Room;
  selected: boolean;
  delta: Pt;
  onPointerDown: (e: RPointerEvent<SVGGElement>, room: Room) => void;
}) {
  const pts = room.polygon.map((p) => `${p.x + delta.x},${p.y + delta.y}`).join(' ');
  const cx = room.polygon.reduce((s, p) => s + p.x, 0) / room.polygon.length + delta.x;
  const cy = room.polygon.reduce((s, p) => s + p.y, 0) / room.polygon.length + delta.y;
  return (
    <g
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e, room);
      }}
      style={{ cursor: 'pointer' }}
    >
      <polygon
        points={pts}
        fill={USAGE_FILLS[room.usage]}
        stroke={selected ? '#1976d2' : '#333333'}
        strokeWidth={room.usage === 'corridor' ? 3 : 2.5}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        fontSize={400}
        fill="#333"
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {room.name}
        <tspan x={cx} dy={480} fontSize={320} fill="#888">
          {room.areaM2.toFixed(1)}㎡
        </tspan>
      </text>
    </g>
  );
});

const FacilityShape = memo(function FacilityShape({
  fac,
  selected,
  delta,
  onPointerDown,
}: {
  fac: Facility;
  selected: boolean;
  delta: Pt;
  onPointerDown: (e: RPointerEvent<SVGGElement>, fac: Facility) => void;
}) {
  const x = fac.x + delta.x;
  const y = fac.y + delta.y;
  return (
    <g
      transform={`translate(${x},${y})`}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e, fac);
      }}
      style={{ cursor: 'pointer' }}
    >
      {selected && <circle r={900} fill="none" stroke="#1976d2" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      <FacilityGlyph kind={fac.kind} s={fac.kind === 'exit' ? 700 : 550} />
      <text y={1150} textAnchor="middle" fontSize={330} fill="#555" style={{ userSelect: 'none', pointerEvents: 'none' }}>
        {fac.code}
      </text>
    </g>
  );
});

export type FloorPlanProps = {
  floor: Floor;
  view: View;
  svgRef: React.RefObject<SVGSVGElement | null>;
  underlayUrl: string | null;
  showGrid?: boolean;
  selected: Selection;
  drag: DragState;
  dragDelta: Pt;
  draftPoints: Pt[];
  draftCursor: Pt | null;
  coverageCells: Pt[] | null;
  highlight: Pt | null;
  markPt: Pt | null;
  onRoomPointerDown?: (e: RPointerEvent<SVGGElement>, room: Room) => void;
  onFacilityPointerDown?: (e: RPointerEvent<SVGGElement>, fac: Facility) => void;
  onMarkPointerDown?: (e: RPointerEvent<SVGGElement>) => void;
};

/** 图纸渲染（编辑器 / 打印共用）：毫米坐标，1 单位 = 1mm */
export function FloorPlan(props: FloorPlanProps) {
  const {
    floor, view, svgRef, underlayUrl, showGrid = true,
    selected, drag, dragDelta, draftPoints, draftCursor,
    coverageCells, highlight, markPt,
    onRoomPointerDown, onFacilityPointerDown, onMarkPointerDown,
  } = props;
  void svgRef;

  return (
    <>
      {underlayUrl && floor.underlay?.visible && (
        <image
          href={underlayUrl}
          x={floor.underlay.offsetX}
          y={floor.underlay.offsetY}
          width={floor.underlay.wPx * floor.underlay.scaleMmPerPx}
          height={floor.underlay.hPx * floor.underlay.scaleMmPerPx}
          opacity={floor.underlay.opacity}
          preserveAspectRatio="none"
        />
      )}
      {showGrid && view.zoom > 0.02 && (
        <g>
          <defs>
            <pattern id="grid1m" width={1000} height={1000} patternUnits="userSpaceOnUse">
              <path d="M 1000 0 L 0 0 0 1000" fill="none" stroke="#e4e4e4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </pattern>
            <pattern id="grid5m" width={5000} height={5000} patternUnits="userSpaceOnUse">
              <rect width={5000} height={5000} fill="url(#grid1m)" />
              <path d="M 5000 0 L 0 0 0 5000" fill="none" stroke="#cfcfcf" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            </pattern>
          </defs>
          <rect x={-500000} y={-500000} width={1000000} height={1000000} fill="url(#grid5m)" />
        </g>
      )}
      {floor.rooms.map((r) => (
        <RoomShape
          key={r.id}
          room={r}
          selected={selected?.type === 'room' && selected.id === r.id}
          delta={drag?.kind === 'room' && drag.id === r.id ? dragDelta : { x: 0, y: 0 }}
          onPointerDown={onRoomPointerDown ?? (() => {})}
        />
      ))}
      {coverageCells && (
        <g fill="#ef5350" opacity={0.45}>
          {coverageCells.map((c, i) => (
            <rect key={i} x={c.x - 250} y={c.y - 250} width={500} height={500} />
          ))}
        </g>
      )}
      {floor.facilities.map((f) => (
        <FacilityShape
          key={f.id}
          fac={f}
          selected={selected?.type === 'facility' && selected.id === f.id}
          delta={drag?.kind === 'facility' && drag.id === f.id ? dragDelta : { x: 0, y: 0 }}
          onPointerDown={onFacilityPointerDown ?? (() => {})}
        />
      ))}
      {draftPoints.length > 0 && (
        <g>
          <polygon
            points={draftPoints.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="#1976d2"
            opacity={0.15}
          />
          <polyline
            points={[...draftPoints, ...(draftCursor ? [draftCursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#1976d2"
            strokeWidth={2}
            strokeDasharray="8 6"
            vectorEffect="non-scaling-stroke"
          />
          {draftPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 350 : 200} fill="#1976d2" />
          ))}
        </g>
      )}
      {highlight && (
        <g pointerEvents="none">
          <circle cx={highlight.x} cy={highlight.y} r={1200} fill="none" stroke="#e53935" strokeWidth={3} vectorEffect="non-scaling-stroke" />
          <circle cx={highlight.x} cy={highlight.y} r={300} fill="#e53935" />
        </g>
      )}
      {markPt && (
        <g
          transform={`translate(${markPt.x + (drag?.kind === 'mark' ? dragDelta.x : 0)},${markPt.y + (drag?.kind === 'mark' ? dragDelta.y : 0)})`}
          onPointerDown={(e) => onMarkPointerDown?.(e)}
          style={{ cursor: onMarkPointerDown ? 'move' : 'default' }}
        >
          <circle r={700} fill="#e53935" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <text y={-1000} textAnchor="middle" fontSize={420} fill="#c62828" fontWeight="bold" style={{ userSelect: 'none', pointerEvents: 'none' }}>
            您在此
          </text>
        </g>
      )}
    </>
  );
}

export function wheelZoom(view: View, e: RWheelEvent, svg: SVGSVGElement): View {
  const rect = svg.getBoundingClientRect();
  const mmX = view.cx + (e.clientX - rect.left - rect.width / 2) / view.zoom;
  const mmY = view.cy + (e.clientY - rect.top - rect.height / 2) / view.zoom;
  const factor = Math.exp(-e.deltaY * 0.0012);
  const zoom = Math.min(3, Math.max(0.008, view.zoom * factor));
  return {
    zoom,
    cx: mmX - (e.clientX - rect.left - rect.width / 2) / zoom,
    cy: mmY - (e.clientY - rect.top - rect.height / 2) / zoom,
  };
}
