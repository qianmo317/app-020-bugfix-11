import { FACILITY_CODES, type Facility, type FacilityKind, type Floor } from '../model';

let seq = 0;
export function uid(): string {
  return `id_${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function floorLabel(level: number): string {
  return level >= 1 ? `${level}F` : `B${-level}`;
}

/** 设施编号：楼层-类型-序号（如 3F-EX-01），查重后取最大序号 +1 */
export function nextCode(floor: Floor, kind: FacilityKind): string {
  const prefix = `${floorLabel(floor.level)}-${FACILITY_CODES[kind]}-`;
  let max = 0;
  for (const f of floor.facilities) {
    if (f.code.startsWith(prefix)) {
      const n = parseInt(f.code.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

export function facilityBelongs(f: Facility, kind: FacilityKind): boolean {
  return f.kind === kind;
}
