import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pt } from '../model';
import { FACILITY_LABELS, USAGE_LABELS } from '../model';
import { bboxOf, niceScaleBarM } from '../lib/geometry';
import { checkDueInfo } from '../lib/engine';
import { useStore, setMark } from '../store/store';
import { floorLabel } from '../store/id';
import { Link } from '../router';
import { FloorPlan, mmFromEvent, type DragState, type View } from '../components/FloorPlan';
import { FacilityGlyph, facilitySymbol } from '../components/symbols';
import { download } from './Facilities';

const PAPER: Record<string, { w: number; h: number; label: string }> = {
  a4l: { w: 297, h: 210, label: 'A4 横向' },
  a4p: { w: 210, h: 297, label: 'A4 纵向' },
  a3l: { w: 420, h: 297, label: 'A3 横向' },
  a3p: { w: 297, h: 420, label: 'A3 纵向' },
};

const KIND_ORDER = ['extinguisher', 'hydrant', 'exit_sign', 'emergency_light', 'exit', 'sprinkler'] as const;

export function PrintPage({ floorId }: { floorId: string }) {
  const floor = useStore((s) => s.floors[floorId]);
  const building = useStore((s) => s.buildings.find((b) => b.id === floor?.buildingId));
  const rules = useStore((s) => (floor ? s.rules[s.buildings.find((b) => b.id === floor.buildingId)?.kind ?? 'office'] : undefined));
  const mark = useStore((s) => s.marks[floorId]);
  const [paper, setPaper] = useState<keyof typeof PAPER>('a4l');
  const [view, setView] = useState<View>({ cx: 0, cy: 0, zoom: 0.05 });
  const [drag, setDrag] = useState<DragState>(null);
  const [dragDelta, setDragDelta] = useState<Pt>({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const printRef = useRef<HTMLDivElement | null>(null);

  // 视野适配图纸内容
  useEffect(() => {
    if (!floor) return;
    const polys = floor.rooms.map((r) => r.polygon);
    if (!polys.length) return;
    const bb = bboxOf(polys);
    const el = svgRef.current;
    const pxW = el ? el.clientWidth : 900;
    const pxH = el ? el.clientHeight : 640;
    const wMm = bb.maxX - bb.minX + 10000;
    const hMm = bb.maxY - bb.minY + 10000;
    setView({
      cx: (bb.minX + bb.maxX) / 2,
      cy: (bb.minY + bb.maxY) / 2,
      zoom: Math.min(pxW / wMm, pxH / hMm),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorId]);

  const scaleInfo = useMemo(() => {
    // 显示比例：1 图上 mm 代表多少真实 mm（px per mm * 视觉换算按 96dpi 近似 1px = 0.2646 图上 mm）
    const pxPerMm = view.zoom;
    const paperMmPerPx = 0.2646;
    return pxPerMm * paperMmPerPx; // 图上 1mm 对应的实际 mm
  }, [view.zoom]);

  if (!floor || !rules) {
    return <div className="page">楼层不存在。<Link to="/">返回首页</Link></div>;
  }

  const p = PAPER[paper];
  const result = floor.lastValidation;
  const barM = niceScaleBarM(80 / (scaleInfo || 0.05) / 1000);

  // 整改清单：不合规项 + 过期/缺失检查
  const overdueFacs = floor.facilities.filter((f) => {
    const info = checkDueInfo(f, Date.now());
    return info.overdue || info.missing || info.defect;
  });

  const ledgerCsv = () => {
    const header = '点位编号,类型,X(m),Y(m),规格,最近检查,状态';
    const lines = floor.facilities.map((f) => {
      const sorted = [...f.checks].sort((a, b) => b.date.localeCompare(a.date));
      const spec = f.spec ? `${f.spec.extType ?? ''} ${f.spec.weightKg ?? ''}kg`.trim() : '';
      return [f.code, FACILITY_LABELS[f.kind], (f.x / 1000).toFixed(1), (f.y / 1000).toFixed(1), spec, sorted[0]?.date ?? '未检', sorted[0]?.status ?? 'missing'].join(',');
    });
    download(`${floorLabel(floor.level)}_设施台账.csv`, [header, ...lines].join('\n'));
  };

  const exportPng = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const vb = svg.viewBox.baseVal;
    clone.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    clone.setAttribute('width', String(Math.round(vb.width / 40)));
    clone.setAttribute('height', String(Math.round(vb.height / 40)));
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vb.width / 20);
    canvas.height = Math.round(vb.height / 20);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${building?.name ?? '建筑'}_${floorLabel(floor.level)}_疏散图.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };

  const toMm = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    return mmFromEvent(svg, view, e);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 1) {
      setDrag({ kind: 'pan', startMm: toMm(e), orig: { cx: view.cx, cy: view.cy }, moved: false });
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const p = toMm(e);
      const o = drag.orig as { cx: number; cy: number };
      setView({ ...view, cx: o.cx - (p.x - drag.startMm.x), cy: o.cy - (p.y - drag.startMm.y) });
    }
  };
  const onPointerUp = () => {
    if (drag?.kind === 'mark' && (dragDelta.x !== 0 || dragDelta.y !== 0) && mark) {
      setMark(floorId, { x: mark.x + dragDelta.x, y: mark.y + dragDelta.y });
    }
    setDrag(null);
    setDragDelta({ x: 0, y: 0 });
  };

  const onMarkDown = (e: React.PointerEvent<SVGGElement>) => {
    const start = toMm(e);
    setDrag({ kind: 'mark', startMm: start, orig: mark ?? { x: 0, y: 0 }, moved: false });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = toMm(ev);
      setDragDelta({ x: p.x - start.x, y: p.y - start.y });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const p = toMm(ev);
      setMark(floorId, { x: p.x, y: p.y });
      setDrag(null);
      setDragDelta({ x: 0, y: 0 });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const roomLegend = Object.entries(USAGE_LABELS);

  return (
    <div className="page printpage" ref={printRef}>
      <div className="toolbar no-print">
        <select value={paper} onChange={(e) => setPaper(e.target.value as keyof typeof PAPER)}>
          {Object.entries(PAPER).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={() => window.print()}>打印 / 另存 PDF</button>
        <button onClick={exportPng}>导出 PNG</button>
        <button onClick={ledgerCsv}>导出设施台账 CSV</button>
        <Link className="btn" to={`/floor/${floorId}`}>返回编辑</Link>
      </div>

      {/* 出图区域：白底、图例、比例尺、指北针、「您在此」 */}
      <div className="print-sheet" style={{ aspectRatio: `${p.w} / ${p.h}`, maxWidth: p.w * 3.2 }}>
        <div className="sheet-title">
          <b>{building?.name ?? '建筑'} {floorLabel(floor.level)}层 疏散指示图</b>
          <span>比例尺 1 : {Math.round(1000 / (scaleInfo || 0.05))} ｜ 依据：{rules.source}</span>
        </div>
        <div className="sheet-map">
          <svg
            ref={svgRef}
            className="print-svg"
            viewBox={`${view.cx - 500 / view.zoom} ${view.cy - 400 / view.zoom} ${1000 / view.zoom} ${800 / view.zoom}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={(e) => e.preventDefault()}
          >
            <FloorPlan
              floor={floor}
              view={view}
              svgRef={svgRef}
              underlayUrl={null}
              showGrid={false}
              selected={null}
              drag={drag}
              dragDelta={dragDelta}
              draftPoints={[]}
              draftCursor={null}
              coverageCells={null}
              highlight={null}
              markPt={mark ?? { x: (bboxOf(floor.rooms.map((r) => r.polygon)).minX + bboxOf(floor.rooms.map((r) => r.polygon)).maxX) / 2, y: 0 }}
              onMarkPointerDown={onMarkDown}
            />
            {/* 比例尺 */}
            <g transform={`translate(${view.cx - 500 / view.zoom + 1500 / view.zoom},${view.cy + 380 / view.zoom})`} stroke="#333" fill="#333">
              <line x1={0} y1={0} x2={barM * 1000} y2={0} strokeWidth={4} vectorEffect="non-scaling-stroke" />
              <line x1={0} y1={-300} x2={0} y2={300} strokeWidth={3} vectorEffect="non-scaling-stroke" />
              <line x1={barM * 1000} y1={-300} x2={barM * 1000} y2={300} strokeWidth={3} vectorEffect="non-scaling-stroke" />
              <text x={barM * 500} y={-800} textAnchor="middle" fontSize={500} stroke="none">{barM}m</text>
            </g>
            {/* 指北针 */}
            <g transform={`translate(${view.cx + 440 / view.zoom},${view.cy - 340 / view.zoom})`}>
              <polygon points="0,-2600 900,1600 0,600 -900,1600" fill="#333" />
              <text y={2600} textAnchor="middle" fontSize={1400} fill="#333">N</text>
            </g>
          </svg>
        </div>
        <div className="sheet-legend">
          <div>
            {KIND_ORDER.map((k) => {
              const sym = facilitySymbol(k);
              return (
                <span key={k} className="legendrow">
                  <span className="glyphbox"><FacilityGlyph kind={k} s={6} /></span>
                  {FACILITY_LABELS[k]}（{sym.letter}）
                </span>
              );
            })}
          </div>
          <div>
            {roomLegend.map(([k, v]) => (
              <span key={k} className="legendrow">
                <span className="swatch" style={{ background: '#fff', border: '1px solid #999' }} />
                {v}
              </span>
            ))}
          </div>
        </div>
        <div className="sheet-foot">
          {result ? (
            <>
              <span>校验结论：{result.pass ? '合规' : '存在不合规项'} · 疏散最远 {result.travelWorstM != null ? `${result.travelWorstM.toFixed(1)}m` : '—'}（限值 {result.rulesSnapshot.maxTravelDistanceM}m） · 规则 {result.rulesSnapshot.buildingKind} v{result.rulesSnapshot.version}</span>
              <span>依据文号：{result.rulesSnapshot.source} ｜ 校验时间：{new Date(result.checkedAt).toLocaleString('zh-CN')}</span>
            </>
          ) : (
            <span>尚未校验（在编辑器中打开本层即自动校验）</span>
          )}
        </div>
      </div>

      {/* 整改清单 */}
      <div className="section no-print" style={{ maxWidth: 900 }}>
        <h3>整改清单（不合规项汇总）</h3>
        {(result?.items.length ?? 0) === 0 && overdueFacs.length === 0 && <p className="hint">无不合规项</p>}
        <ul>
          {result?.items.map((it, i) => (
            <li key={i} className={it.severity}>
              [{it.severity === 'error' ? '超限' : '警告'}] {it.message}
            </li>
          ))}
          {overdueFacs.map((f) => {
            const already = result?.items.some((i) => i.facilityId === f.id && (i.type === 'CHECK_OVERDUE' || i.type === 'CHECK_MISSING' || i.type === 'FACILITY_DEFECT'));
            if (already) return null;
            return (
              <li key={f.id} className="warning">
                [警告] {f.code} 检查记录过期/缺失
              </li>
            );
          })}
        </ul>
        <p className="hint">过期项 100% 出现在本清单中（按检查周期判定）。</p>
      </div>
    </div>
  );
}
