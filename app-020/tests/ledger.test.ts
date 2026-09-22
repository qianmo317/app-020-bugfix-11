/**
 * 检查台账验收用例（验收标准：检查记录按日期排序，过期项 100% 出现在整改清单）
 */
import { describe, it, expect } from 'vitest';
import { mkRoom, rect, mkFloor, validateFloor } from './helpers';
import { checkDueInfo } from '../src/lib/engine';

const DAY = 86400000;
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
/** 本地时区日期 + n 天（与引擎 dueDate 的本地取日一致） */
const plusDays = (ds: string, n: number) => {
  const d = new Date(`${ds}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p2 = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

describe('checkDueInfo（检查到期判定）', () => {
  it('L1 多条记录按日期取最近一次（乱序输入不影响结论）', () => {
    const info = checkDueInfo(
      {
        kind: 'extinguisher',
        checks: [
          { date: dateStr(45), status: 'ok' },
          { date: dateStr(3), status: 'ok' },
          { date: dateStr(20), status: 'low_pressure' },
        ],
      },
      Date.now(),
    );
    expect(info.overdue).toBe(false); // 最近一次 3 天前，周期 30 天
    expect(info.missing).toBe(false);
    expect(info.defect).toBe(false);
    expect(info.dueDate).toBe(plusDays(dateStr(3), 30)); // 3 天前 + 30 天
  });

  it('L2 超过周期 → overdue，应检日期 = 最近检查 + 周期', () => {
    const info = checkDueInfo(
      { kind: 'extinguisher', checks: [{ date: dateStr(45), status: 'ok' }] },
      Date.now(),
    );
    expect(info.overdue).toBe(true);
    expect(info.dueDate).toBe(plusDays(dateStr(45), 30)); // 45 天前 + 30 天 = 15 天前到期
  });

  it('L3 状态 damaged/missing → defect 需整改；low_pressure 不算 defect', () => {
    const damaged = checkDueInfo(
      { kind: 'hydrant', checks: [{ date: dateStr(1), status: 'damaged' }] },
      Date.now(),
    );
    expect(damaged.defect).toBe(true);
    expect(damaged.overdue).toBe(false);
    const lp = checkDueInfo(
      { kind: 'hydrant', checks: [{ date: dateStr(1), status: 'low_pressure' }] },
      Date.now(),
    );
    expect(lp.defect).toBe(false);
  });

  it('L4 无任何记录 → missing，应检日期为空', () => {
    const info = checkDueInfo({ kind: 'exit_sign', checks: [] }, Date.now());
    expect(info.missing).toBe(true);
    expect(info.overdue).toBe(false);
    expect(info.dueDate).toBeNull();
  });

  it('L5 不同设施不同周期（灭火器 30 天 / 消火栓 30 天 / 出口 180 天）', () => {
    const checks = [{ date: dateStr(100), status: 'ok' as const }];
    expect(checkDueInfo({ kind: 'extinguisher', checks }, Date.now()).overdue).toBe(true);
    expect(checkDueInfo({ kind: 'hydrant', checks }, Date.now()).overdue).toBe(true);
    expect(checkDueInfo({ kind: 'exit', checks }, Date.now()).overdue).toBe(false); // 100 < 180
  });
});

describe('整改清单（validateFloor）', () => {
  it('L6 所有过期项 100% 出现在校验结果中（按 facilityId 对账）', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 41, 2))], [
      { kind: 'exit', x: 0.5, y: 1, checks: [{ date: dateStr(10), status: 'ok' }] },
      { kind: 'exit', x: 40.5, y: 1, checks: [{ date: dateStr(10), status: 'ok' }] },
      { kind: 'extinguisher', x: 13, y: 1, checks: [{ date: dateStr(45), status: 'ok' }] }, // 过期
      { kind: 'extinguisher', x: 28, y: 1, checks: [{ date: dateStr(5), status: 'ok' }] },
      { kind: 'hydrant', x: 20, y: 1, checks: [{ date: dateStr(45), status: 'ok' }] }, // 过期
      { kind: 'exit_sign', x: 33, y: 1, checks: [{ date: dateStr(45), status: 'ok' }] }, // 90 天周期未过期
    ]);
    const r = validateFloor(floor, rules);
    const overdueIds = r.items.filter((i) => i.type === 'CHECK_OVERDUE').map((i) => i.facilityId);
    // 45 天前检查的灭火器与消火栓必须全部在清单里
    const ext13 = floor.facilities.find((f) => f.kind === 'extinguisher' && Math.abs(f.x - 13000) < 1)!;
    const hyd = floor.facilities.find((f) => f.kind === 'hydrant')!;
    expect(overdueIds).toContain(ext13.id);
    expect(overdueIds).toContain(hyd.id);
    expect(overdueIds.length).toBe(2); // 100%：无遗漏也无多余
    // 过期是警告级：不影响整体合规结论，但必须可见
    expect(r.items.find((i) => i.type === 'CHECK_OVERDUE')!.severity).toBe('warning');
  });

  it('L7 缺记录 → CHECK_MISSING；损坏 → FACILITY_DEFECT（error 级置前）', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 30, 2))], [
      { kind: 'exit', x: 29.5, y: 1, checks: [{ date: dateStr(1), status: 'ok' }] },
      { kind: 'extinguisher', x: 10, y: 1 }, // 无记录
      { kind: 'extinguisher', x: 20, y: 1, checks: [{ date: dateStr(2), status: 'damaged' }] },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.items.some((i) => i.type === 'CHECK_MISSING')).toBe(true);
    const defect = r.items.find((i) => i.type === 'FACILITY_DEFECT');
    expect(defect).toBeDefined();
    expect(defect!.severity).toBe('error');
    expect(r.items[0].severity).toBe('error'); // error 排在最前
    expect(r.pass).toBe(false);
  });
});
