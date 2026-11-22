import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { usePolling } from '../hooks/usePolling';
import { StateView } from '../components/StateView';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatBytes, formatHostPort, formatTimeAgo } from '../utils/format';
import type { ConnectionItem } from '../api/types';

const PAGE_SIZE = 50;

export function ConnectionsPage(props: {
  running: boolean;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [conns, setConns] = useState<ConnectionItem[]>([]);
  const [speeds, setSpeeds] = useState<Record<string, { down: number; up: number }>>({});
  const [totals, setTotals] = useState({ up: 0, down: 0, mem: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState('');
  const [netFilter, setNetFilter] = useState<'all' | 'tcp' | 'udp'>('all');
  const [sortBy, setSortBy] = useState<'time' | 'download' | 'upload' | 'speed' | 'host'>('time');
  const [page, setPage] = useState(1);
  const [detailConn, setDetailConn] = useState<ConnectionItem | null>(null);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const [closingAll, setClosingAll] = useState(false);

  const prevSnapRef = useRef<{ ts: number; map: Map<string, { up: number; down: number }> }>({
    ts: 0,
    map: new Map()
  });

  useEffect(() => {
    if (!detailConn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailConn(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailConn]);

  const fetcher = useCallback((signal: AbortSignal) => nikkiApi.getConnections({ signal, timeoutMs: 8000 }), []);

  const { refresh } = usePolling(
    fetcher,
    (data) => {
      const list = data.connections || [];
      const now = Date.now();
      const dt = prevSnapRef.current.ts > 0 ? Math.max(0.5, (now - prevSnapRef.current.ts) / 1000) : 0;
      const nextSpeeds: Record<string, { down: number; up: number }> = {};
      const nextMap = new Map<string, { up: number; down: number }>();

      for (const c of list) {
        nextMap.set(c.id, { up: c.upload, down: c.download });
        const prev = prevSnapRef.current.map.get(c.id);
        if (prev && dt > 0) {
          nextSpeeds[c.id] = {
            down: Math.max(0, (c.download - prev.down) / dt),
            up: Math.max(0, (c.upload - prev.up) / dt)
          };
        }
      }
      prevSnapRef.current = { ts: now, map: nextMap };

      setConns(list);
      setSpeeds(nextSpeeds);
      setTotals({ up: data.upload_total, down: data.download_total, mem: data.memory });
      setLoading(false);
      setError(null);
    },
    (err) => {
      setError((err as Error)?.message || '读取连接失败');
      setLoading(false);
    },
    { intervalMs: 2500, enabled: props.running && !paused }
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = conns.filter((c) => {
      if (netFilter !== 'all' && (c.metadata?.network || '').toLowerCase() !== netFilter) return false;
      if (!q) return true;
      const target = `${c.metadata?.host || ''} ${c.metadata?.destinationIP || ''} ${c.metadata?.sourceIP || ''} ${c.metadata?.process || ''} ${c.rule || ''} ${c.rulePayload || ''} ${(c.chains || []).join(' ')}`.toLowerCase();
      return target.includes(q);
    });

    list.sort((a, b) => {
      if (sortBy === 'download') return b.download - a.download;
      if (sortBy === 'upload') return b.upload - a.upload;
      if (sortBy === 'speed') {
        const sa = (speeds[a.id]?.down || 0) + (speeds[a.id]?.up || 0);
        const sb = (speeds[b.id]?.down || 0) + (speeds[b.id]?.up || 0);
        return sb - sa;
      }
      if (sortBy === 'host') {
        return (a.metadata?.host || a.metadata?.destinationIP || '').localeCompare(
          b.metadata?.host || b.metadata?.destinationIP || ''
        );
      }
      return Date.parse(b.start) - Date.parse(a.start);
    });
    return list;
  }, [conns, speeds, search, netFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleCloseOne = async (id: string, e?: Event) => {
    e?.stopPropagation();
    try {
      await nikkiApi.closeConnection(id);
      setConns((prev) => prev.filter((c) => c.id !== id));
      if (detailConn?.id === id) setDetailConn(null);
      props.notify('info', '已断开连接');
    } catch (err) {
      props.notify('error', (err as Error).message);
    }
  };

  const handleCloseAll = async () => {
    setClosingAll(true);
    try {
      await nikkiApi.closeAllConnections();
      setConns([]);
      setDetailConn(null);
      setConfirmCloseAll(false);
      props.notify('success', '已关闭全部活跃连接');
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setClosingAll(false);
    }
  };

  if (!props.running) {
    return <StateView kind="empty" title="Nikki 未运行" message="启动 Nikki 后将实时展示路由器连接表。" />;
  }
  if (loading && conns.length === 0) {
    return <StateView kind="loading" title="正在加载活跃连接..." />;
  }
  if (error && conns.length === 0) {
    return <StateView kind="error" title="无法读取连接" message={error} actionLabel="重试" onAction={refresh} />;
  }

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">活跃连接 ({filtered.length})</h2>
          <p class="page-desc">
            累计下行 {formatBytes(totals.down)} · 累计上行 {formatBytes(totals.up)} · 内存 {formatBytes(totals.mem)} · 点击任意行查看详情
          </p>
        </div>
        <div class="row">
          <button class={`btn ${paused ? 'btn-primary' : ''}`} onClick={() => setPaused((p) => !p)}>
            {paused ? '继续刷新' : '暂停刷新'}
          </button>
          <button class="btn btn-danger" onClick={() => setConfirmCloseAll(true)} disabled={conns.length === 0}>
            关闭全部连接
          </button>
        </div>
      </div>

      <div class="card" style={{ marginBottom: '14px' }}>
        <div class="row">
          <input
            class="input"
            style={{ maxWidth: '300px' }}
            placeholder="搜索域名 / IP / 进程 / 规则 / 链路..."
            value={search}
            onInput={(e) => {
              setSearch((e.currentTarget as HTMLInputElement).value);
              setPage(1);
            }}
          />
          <select
            class="select"
            style={{ maxWidth: '130px' }}
            value={netFilter}
            onChange={(e) => {
              setNetFilter((e.currentTarget as HTMLSelectElement).value as 'all' | 'tcp' | 'udp');
              setPage(1);
            }}
          >
            <option value="all">全部协议</option>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
          <select
            class="select"
            style={{ maxWidth: '150px' }}
            value={sortBy}
            onChange={(e) =>
              setSortBy((e.currentTarget as HTMLSelectElement).value as 'time' | 'download' | 'upload' | 'speed' | 'host')
            }
          >
            <option value="time">最新建立</option>
            <option value="speed">按实时速率</option>
            <option value="download">按下载量</option>
            <option value="upload">按上传量</option>
            <option value="host">按目标域名</option>
          </select>
          {search && (
            <button class="btn btn-sm btn-ghost" onClick={() => setSearch('')}>
              清除
            </button>
          )}
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>目标</th>
                <th>来源</th>
                <th>协议</th>
                <th>规则</th>
                <th>代理链</th>
                <th>流量 / 速率</th>
                <th>建立时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>
                    没有匹配的连接记录
                  </td>
                </tr>
              ) : (
                pageItems.map((c) => {
                  const dest = c.metadata?.host
                    ? formatHostPort(c.metadata.host, c.metadata.destinationPort)
                    : formatHostPort(c.metadata?.destinationIP, c.metadata?.destinationPort);
                  const src = formatHostPort(c.metadata?.sourceIP, c.metadata?.sourcePort);
                  const sp = speeds[c.id];
                  return (
                    <tr key={c.id} class="clickable-row" onClick={() => setDetailConn(c)}>
                      <td class="mono" style={{ maxWidth: '260px', wordBreak: 'break-all' }}>
                        {dest}
                      </td>
                      <td class="mono" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {src}
                      </td>
                      <td>
                        <span class="badge">{(c.metadata?.network || '-').toUpperCase()}</span>
                      </td>
                      <td style={{ fontSize: '12px' }}>
                        {c.rule}
                        {c.rulePayload ? `(${c.rulePayload})` : ''}
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--accent)' }}>
                        {[...(c.chains || [])].reverse().join(' → ')}
                      </td>
                      <td class="mono" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                        <div>
                          ↓ {formatBytes(c.download)} / ↑ {formatBytes(c.upload)}
                        </div>
                        {sp && (sp.down > 0 || sp.up > 0) && (
                          <div style={{ fontSize: '11px', color: 'var(--green)' }}>
                            ↓ {formatBytes(sp.down, true)} · ↑ {formatBytes(sp.up, true)}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {formatTimeAgo(c.start)}
                      </td>
                      <td>
                        <button class="btn btn-sm btn-danger" onClick={(e) => void handleCloseOne(c.id, e)}>
                          断开
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div class="row-between" style={{ marginTop: '14px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              第 {safePage} / {totalPages} 页（共 {filtered.length} 条）
            </span>
            <div class="row">
              <button class="btn btn-sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                上一页
              </button>
              <button class="btn btn-sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Connection Detail Modal */}
      {detailConn && (
        <div
          class="modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailConn(null);
          }}
        >
          <div class="modal-card" style={{ maxWidth: '540px' }}>
            <div class="row-between" style={{ marginBottom: '12px' }}>
              <h3 style={{ margin: 0 }}>连接详情</h3>
              <span class="badge mono">{(detailConn.metadata?.network || '-').toUpperCase()}</span>
            </div>
            <div class="kv-grid">
              <div class="kv-key">连接 ID</div>
              <div class="kv-val mono">{detailConn.id}</div>
              <div class="kv-key">目标域名</div>
              <div class="kv-val mono">{detailConn.metadata?.host || '-'}</div>
              <div class="kv-key">目标地址</div>
              <div class="kv-val mono">
                {formatHostPort(detailConn.metadata?.destinationIP, detailConn.metadata?.destinationPort)}
              </div>
              <div class="kv-key">来源地址</div>
              <div class="kv-val mono">
                {formatHostPort(detailConn.metadata?.sourceIP, detailConn.metadata?.sourcePort)}
              </div>
              <div class="kv-key">入站类型</div>
              <div class="kv-val">{detailConn.metadata?.type || '-'}</div>
              <div class="kv-key">DNS 模式</div>
              <div class="kv-val">{detailConn.metadata?.dnsMode || '-'}</div>
              <div class="kv-key">进程名</div>
              <div class="kv-val mono">{detailConn.metadata?.process || '-'}</div>
              <div class="kv-key">匹配规则</div>
              <div class="kv-val mono">
                {detailConn.rule}
                {detailConn.rulePayload ? ` (${detailConn.rulePayload})` : ''}
              </div>
              <div class="kv-key">代理链路</div>
              <div class="kv-val" style={{ color: 'var(--accent)' }}>
                {[...(detailConn.chains || [])].reverse().join(' → ')}
              </div>
              <div class="kv-key">流量统计</div>
              <div class="kv-val mono">
                下行 {formatBytes(detailConn.download)} · 上行 {formatBytes(detailConn.upload)}
              </div>
              <div class="kv-key">建立时间</div>
              <div class="kv-val">{detailConn.start}</div>
            </div>
            <div class="modal-actions">
              {(detailConn.metadata?.host || detailConn.metadata?.destinationIP) && (
                <button
                  class="btn"
                  onClick={() => {
                    const target = detailConn.metadata?.host || detailConn.metadata?.destinationIP || '';
                    void navigator.clipboard?.writeText(target);
                    props.notify('success', `已复制 ${target}`);
                  }}
                >
                  复制目标
                </button>
              )}
              <button class="btn btn-danger" onClick={() => void handleCloseOne(detailConn.id)}>
                断开此连接
              </button>
              <button class="btn btn-primary" onClick={() => setDetailConn(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmCloseAll}
        title="关闭全部活跃连接？"
        message="这会立即断开当前所有通过 Mihomo 的活跃连接（客户端通常会自动重连）。"
        danger
        busy={closingAll}
        confirmLabel="确认关闭全部"
        onConfirm={handleCloseAll}
        onCancel={() => setConfirmCloseAll(false)}
      />
    </div>
  );
}
