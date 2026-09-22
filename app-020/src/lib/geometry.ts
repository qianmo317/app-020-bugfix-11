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

/** 按比例尺取一个「好看」的比例尺长度（米） */
export function niceScaleBarM(maxM: number): number {
  const candidates = [1, 2, 5, 10, 20, 50, 100];
  for (const c of candidates) if (c <= maxM) return c;
  return 100;
}
