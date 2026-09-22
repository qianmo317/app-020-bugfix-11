import type { BuildingKind, Facility, Floor, Pt, Room, RoomUsage, RuleSet } from '../src/model';
import { DEFAULT_RULES } from '../src/rules/defaults';
import { validateFloor } from '../src/lib/engine';
import { nextCode } from '../src/store/id';

export const M = 1000;
/** 以米为单位的矩形（顺时针）→ 毫米多边形 */
export function rect(x: number, y: number, w: number, h: number): Pt[] {
  return [
    { x: x * M, y: y * M },
    { x: (x + w) * M, y: y * M },
    { x: (x + w) * M, y: (y + h) * M },
    { x: x * M, y: (y + h) * M },
  ];
}

let seq = 0;
export function mkRoom(name: string, usage: RoomUsage, polygon: Pt[], occupants?: number): Room {
  return { id: `room${seq++}`, polygon, name, usage, areaM2: areaOf(polygon), occupants };
}

function areaOf(poly: Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(s / 2) / 1e6;
}

export type FacSpec = {
  kind: Facility['kind'];
  x: number; // m
  y: number; // m
  checks?: Facility['checks'];
};

export function mkFloor(rooms: Room[], facs: FacSpec[], kind: BuildingKind = 'office'): { floor: Floor; rules: RuleSet } {
  const facilities: Facility[] = facs.map((f, i) => ({
    id: `fac${seq++}`,
    kind: f.kind,
    x: f.x * M,
    y: f.y * M,
    code: `${f.kind}-${i}`,
    checks: f.checks ?? [],
  }));
  const floor: Floor = {
    id: 'floor1',
    buildingId: 'b1',
    level: 1,
    scaleMmPerUnit: 1,
    rooms,
    facilities,
    exits: facilities.filter((f) => f.kind === 'exit').map((f) => f.id),
    version: 0,
  };
  return { floor, rules: { ...DEFAULT_RULES[kind] } };
}

export function ruleWith(base: RuleSet, patch: Partial<RuleSet>): RuleSet {
  return { ...base, ...patch };
}

export { validateFloor, nextCode, DEFAULT_RULES };
