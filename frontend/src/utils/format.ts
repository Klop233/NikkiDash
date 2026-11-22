export function formatBytes(bytes: number, perSec = false): string {
  if (!Number.isFinite(bytes) || bytes < 0) return perSec ? '0 B/s' : '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const str = i === 0 ? `${Math.round(v)} ${units[i]}` : `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
  return perSec ? `${str}/s` : str;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatTimeAgo(isoOrEpoch?: string | number): string {
  if (!isoOrEpoch) return '-';
  const ts = typeof isoOrEpoch === 'number' ? (isoOrEpoch > 1e12 ? isoOrEpoch : isoOrEpoch * 1000) : Date.parse(isoOrEpoch);
  if (!Number.isFinite(ts)) return String(isoOrEpoch);
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h 前`;
  return new Date(ts).toLocaleString();
}

export function delayColorClass(delay?: number): string {
  if (delay == null || delay <= 0) return 'badge-red';
  if (delay < 150) return 'badge-green';
  if (delay < 400) return 'badge-amber';
  return 'badge-red';
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
