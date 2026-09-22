/**
 * 规则切换验收用例（验收标准：同一图纸在不同建筑类别规则下结论不同）+
 * 规则版本化快照（校验结果记录当时使用的规则版本与依据文号）
 */
import { describe, it, expect } from 'vitest';
import { mkRoom, rect, mkFloor, ruleWith, DEFAULT_RULES, validateFloor } from './helpers';

describe('规则切换（同一图纸，结论不同）', () => {
  it('R1 办公楼（r20）合格 vs 厂房（r12）覆盖不合格', () => {
    const { floor } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 41, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 40.5, y: 1 },
      { kind: 'extinguisher', x: 20.5, y: 1 },
    ]);
    const office = validateFloor(floor, DEFAULT_RULES.office);
    expect(office.pass).toBe(true);
    const factory = validateFloor(floor, DEFAULT_RULES.factory);
    expect(factory.pass).toBe(false);
    expect(factory.items.some((i) => i.type === 'COVERAGE_UNCOVERED')).toBe(true);
  });

  it('R2 死端限值 22（办公）vs 20（商业）：21m 袋形走道结论不同', () => {
    const { floor } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 21, 2))], [
      { kind: 'exit', x: 20.5, y: 1 },
      { kind: 'extinguisher', x: 10.5, y: 1 },
    ]);
    const office = validateFloor(floor, DEFAULT_RULES.office);
    expect(office.items.some((i) => i.type === 'DEADEND_EXCEED')).toBe(false);
    expect(office.pass).toBe(true);
    const retail = validateFloor(floor, DEFAULT_RULES.retail);
    expect(retail.items.some((i) => i.type === 'DEADEND_EXCEED')).toBe(true);
    expect(retail.pass).toBe(false);
  });

  it('R3 修改规则后版本 +1 且校验快照记录版本与依据文号', () => {
    const { floor } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 21, 2))], [
      { kind: 'exit', x: 20.5, y: 1 },
      { kind: 'extinguisher', x: 10.5, y: 1 },
    ]);
    const tightened = ruleWith(DEFAULT_RULES.office, {
      maxTravelDistanceM: 10,
      version: 7,
      source: '测试依据文件 X-001',
    });
    const r = validateFloor(floor, tightened);
    expect(r.rulesSnapshot.version).toBe(7);
    expect(r.rulesSnapshot.source).toBe('测试依据文件 X-001');
    expect(r.rulesSnapshot.buildingKind).toBe('office');
    expect(r.rulesSnapshot.maxTravelDistanceM).toBe(10);
    // 实测值也记录在项中，报告可打印「凭什么判超标」
    const exceed = r.items.find((i) => i.type === 'TRAVEL_EXCEED');
    expect(exceed).toBeDefined();
    expect(exceed!.value).not.toBeNull();
    expect(exceed!.limit).toBe(10);
  });

  it('R4 默认规则集：各类别限值与依据文号完整', () => {
    expect(DEFAULT_RULES.office.maxTravelDistanceM).toBe(40);
    expect(DEFAULT_RULES.office.deadEndDistanceM).toBe(22);
    expect(DEFAULT_RULES.retail.extinguisherRadiusM).toBe(20);
    expect(DEFAULT_RULES.factory.maxTravelDistanceM).toBe(30);
    expect(DEFAULT_RULES.factory.extinguisherRadiusM).toBe(12);
    expect(DEFAULT_RULES.school.maxTravelDistanceM).toBe(35);
    for (const k of ['office', 'retail', 'factory', 'school'] as const) {
      expect(DEFAULT_RULES[k].buildingKind).toBe(k);
      expect(DEFAULT_RULES[k].source.length).toBeGreaterThan(5);
      expect(DEFAULT_RULES[k].version).toBeGreaterThanOrEqual(1);
    }
  });
});
