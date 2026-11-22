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

export function parseFormattedSize(text?: string): number | null {
  if (!text || typeof text !== 'string') return null;
  const m = text.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMGTP]?i?B|B)?$/i);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return null;
  const unit = (m[2] || 'B').toUpperCase();
  const mult: Record<string, number> = {
    B: 1,
    KB: 1024,
    KIB: 1024,
    MB: 1024 ** 2,
    MIB: 1024 ** 2,
    GB: 1024 ** 3,
    GIB: 1024 ** 3,
    TB: 1024 ** 4,
    TIB: 1024 ** 4,
    PB: 1024 ** 5,
    PIB: 1024 ** 5
  };
  return val * (mult[unit] ?? 1);
}

export function formatHostPort(host?: string, port?: string | number): string {
  const h = (host || '-').trim();
  const p = port !== undefined && port !== null && String(port).length > 0 ? String(port) : '';
  if (!p) return h;
  if (h.includes(':') && !h.startsWith('[')) {
    return `[${h}]:${p}`;
  }
  return `${h}:${p}`;
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

export function formatTaskKind(kind: string): string {
  const map: Record<string, string> = {
    apply_config: '应用 Nikki 配置',
    service_action: 'Nikki 服务控制',
    update_subscription: '更新远程订阅',
    install_core: '安装 / 更新 Nikki 核心',
    remove_luci_nikki: '清理旧版 LuCI 界面'
  };
  return map[kind] || kind;
}

export function formatTaskStatus(status: string): string {
  const map: Record<string, string> = {
    queued: '排队中',
    running: '执行中',
    succeeded: '已完成',
    failed: '失败',
    rolled_back: '已自动回滚',
    rollback_failed: '回滚异常',
    unknown: '等待确认'
  };
  return map[status] || status;
}

export function formatTaskStep(step: string): string {
  const map: Record<string, string> = {
    lock: '获取写锁',
    revision_check: '校验版本',
    backup: '备份配置',
    validate_schema: '校验 UCI',
    validate_profile: '测试配置 (yq/mihomo)',
    reload_service: '重载服务',
    service_exec: '执行服务指令',
    readiness: '等待就绪',
    rollback: '自动回滚',
    fetch_subscription: '拉取订阅',
    configure_feed: '配置官方软件源',
    update_feeds: '更新软件索引',
    switch_variant: '切换核心版本',
    install_packages: '安装核心包',
    verify_core: '校验核心',
    remove_luci: '卸载旧版 LuCI'
  };
  return map[step] || step;
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
