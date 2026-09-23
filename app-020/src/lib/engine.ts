import type {
  Floor,
  Pt,
  Room,
  RuleSet,
  ValidationItem,
  ValidationResult,
  FacilityKind,
} from '../model';
import {
  MM_PER_M,
  gridPointsInPoly,
  pointInPoly,
  polyAreaM2,
  doorCandidates,
  bboxOf,
} from './geometry';
import { buildCorridorGraph, roomWorstPath, type DoorInput } from './graph';
import { CHECK_INTERVAL_DAYS, OCCUPANCY_DENSITY_M2_PER_PERSON } from '../rules/defaults';

const TRAVEL_STEP_MM = 250; // 走道/房间栅格 0.25m，保证与手工沿路径测量误差 < 0.5m
const ROOM_STEP_MM = 250; // 房间内部采样 0.25m
const COVERAGE_STEP_MM = 500; // 覆盖判定栅格 0.5m

export type CoverageResult = {
  uncoveredM2: number;
  totalM2: number;
  pass: boolean;
  samples: Pt[]; // 未覆盖代表点（mm），最多 50 个
  cells: Pt[]; // 全部未覆盖栅格点（用于画布高亮），仅按需计算
};

/**
 * 灭火器保护半径覆盖：0.5m 栅格采样近似面积差集。
 * 未覆盖面积 > max(2㎡, 楼层面积 5%) 判不合规。
 */
export function computeCoverage(
  rooms: Room[],
  extinguisherPts: Pt[],
  radiusM: number,
  withCells = false,
): CoverageResult {
  const cells: Pt[] = [];
  const samples: Pt[] = [];
  if (!rooms.length) {
    return { uncoveredM2: 0, totalM2: 0, pass: true, samples, cells };
  }
  const bb = bboxOf(rooms.map((r) => r.polygon));
  const step = COVERAGE_STEP_MM;
  const radius = radiusM * MM_PER_M;
  const bucket = Math.max(radius, 5000);
  const hash = new Map<string, Pt[]>();
  for (const p of extinguisherPts) {
    const key = `${Math.floor(p.x / bucket)},${Math.floor(p.y / bucket)}`;
    const list = hash.get(key);
    if (list) list.push(p);
    else hash.set(key, [p]);
  }
  const coveredAt = (x: number, y: number): boolean => {
    const bi = Math.floor(x / bucket);
    const bj = Math.floor(y / bucket);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const list = hash.get(`${bi + di},${bj + dj}`);
        if (!list) continue;
        for (const p of list) {
          if (Math.hypot(p.x - x, p.y - y) <= radius) return true;
        }
      }
    }
    return false;
  };

  // 格心采样：每个 0.5m 格子用其中心点判定，格心必在多边形内部（射线法排除边界点的问题
  // 不会出现），总面积 = 格数 × 0.25㎡ 与手工核算一致，未覆盖面积误差 ≤ 每格半格 ≈ 10% 内
  const x0 = Math.floor(bb.minX / step) * step + step / 2;
  const y0 = Math.floor(bb.minY / step) * step + step / 2;
  const nx = Math.max(1, Math.ceil((bb.maxX - bb.minX) / step));
  const ny = Math.max(1, Math.ceil((bb.maxY - bb.minY) / step));
  // inside 标记：逐房间按 bbox 预filter 标记，避免每点遍历全部多边形（200 房间时的性能关键）
  const inside = new Uint8Array(nx * ny);
  for (const r of rooms) {
    const pbb = bboxOf([r.polygon]);
    const i0 = Math.max(0, Math.floor((pbb.minX - x0) / step));
    const i1 = Math.min(nx - 1, Math.ceil((pbb.maxX - x0) / step));
    const j0 = Math.max(0, Math.floor((pbb.minY - y0) / step));
    const j1 = Math.min(ny - 1, Math.ceil((pbb.maxY - y0) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!inside[j * nx + i] && pointInPoly({ x: x0 + i * step, y: y0 + j * step }, r.polygon)) {
          inside[j * nx + i] = 1;
        }
      }
    }
  }
  let uncovered = 0;
  let total = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!inside[j * nx + i]) continue;
      total++;
      const x = x0 + i * step;
      const y = y0 + j * step;
      if (!coveredAt(x, y)) {
        uncovered++;
        const p = { x, y };
        cells.push(p);
        if (samples.length < 50) samples.push(p);
      }
    }
  }
  const cellAreaM2 = (step / MM_PER_M) ** 2;
  const uncoveredM2 = uncovered * cellAreaM2;
  const totalM2 = total * cellAreaM2;
  const threshold = Math.max(2, totalM2 * 0.05);
  return { uncoveredM2, totalM2, pass: uncoveredM2 <= threshold, samples, cells: withCells ? cells : [] };
}

function estimateOccupants(room: Room): number {
  if (room.occupants != null && room.occupants >= 0) return room.occupants;
  const density = OCCUPANCY_DENSITY_M2_PER_PERSON[room.usage] ?? 20;
  if (density <= 0) return 0;
  return Math.round(room.areaM2 / density);
}

const days = (n: number) => n * 24 * 3600 * 1000;

/** 设施检查记录是否过期（无记录 / 最近一次检查超过周期 / 状态为损坏或缺失） */
export function checkDueInfo(facility: { kind: FacilityKind; checks: { date: string; status: string }[] }, now: number): { overdue: boolean; defect: boolean; missing: boolean; dueDate: string | null } {
  const interval = CHECK_INTERVAL_DAYS[facility.kind] ?? 90;
  const sorted = [...facility.checks].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) return { overdue: false, defect: false, missing: true, dueDate: null };
  const last = sorted[0];
  const dueTs = new Date(`${last.date}T00:00:00`).getTime() + days(interval);
  const d = new Date(dueTs);
  const p2 = (v: number) => String(v).padStart(2, '0');
  const defect = last.status === 'damaged' || last.status === 'missing';
  return {
    overdue: now > dueTs,
    defect,
    missing: false,
    // 按本地时区取日期（toISOString 会因 UTC 偏移提前一天切日）
    dueDate: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
  };
}

/**
 * 楼层合规校验（核心）：
 * 1) 疏散距离全程沿真实可行走路径计算：走道栅格图（边界包含式栅格化，无膨胀）+
 *    多源 Dijkstra；出口/门先投影到掩码内可行走落点（连接段不得穿墙）；
 *    房间内同样沿栅格路径（含多边形顶点）走到门/房内出口，再接走道段；
 * 2) 灭火器保护半径栅格采样覆盖判定；
 * 3) 安全出口数量 vs 面积/人数、出口与走道连通性；
 * 4) 袋形走道（死端）长度；
 * 5) 走道断裂组分 / 房间不可达、检查记录过期/缺失。
 * 结果中记录当时使用的规则版本与依据文号（打印报告可见）。
 */
export function validateFloor(floor: Floor, rules: RuleSet, now: number = Date.now()): ValidationResult {
  const items: ValidationItem[] = [];
  const corridorRooms = floor.rooms.filter((r) => r.usage === 'corridor');
  const openPlan = corridorRooms.length === 0;
  const walkPolys = openPlan ? floor.rooms.map((r) => r.polygon) : corridorRooms.map((r) => r.polygon);
  const nonWalkRooms = openPlan ? [] : floor.rooms.filter((r) => r.usage !== 'corridor');
  const exits = floor.facilities.filter((f) => f.kind === 'exit');
  const exitPts = exits.map((f) => ({ x: f.x, y: f.y }));

  let travelWorstM: number | null = null;
  let worstPoint: Pt | null = null;
  let deadEndM: number | null = null;

  if (walkPolys.length && exitPts.length) {
    // 房间门推断（记录每个门在 doorInputs 中的序号，供逐门取走道段距离）
    const doorPtsByRoom = new Map<string, { pt: Pt; inputIdx: number }[]>();
    const doorInputs: DoorInput[] = [];
    for (const r of nonWalkRooms) {
      const ds = doorCandidates(r.polygon, walkPolys);
      if (ds.length) {
        const list = ds.map((pt) => {
          const inputIdx = doorInputs.length;
          doorInputs.push({ roomId: r.id, pt });
          return { pt, inputIdx };
        });
        doorPtsByRoom.set(r.id, list);
      }
    }
    const g = buildCorridorGraph(walkPolys, exitPts, doorInputs, TRAVEL_STEP_MM);

    exits.forEach((f, i) => {
      if (!g.exitConnected[i]) {
        items.push({
          severity: 'error',
          type: 'EXIT_NOT_CONNECTED',
          facilityId: f.id,
          point: { x: f.x, y: f.y },
          message: `安全出口 ${f.code} 未连接到${openPlan ? '房间区域' : '走道'}（出口 2.5m 内没有全程可行走的落点，可能落在墙外或隔着房间）`,
        });
      }
    });

    // 走道网络整体最差点
    let maxD = -1;
    let maxIdx = -1;
    for (let u = 0; u < g.nLattice; u++) {
      if (g.dist[u] !== Infinity && g.dist[u] > maxD) {
        maxD = g.dist[u];
        maxIdx = u;
      }
    }
    if (maxIdx >= 0) {
      travelWorstM = maxD / MM_PER_M;
      worstPoint = { x: g.pts[maxIdx * 2], y: g.pts[maxIdx * 2 + 1] };
    }
    if (!openPlan) {
      deadEndM = g.deadEndMax / MM_PER_M;
      if (deadEndM > rules.deadEndDistanceM + 0.001) {
        items.push({
          severity: 'error',
          type: 'DEADEND_EXCEED',
          value: deadEndM,
          limit: rules.deadEndDistanceM,
          message: `袋形走道（死端）最大长度 ${deadEndM.toFixed(1)}m 超过限值 ${rules.deadEndDistanceM}m`,
        });
      }
      // 存在与全部出口都不通的走道组分（两段走道看着相接、实际留缝/只斜角相碰）：
      // 不能静默当作合格，按不可达报 error
      if (g.hasUnreachable) {
        items.push({
          severity: 'error',
          type: 'WALK_NOT_CONNECTED',
          message: `部分走道区域无法到达任何安全出口（两段走道未真正共边连通，请检查走道端头是否留缝或仅在角点相碰）`,
        });
      }
    }

    // 各房间疏散距离
    for (const r of floor.rooms) {
      if (r.usage === 'corridor') continue;
      const exitsInRoom = exitPts.filter((p) => pointInPoly(p, r.polygon));
      const doors = doorPtsByRoom.get(r.id) ?? [];
      if (!exitsInRoom.length && !doors.length) {
        items.push({
          severity: 'warning',
          type: 'NO_DOOR',
          roomId: r.id,
          message: `房间「${r.name}」未找到通向${openPlan ? '其他区域' : '走道'}的门（房间需与走道共边）`,
        });
        continue;
      }
      // 房内同样沿可行走路径计算：房内栅格∪多边形顶点 → 门/房内出口，
      // 门源带上「门 → 最近出口」的走道段距离
      const sources = [
        ...doors.map((d) => ({ pt: d.pt, d0: g.doorDist[d.inputIdx] })),
        ...exitsInRoom.map((p) => ({ pt: p, d0: 0 })),
      ];
      const res = roomWorstPath(r.polygon, sources, ROOM_STEP_MM);
      if (!res) continue;
      if (!res.connected) {
        items.push({
          severity: 'error',
          type: 'ROOM_UNREACHABLE',
          roomId: r.id,
          point: res.point,
          message: `房间「${r.name}」内区域无法经任何门或房内出口到达走道（门可能未真正接到可行走区域），疏散距离不可达`,
        });
        continue;
      }
      const worstM = res.worstMm / MM_PER_M;
      if (worstM > rules.maxTravelDistanceM + 0.001) {
        items.push({
          severity: 'error',
          type: 'TRAVEL_EXCEED',
          roomId: r.id,
          point: res.point,
          value: worstM,
          limit: rules.maxTravelDistanceM,
          message: `房间「${r.name}」疏散距离 ${worstM.toFixed(1)}m 超过限值 ${rules.maxTravelDistanceM}m（沿路径计算）`,
        });
      }
    }

    // 走道房间各自的最差点（用于定位提示）
    if (!openPlan) {
      for (const r of corridorRooms) {
        const pts = gridPointsInPoly(r.polygon, TRAVEL_STEP_MM);
        let worst = -1;
        let wp: Pt | null = null;
        for (const p of pts) {
          const u = g.nodeAtLattice(p.x, p.y);
          if (u >= 0 && g.dist[u] !== Infinity && g.dist[u] > worst) {
            worst = g.dist[u];
            wp = p;
          }
        }
        if (wp && worst / MM_PER_M > rules.maxTravelDistanceM + 0.001) {
          items.push({
            severity: 'error',
            type: 'TRAVEL_EXCEED',
            roomId: r.id,
            point: wp,
            value: worst / MM_PER_M,
            limit: rules.maxTravelDistanceM,
            message: `走道「${r.name}」最远点疏散距离 ${(worst / MM_PER_M).toFixed(1)}m 超过限值 ${rules.maxTravelDistanceM}m`,
          });
        }
      }
    }
  } else if (walkPolys.length && !exitPts.length) {
    items.push({ severity: 'error', type: 'EXIT_COUNT', message: '未布置任何安全出口' });
  }

  // 灭火器覆盖
  const extPts = floor.facilities.filter((f) => f.kind === 'extinguisher').map((f) => ({ x: f.x, y: f.y }));
  const coverage = floor.rooms.length
    ? computeCoverage(floor.rooms, extPts, rules.extinguisherRadiusM)
    : null;
  if (coverage && !coverage.pass) {
    items.push({
      severity: 'warning',
      type: 'COVERAGE_UNCOVERED',
      value: coverage.uncoveredM2,
      point: coverage.samples[0],
      message: `灭火器保护半径（${rules.extinguisherRadiusM}m）未覆盖面积 ${coverage.uncoveredM2.toFixed(1)}㎡，超过阈值 max(2㎡, 5%)`,
    });
  }

  // 安全出口数量 vs 面积/人数
  const areaM2 = floor.rooms.reduce((s, r) => s + polyAreaM2(r.polygon), 0);
  const occupants = floor.rooms.reduce((s, r) => s + estimateOccupants(r), 0);
  const required = areaM2 > rules.exitMinAreaM2 || occupants > rules.exitMaxOccupants ? 2 : 1;
  if (exitPts.length && exits.length < required) {
    items.push({
      severity: 'error',
      type: 'EXIT_COUNT',
      value: exits.length,
      limit: required,
      message: `安全出口 ${exits.length} 个，少于要求数量（面积 ${areaM2.toFixed(0)}㎡ / 人数约 ${occupants} → 需 ≥ ${required} 个）`,
    });
  }

  // 检查记录
  for (const f of floor.facilities) {
    const info = checkDueInfo(f, now);
    if (info.defect) {
      items.push({
        severity: 'error',
        type: 'FACILITY_DEFECT',
        facilityId: f.id,
        point: { x: f.x, y: f.y },
        message: `${f.code} 最近检查状态为「${f.checks.find((c) => c.date === [...f.checks].sort((a, b) => b.date.localeCompare(a.date))[0].date)?.status ?? 'missing'}」，需整改`,
      });
    } else if (info.missing) {
      items.push({
        severity: 'warning',
        type: 'CHECK_MISSING',
        facilityId: f.id,
        point: { x: f.x, y: f.y },
        message: `${f.code} 未登记任何检查记录`,
      });
    } else if (info.overdue) {
      items.push({
        severity: 'warning',
        type: 'CHECK_OVERDUE',
        facilityId: f.id,
        point: { x: f.x, y: f.y },
        message: `${f.code} 检查已过期（应检日期 ${info.dueDate}）`,
      });
    }
  }

  // 排序：error 在前，同类按实测/限值比降序
  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    const ra = a.value != null && a.limit ? a.value / a.limit : 0;
    const rb = b.value != null && b.limit ? b.value / b.limit : 0;
    return rb - ra;
  });

  const pass =
    !items.some((i) => i.severity === 'error') && (coverage ? coverage.pass : true);

  return {
    checkedAt: new Date(now).toISOString(),
    pass,
    items,
    travelWorstM,
    travelWorstPoint: worstPoint,
    deadEndM,
    coverage: coverage
      ? { uncoveredM2: coverage.uncoveredM2, totalM2: coverage.totalM2, pass: coverage.pass, samples: coverage.samples }
      : null,
    exits: { present: exits.length, required },
    rulesSnapshot: {
      buildingKind: rules.buildingKind,
      version: rules.version,
      source: rules.source,
      maxTravelDistanceM: rules.maxTravelDistanceM,
      deadEndDistanceM: rules.deadEndDistanceM,
      extinguisherRadiusM: rules.extinguisherRadiusM,
    },
  };
}
