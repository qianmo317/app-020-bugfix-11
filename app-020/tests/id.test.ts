/**
 * 设施编号与基础工具：编号规则「楼层-类型-序号」（如 3F-EX-01），生成时查重取最大序号 +1
 */
import { describe, it, expect } from 'vitest';
import { floorLabel, nextCode } from '../src/store/id';
import type { Facility, Floor } from '../src/model';

function floorWithCodes(level: number, codes: string[]): Floor {
  const facilities: Facility[] = codes.map((code) => ({
    id: code,
    kind: 'extinguisher',
    x: 0,
    y: 0,
    code,
    checks: [],
  }));
  return {
    id: 'f1',
    buildingId: 'b1',
    level,
    scaleMmPerUnit: 1,
    rooms: [],
    facilities,
    exits: [],
    version: 0,
  };
}

describe('floorLabel', () => {
  it('I1 楼层标签：地上 nF，地下 Bn', () => {
    expect(floorLabel(1)).toBe('1F');
    expect(floorLabel(3)).toBe('3F');
    expect(floorLabel(-1)).toBe('B1');
    expect(floorLabel(-2)).toBe('B2');
  });
});

describe('nextCode（编号查重）', () => {
  it('I2 空楼层从 01 开始：1F-EX-01', () => {
    expect(nextCode(floorWithCodes(1, []), 'extinguisher')).toBe('1F-EX-01');
  });

  it('I3 已有 01/03 → 取最大序号 +1 得 04（允许中间断号）', () => {
    const f = floorWithCodes(1, ['1F-EX-01', '1F-EX-03']);
    expect(nextCode(f, 'extinguisher')).toBe('1F-EX-04');
  });

  it('I4 类型前缀互不干扰，地下楼层前缀正确', () => {
    const f = floorWithCodes(-1, ['1F-EX-02']);
    expect(nextCode(f, 'extinguisher')).toBe('B1-EX-01');
    expect(nextCode(f, 'hydrant')).toBe('B1-HY-01');
  });

  it('I5 出口类型 EXIT 前缀与 3F 楼层', () => {
    const f = floorWithCodes(3, ['3F-EXIT-01', '3F-EX-05']);
    expect(nextCode(f, 'exit')).toBe('3F-EXIT-02');
    expect(nextCode(f, 'extinguisher')).toBe('3F-EX-06');
  });

  it('I6 非数字序号不参与查重', () => {
    const f = floorWithCodes(1, ['1F-EX-AB']);
    expect(nextCode(f, 'extinguisher')).toBe('1F-EX-01');
  });
});
