/**
 * store 回归测试 —— 沉淀自浏览器 E2E 发现的两个真实 bug：
 * 1. setState 仅浅拷贝顶层，嵌套对象原地改 → useSyncExternalStore 选择器引用不变 → 界面不更新
 *    （现象：点「添加楼层」无反应）。此处用订阅引用语义直接回归。
 * 2. 拖房间用 deleteRoom+addRoom 实现 → 丢 occupants、换 id、选中丢失。现用 moveRoom 回归。
 * 另覆盖 UI→store 的关键调用序列（放置/编号/检查记录/规则/标记）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  subscribe,
  getState,
  addBuilding,
  updateBuilding,
  deleteBuilding,
  addFloor,
  addRoom,
  updateRoom,
  moveRoom,
  addFacility,
  moveFacility,
  deleteFacility,
  addCheck,
  deleteCheck,
  updateRules,
  resetRules,
  setMark,
  setLastValidation,
} from '../src/store/store';
import type { AppState } from '../src/store/store';
import type { Pt } from '../src/model';

const snap = (): AppState => getState();

let bid = '';
let fid = '';

beforeEach(() => {
  for (const b of [...snap().buildings]) deleteBuilding(b.id);
  bid = addBuilding('测试厂房', 'office');
  fid = addFloor(bid, 1);
});

describe('store 响应性（useSyncExternalStore 依赖的引用语义）', () => {
  it('S1 每次 setState 后容器与嵌套对象引用更新（原 bug：addFloor 后界面不动）', () => {
    const s0 = snap();
    let notified = 0;
    const un = subscribe(() => notified++);
    const s1bid = addBuilding('B2', 'retail');
    const s1fid = addFloor(s1bid, 1);
    un();
    expect(notified).toBe(2);
    const s1 = snap();
    expect(s1).not.toBe(s0);
    expect(s1.buildings).not.toBe(s0.buildings); // s.buildings 选择器
    expect(s1.floors).not.toBe(s0.floors); // s.floors 选择器
    expect(s1.buildings.find((b) => b.id === s1bid)).not.toBe(s0.buildings.find((b) => b.id === s1bid));
    // 原 bug 根因：addFloor 原地 push，s.floors[fid] 引用不变 → 楼层列表不刷新
    expect(s1.floors[s1fid]).not.toBe(s0.floors[s1fid]);
    expect(s1.buildings.find((b) => b.id === s1bid)!.floors).toContain(s1fid);
  });

  it('S2 updateBuilding 替换建筑对象引用（名称输入框订阅）', () => {
    const b0 = snap().buildings.find((b) => b.id === bid)!;
    updateBuilding(bid, { name: '新名' });
    const b1 = snap().buildings.find((b) => b.id === bid)!;
    expect(b1).not.toBe(b0);
    expect(b1.name).toBe('新名');
    expect(b0.name).toBe('测试厂房'); // 旧引用不被原地修改
  });

  it('S3 updateRules 替换规则集引用且版本 +1（规则页订阅）', () => {
    const r0 = snap().rules.office;
    updateRules('office', { extinguisherRadiusM: 25 });
    const r1 = snap().rules.office;
    expect(r1).not.toBe(r0);
    expect(r1.extinguisherRadiusM).toBe(25);
    expect(r1.version).toBe(r0.version + 1);
    resetRules('office');
    expect(snap().rules.office.extinguisherRadiusM).toBe(r0.extinguisherRadiusM);
    expect(snap().rules.office.version).toBe(1);
  });
});

describe('房间与拖动（E2E 发现的拖房间丢属性 bug 回归）', () => {
  it('S4 moveRoom 平移多边形并保留 id/人数/面积/顺序', () => {
    const poly: Pt[] = [
      { x: 0, y: 2000 },
      { x: 8000, y: 2000 },
      { x: 8000, y: 8000 },
      { x: 0, y: 8000 },
    ];
    const rid = addRoom(fid, poly, '101室', 'office');
    updateRoom(fid, rid, { occupants: 10, name: '101室' });
    const before = snap().floors[fid].rooms.find((r) => r.id === rid)!;
    moveRoom(fid, rid, 1000, 6000); // UI 拖动 = moveRoom(dx, dy)
    const after = snap().floors[fid].rooms.find((r) => r.id === rid)!;
    expect(after).toBeDefined();
    expect(after.id).toBe(rid); // 原 bug：deleteRoom+addRoom 生成新 id → 选中丢失
    expect(after.occupants).toBe(10); // 原 bug：人数丢失
    expect(after.name).toBe('101室');
    expect(after.areaM2).toBeCloseTo(before.areaM2, 6);
    expect(after.polygon[0]).toEqual({ x: 1000, y: 8000 });
    expect(after.polygon[2]).toEqual({ x: 9000, y: 14000 });
    expect(snap().floors[fid].rooms.length).toBe(1); // 原 bug：删了再加，顺序/数量漂移
  });

  it('S5 updateRoom 改人数/用途后楼层引用更新（编辑器订阅）', () => {
    const rid = addRoom(fid, [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }], 'r', 'office');
    const f0 = snap().floors[fid];
    updateRoom(fid, rid, { occupants: 8, usage: 'ward' });
    const f1 = snap().floors[fid];
    expect(f1).not.toBe(f0);
    const r = f1.rooms.find((x) => x.id === rid)!;
    expect(r.occupants).toBe(8);
    expect(r.usage).toBe('ward');
  });
});

describe('设施：编号、exits 同步、拖动、检查记录', () => {
  it('S6 addFacility 编号查重递增；exit 同步进出 exits 列表', () => {
    const e1 = addFacility(fid, 'exit', 500, 1000);
    const e2 = addFacility(fid, 'exit', 39500, 1000);
    const x1 = addFacility(fid, 'extinguisher', 20000, 1000);
    let f = snap().floors[fid];
    expect(f.exits).toEqual([e1, e2]);
    expect(f.facilities.find((x) => x.id === e1)!.code).toBe('1F-EXIT-01');
    expect(f.facilities.find((x) => x.id === e2)!.code).toBe('1F-EXIT-02');
    expect(f.facilities.find((x) => x.id === x1)!.code).toBe('1F-EX-01');
    expect(f.facilities.find((x) => x.id === x1)!.spec).toEqual({ extType: 'dry_powder', weightKg: 4 });
    deleteFacility(fid, e1);
    f = snap().floors[fid];
    expect(f.exits).toEqual([e2]);
    expect(f.facilities.find((x) => x.id === e1)).toBeUndefined();
  });

  it('S7 moveFacility 更新坐标并替换楼层引用（灭火器拖动路径）', () => {
    const xid = addFacility(fid, 'extinguisher', 20000, 1000);
    const f0 = snap().floors[fid];
    moveFacility(fid, xid, 21000, 1500);
    const f1 = snap().floors[fid];
    expect(f1).not.toBe(f0);
    const fac = f1.facilities.find((x) => x.id === xid)!;
    expect(fac.x).toBe(21000);
    expect(fac.y).toBe(1500);
  });

  it('S8 addCheck/deleteCheck 维护检查记录（检查台账路径）', () => {
    const xid = addFacility(fid, 'extinguisher', 20000, 1000);
    addCheck(fid, xid, { date: '2026-09-01', status: 'ok' });
    addCheck(fid, xid, { date: '2026-09-16', status: 'ok', note: 'E2E' });
    const checks = () => snap().floors[fid].facilities.find((x) => x.id === xid)!.checks;
    expect(checks().map((c) => c.date)).toEqual(['2026-09-01', '2026-09-16']);
    deleteCheck(fid, xid, 0);
    expect(checks().map((c) => c.date)).toEqual(['2026-09-16']);
  });
});

describe('标记与校验结果', () => {
  it('S9 setMark 每次写入新对象（打印页「您在此」拖拽订阅）', () => {
    setMark(fid, { x: 1000, y: 2000 });
    const m0 = snap().marks[fid];
    setMark(fid, { x: 3000, y: 4000 });
    expect(snap().marks[fid]).not.toBe(m0);
    expect(snap().marks[fid]).toEqual({ x: 3000, y: 4000 });
  });

  it('S10 setLastValidation 写入楼层并替换其引用（校验面板订阅）', async () => {
    const { validateFloor } = await import('../src/lib/engine');
    const { DEFAULT_RULES } = await import('../src/rules/defaults');
    addRoom(fid, [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }], 'r', 'office');
    addFacility(fid, 'exit', 500, 500);
    const f0 = snap().floors[fid];
    const result = validateFloor(snap().floors[fid], DEFAULT_RULES.office);
    setLastValidation(fid, result);
    const f1 = snap().floors[fid];
    expect(f1).not.toBe(f0);
    expect(f1.lastValidation?.rulesSnapshot.buildingKind).toBe('office');
    expect(f1.lastValidation?.checkedAt).toBeTypeOf('string');
  });
});
