import type { Pt } from '../model';
import { rasterizePolys, segmentClear, type WalkMask } from './geometry';

/**
 * 走道栅格图：把可行走区域多边形栅格化（默认 0.25m，边界包含式补点、不做膨胀），
 * 安全出口/房间门投影到掩码内最近的可行走栅格点（落点必须在可行走区域内、连接段不穿墙），
 * 多源 Dijkstra 求任意点到最近出口的路径距离。
 *
 * 疏散距离必须沿路径算，不是直线距离——L 形走道中直线距离会系统性低估，属于原则性错误。
 */
export type DoorInput = { roomId: string; pt: Pt };

export type CorridorGraph = {
  step: number; // mm
  nLattice: number;
  pts: Float64Array; // [x0,y0,x1,y1,...]
  dist: Float64Array; // 到最近出口的路径距离 mm（Infinity=不可达）
  doorDist: number[]; // 每个输入 door 的路径距离 mm（Infinity=未连接）
  exitConnected: boolean[];
  deadEndMax: number; // mm，袋形走道（死端）最大长度
  hasUnreachable: boolean; // 存在不与任何出口连通的可行走组分
  nodeAtLattice: (x: number, y: number) => number; // 栅格点 → 节点序号（-1 不存在）
};

const SQRT2 = Math.SQRT2;
const EXIT_SNAP_IN_ROOM = 2500; // 房内出口吸附半径 2.5m

/** 栅格掩码上的多源 Dijkstra（二叉堆）。dist 按 cell 线性索引，非掩码点为 Infinity。
 * 8 邻连通，对角要求两个正交邻居都可行（防切角穿墙）。 */
export function gridDistances(mask: WalkMask, sources: { i: number; j: number; d: number }[]): Float64Array {
  const { step, nx, ny, mask: m } = mask;
  const N = nx * ny;
  const dd = new Float64Array(N).fill(Infinity);
  const walkAt = (i: number, j: number) => i >= 0 && i < nx && j >= 0 && j < ny && m[j * nx + i] === 1;
  const heapI: number[] = [];
  const heapJ: number[] = [];
  const heapD: number[] = [];
  const push = (i: number, j: number, d: number) => {
    heapI.push(i);
    heapJ.push(j);
    heapD.push(d);
    let k = heapD.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p] <= heapD[k]) break;
      [heapI[p], heapI[k]] = [heapI[k], heapI[p]];
      [heapJ[p], heapJ[k]] = [heapJ[k], heapJ[p]];
      [heapD[p], heapD[k]] = [heapD[k], heapD[p]];
      k = p;
    }
  };
  const pop = (): { i: number; j: number; d: number } | null => {
    if (!heapD.length) return null;
    const i = heapI[0], j = heapJ[0], d = heapD[0];
    const li = heapI.pop()!, lj = heapJ.pop()!, ld = heapD.pop()!;
    if (heapD.length) {
      heapI[0] = li;
      heapJ[0] = lj;
      heapD[0] = ld;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let mm = k;
        if (l < heapD.length && heapD[l] < heapD[mm]) mm = l;
        if (r < heapD.length && heapD[r] < heapD[mm]) mm = r;
        if (mm === k) break;
        [heapI[mm], heapI[k]] = [heapI[k], heapI[mm]];
        [heapJ[mm], heapJ[k]] = [heapJ[k], heapJ[mm]];
        [heapD[mm], heapD[k]] = [heapD[k], heapD[mm]];
        k = mm;
      }
    }
    return { i, j, d };
  };
  for (const s of sources) {
    const c = s.j * nx + s.i;
    if (walkAt(s.i, s.j) && s.d < dd[c]) {
      dd[c] = s.d;
      push(s.i, s.j, s.d);
    }
  }
  let top;
  while ((top = pop())) {
    const { i, j, d } = top;
    if (d > dd[j * nx + i]) continue;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di, nj = j + dj;
        if (!walkAt(ni, nj)) continue;
        if (di !== 0 && dj !== 0 && !(walkAt(i + di, j) && walkAt(i, j + dj))) continue;
        const nd = d + (di !== 0 && dj !== 0 ? SQRT2 : 1) * step;
        const nc = nj * nx + ni;
        if (nd < dd[nc]) {
          dd[nc] = nd;
          push(ni, nj, nd);
        }
      }
    }
  }
  return dd;
}

type Landing = { i: number; j: number; d: number };

/** 把出口/门点投影到掩码内最近可行走栅格点：
 * 在 snap 环内枚举全部可行走格，取「连接段全程可行走」（不穿墙）且距离最小者。
 * 不能只看最近格——最近点可能隔着一堵薄墙，绕到墙两侧的次近点才是真落点。 */
function nearestLanding(p: Pt, snap: number, walkMask: WalkMask): Landing | null {
  const { step, ox, oy, nx, ny, mask: m } = walkMask;
  const ci = Math.round((p.x - ox) / step);
  const cj = Math.round((p.y - oy) / step);
  const r = Math.ceil(snap / step);
  let best: Landing | null = null;
  for (let j = cj - r; j <= cj + r; j++) {
    for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || i >= nx || j < 0 || j >= ny || m[j * nx + i] !== 1) continue;
      const q = { x: ox + i * step, y: oy + j * step };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > snap || (best && d >= best.d)) continue;
      if (segmentClear(p, q, walkMask)) best = { i, j, d };
    }
  }
  return best;
}

export function buildCorridorGraph(
  walkPolys: Pt[][],
  exitPts: Pt[],
  doors: DoorInput[],
  step: number,
): CorridorGraph {
  const walkMask = rasterizePolys(walkPolys, step)!;
  const { ox, oy, nx, ny, mask: m } = walkMask;
  const cellCount = nx * ny;

  const nodeIdx = new Int32Array(cellCount).fill(-1);
  let nLattice = 0;
  const pts = new Float64Array(cellCount * 2);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (m[c] === 1) {
        nodeIdx[c] = nLattice;
        pts[nLattice * 2] = ox + i * step;
        pts[nLattice * 2 + 1] = oy + j * step;
        nLattice++;
      }
    }
  }

  const EXIT_SNAP = 2500; // 2.5m
  const DOOR_SNAP = 1500; // 1.5m

  const nExits = exitPts.length;
  const nDoors = doors.length;

  // 出口落点：投影到可行走区域内
  const exitConnected: boolean[] = [];
  const exitLandings: (Landing | null)[] = [];
  for (let e = 0; e < nExits; e++) {
    const land = nearestLanding(exitPts[e], EXIT_SNAP, walkMask);
    exitLandings.push(land);
    exitConnected.push(!!land);
  }

  // 门落点
  const doorLandings: (Landing | null)[] = [];
  for (let k = 0; k < nDoors; k++) doorLandings.push(nearestLanding(doors[k].pt, DOOR_SNAP, walkMask));

  // 主结果：多源 Dijkstra（每个已连接出口的落点为源，初始距离 = 出口→落点残段）
  const sources = exitLandings
    .filter((l): l is Landing => !!l)
    .map((l) => ({ i: l.i, j: l.j, d: l.d }));
  const cellDist = gridDistances(walkMask, sources);

  // 压缩到节点序
  const dist = new Float64Array(nLattice).fill(Infinity);
  for (let c = 0; c < cellCount; c++) {
    const u = nodeIdx[c];
    if (u >= 0) dist[u] = cellDist[c];
  }

  // 不可达组分：多源 Dijkstra 里「距离有限」只说明该点靠近某个出口源，
  // 但断开组分各自带出口时两边都会有限。必须从所有出口落点做一次 BFS 泛洪
  // （8 邻，沿用切角规则），没被淹到的可行走点才是真正到不了任何出口的区域。
  const reached = new Uint8Array(cellCount);
  {
    const queue: number[] = [];
    for (const l of sources) {
      const c = l.j * nx + l.i;
      if (!reached[c]) { reached[c] = 1; queue.push(c); }
    }
    const walkAt = (i: number, j: number) => i >= 0 && i < nx && j >= 0 && j < ny && m[j * nx + i] === 1;
    let head = 0;
    while (head < queue.length) {
      const c = queue[head++];
      const i = c % nx, j = (c - i) / nx;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = i + di, nj = j + dj;
          if (!walkAt(ni, nj)) continue;
          if (di !== 0 && dj !== 0 && !(walkAt(i + di, j) && walkAt(i, j + dj))) continue;
          const nc = nj * nx + ni;
          if (!reached[nc]) { reached[nc] = 1; queue.push(nc); }
        }
      }
    }
  }
  let hasUnreachable = false;
  for (let c = 0; c < cellCount; c++) {
    if (m[c] === 1 && !reached[c]) { hasUnreachable = true; break; }
  }

  // 门距离 = 落点残段 + 落点处路径距离
  const doorDist: number[] = doorLandings.map((l) =>
    l ? l.d + cellDist[l.j * nx + l.i] : Infinity,
  );

  // 死端（袋形走道）：对每个已连接出口各跑一次单源 Dijkstra（出口通常 ≤ 6 个，
  // 上限取 12，更多时忽略多余出口——出口数量本身受 EXIT_COUNT 规则约束）。
  const perExitLandings = exitLandings.filter((l): l is Landing => !!l).slice(0, 12);
  const perExit = perExitLandings.map((l) => gridDistances(walkMask, [{ i: l.i, j: l.j, d: l.d }]));
  const deadEndMax = computeDeadEnd(perExit, perExitLandings, nodeIdx, walkMask);

  return {
    step,
    nLattice,
    pts: pts.subarray(0, nLattice * 2) as Float64Array,
    dist,
    doorDist,
    exitConnected,
    deadEndMax,
    hasUnreachable,
    nodeAtLattice: (x: number, y: number) => {
      const i = Math.round((x - ox) / step);
      const j = Math.round((y - oy) / step);
      if (i < 0 || i >= nx || j < 0 || j >= ny) return -1;
      return nodeIdx[j * nx + i];
    },
  };
}

/** 房间内沿路径最不利距离。
 *
 * 与走道同口径：房间多边形单独栅格化（边界包含式），门与房内出口投影到掩码内，
 * 多源 Dijkstra 求每个可行走点的逃生路径长度，再补测全部多边形顶点。
 * - 非凸房间（U 形、L 形）不再穿墙取直线，沿房间内部绕行；
 * - 顶点必测：射线法采样会漏掉多边形角点，角点往往就是最远点；
 * - 返回 connected=false 表示房间没有任何门/出口能接上自己的可行走区域，
 *   调用方必须报错，不能静默放行。
 */
export function roomWorstPath(
  roomPoly: Pt[],
  sources: { pt: Pt; d0: number }[], // d0 = 到达该点后剩余的逃生路径（门→出口的走道段；房内出口为 0）
  step: number,
): { worstMm: number; point: Pt; connected: boolean } | null {
  const walkMask = rasterizePolys([roomPoly], step);
  if (!walkMask) return null;
  const { ox, oy, nx, ny } = walkMask;
  const srcs: { i: number; j: number; d: number }[] = [];
  const addSource = (p: Pt, d0: number, snap: number) => {
    if (d0 === Infinity) return;
    // 点恰在边界栅格上时（门贴着走道共边、出口落在边线上）零残段直连，
    // 与走道里人站在门口的实际一致
    const di0 = Math.round((p.x - ox) / step);
    const dj0 = Math.round((p.y - oy) / step);
    if (di0 >= 0 && di0 < nx && dj0 >= 0 && dj0 < ny && walkMask.mask[dj0 * nx + di0] === 1) {
      const residual = Math.hypot(ox + di0 * step - p.x, oy + dj0 * step - p.y);
      if (residual < 1e-6) {
        srcs.push({ i: di0, j: dj0, d: d0 });
        return;
      }
    }
    const land = nearestLanding(p, snap, walkMask);
    if (land) srcs.push({ i: land.i, j: land.j, d: land.d + d0 });
  };
  for (const s of sources) addSource(s.pt, s.d0, s.d0 === 0 ? EXIT_SNAP_IN_ROOM : step); // 门贴房间边取 1 格；房内出口 2.5m
  if (!srcs.length) return { worstMm: Infinity, point: roomPoly[0], connected: false };

  const dd = gridDistances(walkMask, srcs);
  let worst = -1;
  let worstPt: Pt = roomPoly[0];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = dd[j * nx + i];
      if (v !== Infinity && v > worst) {
        worst = v;
        worstPt = { x: ox + i * step, y: oy + j * step };
      }
    }
  }
  // 多边形顶点逐个补测（可能落在掩码外的角点：取最近可行走点 + 残段）
  for (const p of roomPoly) {
    const land = nearestLanding(p, step, walkMask);
    if (!land) continue;
    const v = land.d + dd[land.j * nx + land.i];
    if (v > worst) {
      worst = v;
      worstPt = p;
    }
  }
  if (worst < 0) return { worstMm: Infinity, point: roomPoly[0], connected: false };
  return { worstMm: worst, point: worstPt, connected: true };
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
function computeDeadEnd(
  perExit: Float64Array[],
  exitLandings: Landing[],
  nodeIdx: Int32Array,
  walkMask: WalkMask,
): number {
  const E = exitLandings.length;
  if (E === 0) return 0;
  const { nx } = walkMask;
  const exitCells = exitLandings.map((l) => l.j * nx + l.i);
  if (E === 1) {
    const d = perExit[0];
    let max = 0;
    for (let c = 0; c < nodeIdx.length; c++) {
      const u = nodeIdx[c];
      if (u < 0) continue;
      const v = d[c];
      if (v !== Infinity && v > max) max = v;
    }
    return max;
  }
  const D = new Float64Array(E * E);
  for (let i = 0; i < E; i++) {
    for (let j = 0; j < E; j++) D[i * E + j] = perExit[i][exitCells[j]];
  }
  let max = 0;
  for (let c = 0; c < nodeIdx.length; c++) {
    if (nodeIdx[c] < 0) continue;
    let best = Infinity; // 该点由出口对算出的最小袋深
    let single = Infinity; // 仅可达一个出口时退化为该距离
    let finiteCnt = 0;
    for (let i = 0; i < E; i++) {
      const di = perExit[i][c];
      if (di === Infinity) continue;
      finiteCnt++;
      single = di;
      for (let j = i + 1; j < E; j++) {
        const dj = perExit[j][c];
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
