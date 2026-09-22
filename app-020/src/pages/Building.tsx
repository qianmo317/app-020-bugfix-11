import { useState } from 'react';
import type { BuildingKind } from '../model';
import { addFloor, deleteFloor, updateBuilding, useStore } from '../store/store';
import { floorLabel } from '../store/id';
import { Link } from '../router';

const KIND_LABELS: Record<BuildingKind, string> = {
  office: '办公楼',
  retail: '商业',
  factory: '厂房',
  school: '学校',
};

export function BuildingPage({ buildingId }: { buildingId: string }) {
  const building = useStore((s) => s.buildings.find((b) => b.id === buildingId));
  const floors = useStore((s) => s.floors);
  const [level, setLevel] = useState(1);

  if (!building) return <div className="page">建筑不存在。<Link to="/">返回首页</Link></div>;
  const bfs = building.floors.map((id) => floors[id]).filter(Boolean);

  // 竖向疏散：把各层出口按 x 归一化位置画到同一张剖面上，直观看出共享楼梯
  const exitMarks = bfs.map((f) => {
    const polys = f.rooms.map((r) => r.polygon);
    let minX = 0;
    let maxX = 1;
    if (polys.length) {
      minX = Math.min(...polys.flat().map((p) => p.x));
      maxX = Math.max(...polys.flat().map((p) => p.x));
    }
    const span = Math.max(1, maxX - minX);
    return {
      floor: f,
      exits: f.facilities
        .filter((x) => x.kind === 'exit')
        .map((x) => ({ code: x.code, pct: ((x.x - minX) / span) * 100 })),
    };
  });

  return (
    <div className="page">
      <div className="toolbar">
        <input
          value={building.name}
          onChange={(e) => updateBuilding(building.id, { name: e.target.value })}
          style={{ fontWeight: 600 }}
        />
        <select value={building.kind} onChange={(e) => updateBuilding(building.id, { kind: e.target.value as BuildingKind })}>
          {Object.entries(KIND_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="hint">建筑类别决定校验规则（在「规则」页调整）</span>
      </div>

      <h2>楼层</h2>
      <div className="toolbar">
        <input type="number" value={level} onChange={(e) => setLevel(Number(e.target.value))} style={{ width: 80 }} />
        <button onClick={() => addFloor(building.id, level)}>添加楼层</button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>楼层</th>
            <th>房间</th>
            <th>设施</th>
            <th>疏散最远</th>
            <th>结论</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {bfs.map((f) => {
            const v = f.lastValidation;
            return (
              <tr key={f.id}>
                <td>
                  <Link to={`/floor/${f.id}`}>{floorLabel(f.level)}</Link>
                </td>
                <td>{f.rooms.length}</td>
                <td>{f.facilities.length}</td>
                <td>{v?.travelWorstM != null ? `${v.travelWorstM.toFixed(1)}m` : '—'}</td>
                <td>
                  {v ? (
                    <span className={`badge ${v.pass ? 'st-ok' : 'st-damaged'}`}>
                      {v.pass ? '合规' : `${v.items.filter((i) => i.severity === 'error').length} 项超限`}
                    </span>
                  ) : (
                    <span className="hint">未校验</span>
                  )}
                </td>
                <td>
                  <Link className="btn" to={`/floor/${f.id}`}>编辑</Link>{' '}
                  <Link className="btn" to={`/floor/${f.id}/print`}>出图</Link>{' '}
                  <button
                    className="danger"
                    onClick={() => confirm(`删除 ${floorLabel(f.level)}？`) && deleteFloor(f.id)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            );
          })}
          {bfs.length === 0 && (
            <tr>
              <td colSpan={6} className="hint">暂无楼层，先添加一个</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>竖向疏散（楼梯间）</h2>
      <p className="hint">各层安全出口的水平位置对齐显示——上下位置接近的出口即共享竖向疏散楼梯。</p>
      <div className="section">
        {exitMarks.map(({ floor, exits }) => (
          <div key={floor.id} className="exitrow">
            <span className="exitlabel">{floorLabel(floor.level)}</span>
            <div className="exittrack">
              {exits.map((e) => (
                <span key={e.code} className="exitdot" style={{ left: `${e.pct}%` }} title={e.code}>
                  EXIT
                </span>
              ))}
            </div>
          </div>
        ))}
        {exitMarks.length === 0 && <span className="hint">无楼层</span>}
      </div>
    </div>
  );
}
