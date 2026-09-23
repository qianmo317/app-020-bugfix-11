import type { Pt } from '../model';

export const MM_PER_M = 1000;

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

export function bboxOf(polys: Pt[][]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** 射线法：点是否在多边形内（边界归属不保证，栅格采样场景可接受） */
export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInAnyPoly(p: Pt, polys: Pt[][]): boolean {
  for (const poly of polys) if (pointInPoly(p, poly)) return true;
  return false;
}

export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return s / 2;
}

export function polyAreaMm2(poly: Pt[]): number {
  return Math.abs(signedArea(poly));
}

export function polyAreaM2(poly: Pt[]): number {
  return polyAreaMm2(poly) / 1e6;
}

/** 对齐绝对栅格的多边形内部采样点（含顶点由调用方另行追加） */
export function gridPointsInPoly(poly: Pt[], step: number): Pt[] {
  const bb = bboxOf([poly]);
  const pts: Pt[] = [];
  const x0 = Math.ceil(bb.minX / step) * step;
  const y0 = Math.ceil(bb.minY / step) * step;
  for (let y = y0; y <= bb.maxY; y += step) {
    for (let x = x0; x <= bb.maxX; x += step) {
      const p = { x, y };
      if (pointInPoly(p, poly)) pts.push(p);
    }
  }
  return pts;
}

/**
 * 推断房间门：沿房间边界找与走道相邻的连续段（两侧探针任一侧命中走道即可），
 * 取长度 ≥0.4m 的连续段中点作为门位置。房间与走道共享边即可，无需显式画门。
 */
export function doorCandidates(room: Pt[], corridors: Pt[][], probeMm = 80, sampleMm = 100): Pt[] {
  const doors: Pt[] = [];
  for (let i = 0, j = room.length - 1; i < room.length; j = i++) {
    const a = room[j], b = room[i];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1) continue;
    const n = Math.max(2, Math.ceil(len / sampleMm));
    let runStart: Pt | null = null;
    let prev = false;
    const closeRun = (end: Pt) => {
      if (!runStart) return;
      const runLen = dist(runStart, end);
      if (runLen >= 400) {
        doors.push({ x: (runStart.x + end.x) / 2, y: (runStart.y + end.y) / 2 });
      }
      runStart = null;
    };
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = { x: a.x + ex * t, y: a.y + ey * t };
      const q1 = { x: p.x + (ey / len) * probeMm, y: p.y - (ex / len) * probeMm };
      const q2 = { x: p.x - (ey / len) * probeMm, y: p.y + (ex / len) * probeMm };
      let hit = false;
      for (const c of corridors) {
        if (pointInPoly(q1, c) || pointInPoly(q2, c)) {
          hit = true;
          break;
        }
      }
      if (hit && !prev) runStart = p;
      if (!hit && prev) closeRun(p);
      prev = hit;
    }
    if (prev) closeRun(b);
  }
  return doors;
}

/** 多边形并集栅格掩码：包含多边形内部点与恰落在边界上的点。
 *
 * 关键点：不能做栅格膨胀。膨胀会把两多边形之间的真缝（两堵平行墙、留缝的走道端头）
 * 也桥接成连通，制造穿墙捷径、系统性偏小疏散距离。
 * 边界点通过「沿每条边以 1/4 步长细采样 → 标记取整格」补入：共边多边形在共享边处
 * 天然连通；斜边上每个对齐栅格的边点都会被某个采样点覆盖。只补边本身经过的格子，
 * 绝不外扩邻格——0.25m 步长下最多残留 <0.25m 的表示误差，真缝（≥0.5m）一律不连通。
 */
export type WalkMask = {
  step: number;
  ox: number;
  oy: number;
  nx: number;
  ny: number;
  mask: Uint8Array;
};

export function rasterizePolys(polys: Pt[][], step: number): WalkMask | null {
  if (!polys.length) return null;
  const bb = bboxOf(polys);
  if (!Number.isFinite(bb.minX)) return null;
  const ox = Math.floor(bb.minX / step) * step;
  const oy = Math.floor(bb.minY / step) * step;
  const nx = Math.ceil((bb.maxX - ox) / step) + 1;
  const ny = Math.ceil((bb.maxY - oy) / step) + 1;
  if (nx * ny > 8_000_000) throw new Error('floor too large for grid');
  const mask = new Uint8Array(nx * ny);
  const markCell = (i: number, j: number) => {
    if (i >= 0 && i < nx && j >= 0 && j < ny) mask[j * nx + i] = 1;
  };
  for (const poly of polys) {
    const pbb = bboxOf([poly]);
    const i0 = Math.max(0, Math.floor((pbb.minX - ox) / step));
    const i1 = Math.min(nx - 1, Math.ceil((pbb.maxX - ox) / step));
    const j0 = Math.max(0, Math.floor((pbb.minY - oy) / step));
    const j1 = Math.min(ny - 1, Math.ceil((pbb.maxY - oy) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (pointInPoly({ x: ox + i * step, y: oy + j * step }, poly)) mask[j * nx + i] = 1;
      }
    }
    // 边界补点：射线法会排除边界行/列，沿边细采样把边界栅格点加回来。
    // 只标记采样点取整后的那一格：细步长保证对齐边的每一格都会落到；
    // 斜边上离格心略远的边点由相邻采样点覆盖，绝不额外补记邻格——
    // 补记邻格会把两多边形之间的真缝（平行墙、留缝的走道端头）桥成连通。
    const SUB = 0.25; // 每步长内 4 个采样点，步长方向分量必 < 1 格，无遗漏
    for (let e = 0; e < poly.length; e++) {
      const a = poly[e], b = poly[(e + 1) % poly.length];
      const elen = dist(a, b);
      const n = Math.max(1, Math.ceil(elen / (step * SUB)));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        const ci = Math.round((px - ox) / step);
        const cj = Math.round((py - oy) / step);
        markCell(ci, cj);
      }
    }
  }
  return { step, ox, oy, nx, ny, mask };
}

/** 连接段是否全程落在可行走区域内（防止出口/门穿墙挂到墙后栅格）。
 * 起点（如墙外出口点）允许在区域外，从靠近落点一侧开始采样。 */
export function segmentClear(a: Pt, b: Pt, mask: WalkMask): boolean {
  const { step, ox, oy, nx, ny, mask: m } = mask;
  const len = dist(a, b);
  const n = Math.max(1, Math.min(60, Math.ceil(len / (step / 2))));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const i = Math.round((px - ox) / step);
    const j = Math.round((py - oy) / step);
    if (i < 0 || i >= nx || j < 0 || j >= ny || m[j * nx + i] !== 1) return false;
  }
  return true;
}

/** 按比例尺取一个「好看」的比例尺长度（米） */
export function niceScaleBarM(maxM: number): number {
  const candidates = [1, 2, 5, 10, 20, 50, 100];
  for (const c of candidates) if (c <= maxM) return c;
  return 100;
}
