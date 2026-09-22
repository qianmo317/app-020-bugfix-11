import { useMemo, useState } from 'react';
import type { FacilityKind } from '../model';
import { FACILITY_LABELS, USAGE_LABELS } from '../model';
import { checkDueInfo } from '../lib/engine';
import { useStore } from '../store/store';
import { floorLabel } from '../store/id';
import { Link } from '../router';
import { pointInPoly } from '../lib/geometry';

function download(name: string, content: string, mime = 'text/csv') {
  const blob = new Blob([`\ufeff${content}`], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function FacilitiesPage() {
  const buildings = useStore((s) => s.buildings);
  const floors = useStore((s) => s.floors);
  const [kindFilter, setKindFilter] = useState<'all' | FacilityKind>('all');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const now = Date.now();

  const rows = useMemo(() => {
    const out: {
      buildingName: string;
      floorId: string;
      floorLabel: string;
      roomId?: string;
      roomName: string;
      id: string;
      code: string;
      kind: FacilityKind;
      x: number;
      y: number;
      lastDate: string | null;
      lastStatus: string | null;
      dueDate: string | null;
      overdue: boolean;
      missing: boolean;
      defect: boolean;
    }[] = [];
    for (const b of buildings) {
      for (const fid of b.floors) {
        const f = floors[fid];
        if (!f) continue;
        for (const fac of f.facilities) {
          if (kindFilter !== 'all' && fac.kind !== kindFilter) continue;
          const room = f.rooms.find((r) => pointInPoly({ x: fac.x, y: fac.y }, r.polygon));
          const info = checkDueInfo(fac, now);
          if (onlyOverdue && !(info.overdue || info.missing || info.defect)) continue;
          const sorted = [...fac.checks].sort((a, b2) => b2.date.localeCompare(a.date));
          out.push({
            buildingName: b.name,
            floorId: f.id,
            floorLabel: floorLabel(f.level),
            roomId: room?.id,
            roomName: room?.name ?? '—',
            id: fac.id,
            code: fac.code,
            kind: fac.kind,
            x: fac.x,
            y: fac.y,
            lastDate: sorted[0]?.date ?? null,
            lastStatus: sorted[0]?.status ?? null,
            dueDate: info.dueDate,
            overdue: info.overdue,
            missing: info.missing,
            defect: info.defect,
          });
        }
      }
    }
    // 按下次应检日期排序（过期/无记录排最前）
    out.sort((a, b2) => (a.dueDate ?? '0').localeCompare(b2.dueDate ?? '0'));
    return out;
  }, [buildings, floors, kindFilter, onlyOverdue, now]);

  const exportCsv = () => {
    const header = '建筑,楼层,点位编号,类型,所在房间,最近检查,状态,下次应检,是否过期';
    const lines = rows.map((r) =>
      [r.buildingName, r.floorLabel, r.code, FACILITY_LABELS[r.kind], r.roomName, r.lastDate ?? '未检', r.lastStatus ?? 'missing', r.dueDate ?? '—', r.overdue || r.missing || r.defect ? '是' : '否'].join(','),
    );
    download(`消防设施台账_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...lines].join('\n'));
  };

  return (
    <div className="page">
      <h2>全楼设施台账与检查记录</h2>
      <div className="toolbar">
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | FacilityKind)}>
          <option value="all">全部类型</option>
          {Object.entries(FACILITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <label className="row">
          <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
          只看待整改（过期/缺失/损坏）
        </label>
        <button onClick={exportCsv}>导出台账 CSV</button>
        <Link className="btn" to="/rules">规则配置</Link>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>建筑</th>
            <th>楼层</th>
            <th>编号</th>
            <th>类型</th>
            <th>房间</th>
            <th>最近检查</th>
            <th>状态</th>
            <th>下次应检</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.overdue || r.missing || r.defect ? 'overdue-row' : ''}>
              <td>{r.buildingName}</td>
              <td>{r.floorLabel}</td>
              <td>{r.code}</td>
              <td>{FACILITY_LABELS[r.kind]}</td>
              <td>{r.roomName}</td>
              <td>{r.lastDate ?? <span className="bad">未登记</span>}</td>
              <td>{r.lastStatus ? <span className={`badge st-${r.lastStatus}`}>{r.lastStatus}</span> : '—'}</td>
              <td>{r.dueDate ?? '—'}{(r.overdue || r.missing || r.defect) && <span className="badge st-expired">待整改</span>}</td>
              <td>
                <Link className="btn" to={`/floor/${r.floorId}`}>查看</Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="hint">无设施记录，请先在楼层编辑器中布置设施</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="hint">
        房间用途（{Object.values(USAGE_LABELS).join(' / ')}）影响人数估算与出口数量校验
      </p>
    </div>
  );
}

export { download };
