/**
 * 性能验收用例（验收标准：单层 200 房间 + 500 设施，校验计算 < 500ms）
 */
import { describe, it, expect } from 'vitest';
import { mkRoom, rect, mkFloor, validateFloor, type FacSpec } from './helpers';
import type { Room } from '../src/model';

const DAY = 86400000;
const today = new Date(Date.now() - DAY).toISOString().slice(0, 10);

function buildBigFloor(): ReturnType<typeof mkFloor> {
  const rooms: Room[] = [];
  // 10 条 60m 走道，每条上下各 10 个 6×5 房间 → 200 个房间
  for (let k = 0; k < 10; k++) {
    const y0 = k * 20;
    rooms.push(mkRoom(`走道${k}`, 'corridor', rect(0, y0, 60, 2)));
    for (let i = 0; i < 10; i++) {
      rooms.push(mkRoom(`${k}F上${i}`, 'office', rect(i * 6, y0 + 2, 6, 5)));
      rooms.push(mkRoom(`${k}F下${i}`, 'office', rect(i * 6, y0 - 5, 6, 5)));
    }
  }
  const ok = [{ date: today, status: 'ok' as const }];
  const facs: FacSpec[] = [
    { kind: 'exit', x: 0.5, y: 1, checks: ok },
    { kind: 'exit', x: 59.5, y: 1, checks: ok },
  ];
  for (let i = 0; i < 58; i++) facs.push({ kind: 'extinguisher', x: 1 + i, y: 1, checks: ok });
  const kinds = ['hydrant', 'exit_sign', 'emergency_light', 'sprinkler'] as const;
  for (let i = 0; i < 440; i++) {
    facs.push({ kind: kinds[i % 4], x: ((i % 59) + 0.5), y: 1, checks: ok });
  }
  return mkFloor(rooms, facs);
}

describe('性能（200 房间 + 500 设施）', () => {
  it('P1 validateFloor 全量校验 < 500ms', () => {
    const { floor, rules } = buildBigFloor();
    expect(floor.rooms.length).toBe(210); // 200 房间 + 10 走道
    expect(floor.facilities.length).toBe(500);
    const t0 = performance.now();
    const r = validateFloor(floor, rules);
    const elapsed = performance.now() - t0;
    expect(r.travelWorstM).not.toBeNull();
    expect(Array.isArray(r.items)).toBe(true);
    console.log(`validateFloor(210 rooms, 500 facilities): ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(500);
  });

  it('P2 二次校验（热路径）同样 < 500ms', () => {
    const { floor, rules } = buildBigFloor();
    validateFloor(floor, rules); // 预热
    const t0 = performance.now();
    validateFloor(floor, rules);
    const elapsed = performance.now() - t0;
    console.log(`validateFloor warm: ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(500);
  });
});
