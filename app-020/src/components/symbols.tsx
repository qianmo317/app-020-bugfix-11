import type { FacilityKind, RoomUsage } from '../model';

/** 图例符号：颜色 + 形状 + 字母三重编码（色盲友好，黑白打印可辨） */
export function facilitySymbol(kind: FacilityKind): { fill: string; stroke: string; letter: string; shape: string } {
  switch (kind) {
    case 'extinguisher':
      return { fill: '#d32f2f', stroke: '#8e1b1b', letter: 'E', shape: 'circle' };
    case 'hydrant':
      return { fill: '#c62828', stroke: '#7f1717', letter: 'H', shape: 'square' };
    case 'exit':
      return { fill: '#2e7d32', stroke: '#1b5e20', letter: '→', shape: 'exit' };
    case 'exit_sign':
      return { fill: '#66bb6a', stroke: '#2e7d32', letter: 'S', shape: 'triangle' };
    case 'emergency_light':
      return { fill: '#f9a825', stroke: '#b28704', letter: 'L', shape: 'diamond' };
    case 'sprinkler':
      return { fill: '#1565c0', stroke: '#0d47a1', letter: 'P', shape: 'hexagon' };
  }
}

export const USAGE_FILLS: Record<RoomUsage, string> = {
  office: '#eef3fb',
  retail: '#fdf3e7',
  storage: '#f3eefb',
  ward: '#eaf7f0',
  corridor: '#fafafa',
  other: '#f5f5f5',
};

export const USAGE_STROKES: Record<RoomUsage, string> = {
  office: '#90a8d0',
  retail: '#d9a86c',
  storage: '#a68ccc',
  ward: '#7fbfa0',
  corridor: '#555555',
  other: '#bbbbbb',
};

/** 在 SVG 坐标中心画设施符号（group，中心在 0,0） */
export function FacilityGlyph({ kind, s = 7 }: { kind: FacilityKind; s?: number }) {
  const sym = facilitySymbol(kind);
  const stroke = { fill: sym.fill, stroke: sym.stroke, strokeWidth: 1.2, vectorEffect: 'non-scaling-stroke' as const };
  if (sym.shape === 'circle') {
    return (
      <>
        <circle r={s} {...stroke} />
        <text y={s * 0.42} textAnchor="middle" fontSize={s * 1.1} fill="#fff" fontWeight="bold" style={{ userSelect: 'none' }}>
          {sym.letter}
        </text>
      </>
    );
  }
  if (sym.shape === 'square') {
    return (
      <>
        <rect x={-s} y={-s} width={s * 2} height={s * 2} {...stroke} />
        <text y={s * 0.42} textAnchor="middle" fontSize={s * 1.1} fill="#fff" fontWeight="bold" style={{ userSelect: 'none' }}>
          {sym.letter}
        </text>
      </>
    );
  }
  if (sym.shape === 'triangle') {
    const p = `${0},${-s} ${s * 0.95},${s * 0.7} ${-s * 0.95},${s * 0.7}`;
    return (
      <>
        <polygon points={p} {...stroke} />
        <text y={s * 0.55} textAnchor="middle" fontSize={s * 0.9} fill="#fff" fontWeight="bold" style={{ userSelect: 'none' }}>
          {sym.letter}
        </text>
      </>
    );
  }
  if (sym.shape === 'diamond') {
    const p = `${0},${-s} ${s},0 0,${s} ${-s},0`;
    return (
      <>
        <polygon points={p} {...stroke} />
        <text y={s * 0.42} textAnchor="middle" fontSize={s * 0.9} fill="#fff" fontWeight="bold" style={{ userSelect: 'none' }}>
          {sym.letter}
        </text>
      </>
    );
  }
  if (sym.shape === 'hexagon') {
    const pts = Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 3) * k - Math.PI / 6;
      return `${Math.cos(a) * s},${Math.sin(a) * s}`;
    }).join(' ');
    return (
      <>
        <polygon points={pts} {...stroke} />
        <text y={s * 0.42} textAnchor="middle" fontSize={s * 0.9} fill="#fff" fontWeight="bold" style={{ userSelect: 'none' }}>
          {sym.letter}
        </text>
      </>
    );
  }
  // exit：绿色方块 + 白色箭头（黑白打印下有 EXIT 文字）
  return (
    <>
      <rect x={-s * 1.6} y={-s} width={s * 3.2} height={s * 2} rx={2} {...stroke} />
      <text y={s * 0.45} textAnchor="middle" fontSize={s * 1.05} fill="#fff" fontWeight="bold" style={{ userSelect: 'none' }}>
        EXIT
      </text>
    </>
  );
}
