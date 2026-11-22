import { formatBytes } from '../utils/format';

export function TrafficChart({ up, down }: { up: number[]; down: number[] }) {
  const width = 460;
  const height = 104;
  const padTop = 14;
  const padBottom = 8;
  const plotH = height - padTop - padBottom;
  const peak = Math.max(1024, ...up, ...down);

  const toCoords = (arr: number[]) => {
    if (arr.length === 0) return [];
    const step = width / Math.max(1, arr.length - 1);
    return arr.map((v, i) => ({
      x: Number((i * step).toFixed(1)),
      y: Number((height - padBottom - (Math.min(v, peak) / peak) * plotH).toFixed(1))
    }));
  };

  const toLine = (pts: Array<{ x: number; y: number }>) => pts.map((p) => `${p.x},${p.y}`).join(' ');

  const toArea = (pts: Array<{ x: number; y: number }>) => {
    if (pts.length < 2) return '';
    const base = height - padBottom;
    return `${pts[0].x},${base} ${toLine(pts)} ${pts[pts.length - 1].x},${base}`;
  };

  const downPts = toCoords(down);
  const upPts = toCoords(up);

  return (
    <div style={{ position: 'relative' }}>
      <div
        class="mono"
        style={{
          position: 'absolute',
          right: '4px',
          top: '0',
          fontSize: '10.5px',
          color: 'var(--text-muted)',
          pointerEvents: 'none'
        }}
      >
        峰值 {formatBytes(peak, true)}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: '104px', display: 'block' }}
        aria-label="Live throughput sparkline"
      >
        <defs>
          <linearGradient id="nd-down-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--green)" stop-opacity="0.28" />
            <stop offset="100%" stop-color="var(--green)" stop-opacity="0.01" />
          </linearGradient>
          <linearGradient id="nd-up-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.24" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.01" />
          </linearGradient>
        </defs>

        <line x1="0" y1={height - padBottom} x2={width} y2={height - padBottom} stroke="var(--border)" stroke-width="1" />
        <line
          x1="0"
          y1={padTop + plotH / 2}
          x2={width}
          y2={padTop + plotH / 2}
          stroke="var(--border)"
          stroke-dasharray="3 3"
          stroke-width="1"
        />
        <line x1="0" y1={padTop} x2={width} y2={padTop} stroke="var(--border)" stroke-dasharray="2 4" stroke-opacity="0.6" stroke-width="1" />

        {downPts.length > 1 && (
          <>
            <polygon fill="url(#nd-down-fill)" points={toArea(downPts)} />
            <polyline fill="none" stroke="var(--green)" stroke-width="2.2" stroke-linejoin="round" points={toLine(downPts)} />
          </>
        )}
        {upPts.length > 1 && (
          <>
            <polygon fill="url(#nd-up-fill)" points={toArea(upPts)} />
            <polyline fill="none" stroke="var(--accent)" stroke-width="1.9" stroke-linejoin="round" points={toLine(upPts)} />
          </>
        )}
      </svg>
    </div>
  );
}
