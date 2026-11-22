export function TrafficChart({ up, down }: { up: number[]; down: number[] }) {
  const width = 420;
  const height = 88;
  const maxVal = Math.max(1024, ...up, ...down);

  const toPoints = (arr: number[]) => {
    if (arr.length === 0) return '';
    const step = width / Math.max(1, arr.length - 1);
    return arr
      .map((v, i) => {
        const x = (i * step).toFixed(1);
        const y = (height - 6 - (Math.min(v, maxVal) / maxVal) * (height - 14)).toFixed(1);
        return `${x},${y}`;
      })
      .join(' ');
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: '88px', display: 'block' }}
      aria-label="Live throughput sparkline"
    >
      <line x1="0" y1={height - 6} x2={width} y2={height - 6} stroke="var(--border)" stroke-width="1" />
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--border)" stroke-dasharray="3 3" stroke-width="1" />
      {down.length > 1 && (
        <polyline fill="none" stroke="var(--green)" stroke-width="2.2" points={toPoints(down)} />
      )}
      {up.length > 1 && (
        <polyline fill="none" stroke="var(--accent)" stroke-width="2" points={toPoints(up)} />
      )}
    </svg>
  );
}
