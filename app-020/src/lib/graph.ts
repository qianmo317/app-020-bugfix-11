import type { Pt } from '../model';
import { bboxOf, pointInPoly } from './geometry';

/**
 * 走道栅格图：把可行走区域多边形栅格化（默认 0.25m），
 * 安全出口/房间门作为附加节点连接到最近栅格点，多源 Dijkstra 求任意点到最近出口的路径距离。
 *
 * 疏散距离必须沿路径算，不是直线距离——L 形走道中直线距离会系统性低估，属于原则性错误。
 */
export type DoorInput = { roomId: string; pt: Pt };

export type CorridorGraph = {
  step: number; // mm
  nLattice: number;
  nTotal: number;
  pts: Float64Array; // [x0,y0,x1,y1,...]
  dist: Float64Array; // 到最近出口的路径距离 mm（Infinity=不可达）
  doorDist: number[]; // 每个输入 door 的路径距离 mm（Infinity=未连接）
  exitConnected: boolean[];
  deadEndMax: number; // mm，袋形走道（死端）最大长度
  nodeAtLattice: (x: number, y: number) => number; // 栅格点 → 节点序号（-1 不存在）
};

const SQRT2 = Math.SQRT2;

export function buildCorridorGraph(
  walkPolys: Pt[][],
  exitPts: Pt[],
  doors: DoorInput[],
  step: number,
): CorridorGraph {
  const bb = bboxOf(walkPolys);
  const ox = Math.floor(bb.minX / step) * step;
  const oy = Math.floor(bb.minY / step) * step;
  const nx = Math.ceil((bb.maxX - ox) / step) + 1;
  const ny = Math.ceil((bb.maxY - oy) / step) + 1;
  const cellCount = nx * ny;
  if (cellCount > 8_000_000) throw new Error('floor too large for grid');

  // 栅格可行性掩码与节点编号。
  // 掩码按「多边形 bbox 预filter + 逐点射线法」生成，再做 1 格膨胀（4 邻）：
  // 射线法会排除多边形边界点，两个共边多边形（房间与走道）会在边界处留下断缝，
  // 膨胀 1 格把边界行补上，同时不引入对角接触的误连通。
  const inside = new Uint8Array(cellCount);
  const nodeIdx = new Int32Array(cellCount).fill(-1);
  const latticePts: number[] = [];
  let nLattice = 0;
  for (const poly of walkPolys) {
    const pbb = bboxOf([poly]);
    const i0 = Math.max(0, Math.floor((pbb.minX - ox) / step));
    const i1 = Math.min(nx - 1, Math.ceil((pbb.maxX - ox) / step));
    const j0 = Math.max(0, Math.floor((pbb.minY - oy) / step));
    const j1 = Math.min(ny - 1, Math.ceil((pbb.maxY - oy) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (pointInPoly({ x: ox + i * step, y: oy + j * step }, poly)) inside[j * nx + i] = 1;
      }
    }
  }
  const mask = new Uint8Array(cellCount);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (inside[j * nx + i]) {
        mask[j * nx + i] = 1;
        continue;
      }
      if (
        (i > 0 && inside[j * nx + i - 1]) ||
        (i < nx - 1 && inside[j * nx + i + 1]) ||
        (j > 0 && inside[(j - 1) * nx + i]) ||
        (j < ny - 1 && inside[(j + 1) * nx + i])
      ) {
        mask[j * nx + i] = 1;
      }
    }
  }
  for (let c = 0; c < cellCount; c++) {
    if (mask[c]) {
      nodeIdx[c] = nLattice++;
      latticePts.push(ox + (c % nx) * step, oy + Math.floor(c / nx) * step);
    }
  }
  const cell = (i: number, j: number) => j * nx + i;
  const walkAt = (i: number, j: number) =>
    i >= 0 && i < nx && j >= 0 && j < ny && mask[cell(i, j)] === 1;

  const nExits = exitPts.length;
  const nDoors = doors.length;
  const nTotal = nLattice + nExits + nDoors;

  const pts = new Float64Array(nTotal * 2);
  for (let u = 0; u < nLattice; u++) {
    pts[u * 2] = latticePts[u * 2];
    pts[u * 2 + 1] = latticePts[u * 2 + 1];
  }

  // 附加节点（出口/门）→ 最近栅格点
  const EXIT_SNAP = 2500; // 2.5m
  const DOOR_SNAP = 1500; // 1.5m
  const attached = new Map<number, { extra: number; d: number }[]>(); // 栅格点 → 挂上的附加节点
  const attach = (p: Pt, snap: number): { node: number; d: number } | null => {
    // 在出口/门附近的栅格环内找最近点（比全量扫描快）
    const ci = Math.round((p.x - ox) / step);
    const cj = Math.round((p.y - oy) / step);
    const r = Math.ceil(snap / step);
    let best = -1;
    let bestD = Infinity;
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (!walkAt(i, j)) continue;
        const u = nodeIdx[cell(i, j)];
        const d = Math.hypot(pts[u * 2] - p.x, pts[u * 2 + 1] - p.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
    }
    if (best < 0 || bestD > snap) return null;
    return { node: best, d: bestD };
  };

  const exitConnected: boolean[] = [];
  for (let e = 0; e < nExits; e++) {
    const u = nLattice + e;
    pts[u * 2] = exitPts[e].x;
    pts[u * 2 + 1] = exitPts[e].y;
    const a = attach(exitPts[e], EXIT_SNAP);
    exitConnected.push(!!a);
    if (a) {
      const list = attached.get(a.node) ?? [];
      list.push({ extra: u, d: a.d });
      attached.set(a.node, list);
    }
  }
  const doorDist: number[] = [];
  for (let k = 0; k < nDoors; k++) {
    const u = nLattice + nExits + k;
    pts[u * 2] = doors[k].pt.x;
    pts[u * 2 + 1] = doors[k].pt.y;
    const a = attach(doors[k].pt, DOOR_SNAP);
    if (a) {
      const list = attached.get(a.node) ?? [];
      list.push({ extra: u, d: a.d });
      attached.set(a.node, list);
      doorDist.push(0); // 占位，Dijkstra 后回填
    } else {
      doorDist.push(Infinity);
    }
  }

  // 邻居枚举：栅格点 → 8 邻 + 挂载附加节点；附加节点 → 其挂载栅格点
  const relax = (u: number, fn: (v: number, w: number) => void) => {
    if (u < nLattice) {
      const x = pts[u * 2];
      const y = pts[u * 2 + 1];
      const i = Math.round((x - ox) / step);
      const j = Math.round((y - oy) / step);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          if (!walkAt(i + di, j + dj)) continue;
          // 对角：两个正交邻居都可行才连，防止切角穿墙
          if (di !== 0 && dj !== 0 && !(walkAt(i + di, j) && walkAt(i, j + dj))) continue;
          fn(nodeIdx[cell(i + di, j + dj)], (di !== 0 && dj !== 0 ? SQRT2 : 1) * step);
        }
      }
      const list = attached.get(u);
      if (list) for (const a of list) fn(a.extra, a.d);
    } else {
      // 附加节点：只连其挂载的栅格点
      const x = pts[u * 2];
      const y = pts[u * 2 + 1];
      const ci = Math.round((x - ox) / step);
      const cj = Math.round((y - oy) / step);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!walkAt(ci + di, cj + dj)) continue;
          const v = nodeIdx[cell(ci + di, cj + dj)];
          const d = Math.hypot(pts[v * 2] - x, pts[v * 2 + 1] - y);
          if (d <= DOOR_SNAP) fn(v, d);
        }
      }
    }
  };

  // Dijkstra（二叉堆）。供多源（全部已连接出口）与单源（逐出口，供死端计算）复用。
  const runDijkstra = (sources: { u: number; d: number }[]): Float64Array => {
    const dd = new Float64Array(nTotal).fill(Infinity);
    const heapU: number[] = [];
    const heapD: number[] = [];
    const push = (u: number, d: number) => {
      heapU.push(u);
      heapD.push(d);
      let i = heapU.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapD[p] <= heapD[i]) break;
        [heapU[p], heapU[i]] = [heapU[i], heapU[p]];
        [heapD[p], heapD[i]] = [heapD[i], heapD[p]];
        i = p;
      }
    };
    const pop = (): { u: number; d: number } | null => {
      if (!heapU.length) return null;
      const u = heapU[0];
      const d = heapD[0];
      const lu = heapU.pop()!;
      const ld = heapD.pop()!;
      if (heapU.length) {
        heapU[0] = lu;
        heapD[0] = ld;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heapU.length && heapD[l] < heapD[m]) m = l;
          if (r < heapU.length && heapD[r] < heapD[m]) m = r;
          if (m === i) break;
          [heapU[m], heapU[i]] = [heapU[i], heapU[m]];
          [heapD[m], heapD[i]] = [heapD[i], heapD[m]];
          i = m;
        }
      }
      return { u, d };
    };
    for (const s of sources) {
      if (s.d < dd[s.u]) {
        dd[s.u] = s.d;
        push(s.u, s.d);
      }
    }
    while (heapU.length) {
      const top = pop()!;
      if (top.d > dd[top.u]) continue;
      relax(top.u, (v, w) => {
        const nd = top.d + w;
        if (nd < dd[v]) {
          dd[v] = nd;
          push(v, nd);
        }
      });
    }
    return dd;
  };

  // 主结果：任意点到最近出口的路径距离
  const exitSources: { u: number; d: number }[] = [];
  for (let e = 0; e < nExits; e++) {
    if (exitConnected[e]) exitSources.push({ u: nLattice + e, d: 0 });
  }
  const dist = runDijkstra(exitSources);

  // 回填门节点距离
  for (let k = 0; k < nDoors; k++) {
    if (doorDist[k] !== Infinity) doorDist[k] = dist[nLattice + nExits + k];
  }

  // 死端（袋形走道）：对每个已连接出口各跑一次单源 Dijkstra（出口通常 ≤ 6 个，
  // 上限取 12，更多时忽略多余出口——出口数量本身受 EXIT_COUNT 规则约束）。
  const deadEndExitIdx: number[] = [];
  for (let e = 0; e < nExits && deadEndExitIdx.length < 12; e++) {
    if (exitConnected[e]) deadEndExitIdx.push(e);
  }
  const perExit = deadEndExitIdx.map((e) => runDijkstra([{ u: nLattice + e, d: 0 }]));
  const deadEndMax = computeDeadEnd(
    perExit,
    deadEndExitIdx.map((e) => nLattice + e),
    nLattice,
  );

  return {
    step,
    nLattice,
    nTotal,
    pts,
    dist,
    doorDist,
    exitConnected,
    deadEndMax,
    nodeAtLattice: (x: number, y: number) => {
      const i = Math.round((x - ox) / step);
      const j = Math.round((y - oy) / step);
      if (!walkAt(i, j)) return -1;
      return nodeIdx[cell(i, j)];
    },
  };
}

/**
 * 死端（袋形走道）最大长度：
 * - 多出口：对每个栅格点 n，depth(n) = min over 出口对 (i,j) of (d(n,i) + d(n,j) − D(i,j)) / 2，
 *   其中 d(n,e) 为 n 到出口 e 的路径距离（perExit），D(i,j) 为出口 i→j 的路径距离。
 *   推导：n 在袋形走道内时任何逃生路线都要先走到「袋口」（路径分叉点），
 *   d(n,i) + d(n,j) − D(i,j) = 2 ×（n 到两出口最短路径的强制重合段）= 2 × n 到袋口深度；
 *   对所有出口对取最小值，剔除「最近两出口在同侧」造成的过高估计。
 *   直线走道两端都有出口时中点即袋口，深度 ≈ 0；仅一端有出口时深度 ≈ 走道全长。
 * - 单出口：整个区域只有一条逃生方向，整条走道视为袋形，depth(n) = d(n, 唯一出口)，取最远点。
 */
function computeDeadEnd(perExit: Float64Array[], exitNodes: number[], nLattice: number): number {
  const E = exitNodes.length;
  if (E === 0) return 0;
  if (E === 1) {
    const d = perExit[0];
    let max = 0;
    for (let u = 0; u < nLattice; u++) {
      const v = d[u];
      if (v !== Infinity && v > max) max = v;
    }
    return max;
  }
  // 出口间路径距离 D[i][j] = perExit[i][出口 j 的附加节点]
  const D = new Float64Array(E * E);
  for (let i = 0; i < E; i++) {
    for (let j = 0; j < E; j++) D[i * E + j] = perExit[i][exitNodes[j]];
  }
  let max = 0;
  for (let u = 0; u < nLattice; u++) {
    let best = Infinity; // 该点由出口对算出的最小袋深
    let single = Infinity; // 仅可达一个出口时退化为该距离
    let finiteCnt = 0;
    for (let i = 0; i < E; i++) {
      const di = perExit[i][u];
      if (di === Infinity) continue;
      finiteCnt++;
      single = di;
      for (let j = i + 1; j < E; j++) {
        const dj = perExit[j][u];
        if (dj === Infinity) continue;
        const dij = D[i * E + j];
        if (dij === Infinity) continue;
        const depth = Math.max(0, (di + dj - dij) / 2);
        if (depth < best) best = depth;
      }
    }
    const depth = best !== Infinity ? best : finiteCnt === 1 ? single : 0;
    if (depth > max) max = depth;
  }
  return max;
}
