import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { usePolling } from '../hooks/usePolling';
import { StateView } from '../components/StateView';
import { delayColorClass, formatBytes, formatTimeAgo } from '../utils/format';
import type { ProxyNode, ProxyProvider } from '../api/types';

function getLastDelay(node?: ProxyNode): number | null {
  if (!node?.history || node.history.length === 0) return null;
  const last = node.history[node.history.length - 1];
  return typeof last?.delay === 'number' ? last.delay : null;
}

const GROUP_TYPE_LABEL: Record<string, string> = {
  Selector: '手动选择',
  URLTest: '自动测速',
  Fallback: '故障转移',
  LoadBalance: '负载均衡',
  Relay: '链式代理'
};

export function ProxiesPage(props: {
  running: boolean;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [proxies, setProxies] = useState<Record<string, ProxyNode>>({});
  const [providers, setProviders] = useState<Record<string, ProxyProvider>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'delay' | 'name'>('default');
  const [hideDead, setHideDead] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);
  const [updatingProv, setUpdatingProv] = useState<string | null>(null);
  const [testUrl, setTestUrl] = useState('https://www.gstatic.com/generate_204');

  useEffect(() => {
    if (props.running) {
      setError(null);
      if (Object.keys(proxies).length === 0) setLoading(true);
    }
  }, [props.running]);

  const fetcher = useCallback((signal: AbortSignal) => nikkiApi.getProxies({ signal }), []);

  const { refresh } = usePolling(
    fetcher,
    (data) => {
      setProxies(data.proxies || {});
      setProviders(data.providers || {});
      setLoading(false);
      setError(null);
    },
    (err) => {
      setError((err as Error)?.message || '读取代理列表失败');
      setLoading(false);
    },
    { intervalMs: 10000, enabled: props.running }
  );

  const groups = useMemo(() => {
    const entries = Object.values(proxies).filter((p) => Array.isArray(p.all) && p.all.length > 0);
    entries.sort((a, b) => {
      if (a.name === 'GLOBAL') return 1;
      if (b.name === 'GLOBAL') return -1;
      if (a.type === 'Selector' && b.type !== 'Selector') return -1;
      if (a.type !== 'Selector' && b.type === 'Selector') return 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }, [proxies]);

  const providerList = useMemo(
    () => Object.values(providers).filter((p) => p.vehicleType !== 'Compatible'),
    [providers]
  );

  const handleSelect = async (group: string, nodeName: string) => {
    const key = `${group}::${nodeName}`;
    if (selectingKey) return;
    setSelectingKey(key);
    try {
      await nikkiApi.selectProxy(group, nodeName);
      setProxies((prev) => ({
        ...prev,
        [group]: { ...prev[group], now: nodeName }
      }));
      props.notify('success', `${group} → ${nodeName}`);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setSelectingKey(null);
    }
  };

  const handleTestGroup = async (groupName: string) => {
    if (testingKey) return;
    setTestingKey(`group:${groupName}`);
    try {
      await nikkiApi.testDelay('group', groupName, testUrl, 5000);
      await refresh();
      props.notify('success', `策略组 ${groupName} 测速完成`);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setTestingKey(null);
    }
  };

  const handleTestNode = async (e: Event, nodeName: string) => {
    e.stopPropagation();
    if (testingKey) return;
    setTestingKey(`node:${nodeName}`);
    try {
      const r = await nikkiApi.testDelay('proxy', nodeName, testUrl, 5000);
      const resObj = r.result as { delay?: number; timeout?: boolean } | undefined;
      const delay = resObj?.timeout ? 0 : Number(resObj?.delay ?? 0);
      setProxies((prev) => {
        const cur = prev[nodeName];
        if (!cur) return prev;
        return {
          ...prev,
          [nodeName]: {
            ...cur,
            history: [...(cur.history || []), { time: new Date().toISOString(), delay }]
          }
        };
      });
      props.notify(delay > 0 ? 'info' : 'error', `${nodeName}: ${delay > 0 ? `${delay} ms` : '连接超时'}`);
    } catch (err) {
      setProxies((prev) => {
        const cur = prev[nodeName];
        if (!cur) return prev;
        return {
          ...prev,
          [nodeName]: {
            ...cur,
            history: [...(cur.history || []), { time: new Date().toISOString(), delay: 0 }]
          }
        };
      });
      props.notify('error', `${nodeName} 测速失败: ${(err as Error).message}`);
    } finally {
      setTestingKey(null);
    }
  };

  const handleUpdateProvider = async (name: string) => {
    setUpdatingProv(name);
    try {
      await nikkiApi.updateProvider('proxy', name);
      await refresh();
      props.notify('success', `代理集合 ${name} 已更新`);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setUpdatingProv(null);
    }
  };

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed[g.name] === true);
  const toggleAllCollapsed = () => {
    const next: Record<string, boolean> = {};
    for (const g of groups) next[g.name] = !allCollapsed;
    setCollapsed(next);
  };

  if (!props.running) {
    return <StateView kind="empty" title="Nikki 未运行" message="请先在顶部或总览页启动 Nikki 服务，再管理策略组与节点。" />;
  }
  if (loading && groups.length === 0) {
    return <StateView kind="loading" title="正在加载策略组..." />;
  }
  if (error && groups.length === 0) {
    return <StateView kind="error" title="无法加载策略组" message={error} actionLabel="重试" onAction={refresh} />;
  }

  const q = search.trim().toLowerCase();

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">代理策略组 ({groups.length})</h2>
          <p class="page-desc">切换手动策略组节点、单节点或整组延迟测速；自动测速 / 故障转移组由 Mihomo 自动维护</p>
        </div>
        <div class="row">
          {groups.length > 1 && (
            <button class="btn" onClick={toggleAllCollapsed}>
              {allCollapsed ? '展开全部' : '折叠全部'}
            </button>
          )}
          <button class="btn" onClick={() => void refresh()}>
            刷新列表
          </button>
        </div>
      </div>

      <div class="card" style={{ marginBottom: '14px' }}>
        <div class="row" style={{ gap: '10px' }}>
          <input
            class="input"
            style={{ maxWidth: '260px' }}
            placeholder="搜索节点或策略组..."
            value={search}
            onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
          />
          <select
            class="select"
            style={{ maxWidth: '170px' }}
            value={sortBy}
            onChange={(e) => setSortBy((e.currentTarget as HTMLSelectElement).value as 'default' | 'delay' | 'name')}
          >
            <option value="default">按配置顺序</option>
            <option value="delay">按延迟升序</option>
            <option value="name">按名称排序</option>
          </select>
          <input
            class="input"
            style={{ maxWidth: '300px' }}
            placeholder="测速 URL"
            value={testUrl}
            onInput={(e) => setTestUrl((e.currentTarget as HTMLInputElement).value)}
          />
          <label class="row" style={{ cursor: 'pointer', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={hideDead}
              onChange={(e) => setHideDead((e.currentTarget as HTMLInputElement).checked)}
            />
            <span>隐藏超时节点</span>
          </label>
        </div>
      </div>

      {providerList.length > 0 && (
        <div class="card" style={{ marginBottom: '14px' }}>
          <div class="card-header">
            <h3 class="card-title">代理集合 (Proxy Providers) ({providerList.length})</h3>
          </div>
          <div class="grid-3">
            {providerList.map((prov) => {
              const info = prov.subscriptionInfo;
              const used = info ? (info.Upload || 0) + (info.Download || 0) : 0;
              const total = info?.Total || 0;
              const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null;
              return (
                <div
                  key={prov.name}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px',
                    background: 'var(--surface-2)'
                  }}
                >
                  <div class="row-between">
                    <strong>{prov.name}</strong>
                    <button
                      class="btn btn-sm"
                      disabled={updatingProv !== null}
                      onClick={() => void handleUpdateProvider(prov.name)}
                    >
                      {updatingProv === prov.name ? '更新中...' : '更新'}
                    </button>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                    {prov.proxies?.length ?? 0} 节点 · 更新于 {formatTimeAgo(prov.updatedAt)}
                  </div>
                  {pct !== null && (
                    <div style={{ marginTop: '8px' }}>
                      <div class="row-between" style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        <span>
                          {formatBytes(used)} / {formatBytes(total)}
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div class="progress-bar">
                        <div class="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <StateView kind="empty" title="未找到策略组" message="当前配置可能未定义 proxy-groups。" />
      ) : (
        groups.map((group) => {
          const rawNodes = group.all || [];
          let filtered = rawNodes.filter((n) => {
            if (q && !n.toLowerCase().includes(q) && !group.name.toLowerCase().includes(q)) return false;
            if (hideDead) {
              const d = getLastDelay(proxies[n]);
              if (d !== null && d <= 0) return false;
            }
            return true;
          });

          if (sortBy === 'name') {
            filtered = [...filtered].sort((a, b) => a.localeCompare(b));
          } else if (sortBy === 'delay') {
            filtered = [...filtered].sort((a, b) => {
              const da = getLastDelay(proxies[a]);
              const db = getLastDelay(proxies[b]);
              const va = da && da > 0 ? da : 999999;
              const vb = db && db > 0 ? db : 999999;
              return va - vb;
            });
          }

          const isCollapsed = collapsed[group.name] === true;
          // In Mihomo, ONLY Selector groups accept manual PUT /proxies/<group> selection
          const isSelectable = group.type === 'Selector';

          return (
            <div key={group.name} class="card">
              <div class="card-header">
                <div
                  class="row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setCollapsed((c) => ({ ...c, [group.name]: !c[group.name] }))}
                >
                  <h3 class="card-title">{group.name}</h3>
                  <span class="badge badge-purple">{GROUP_TYPE_LABEL[group.type] || group.type}</span>
                  <span class="badge badge-accent">当前: {group.now || '-'}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    ({filtered.length}/{rawNodes.length})
                  </span>
                </div>
                <div class="row">
                  <button
                    class="btn btn-sm"
                    disabled={testingKey !== null}
                    onClick={() => void handleTestGroup(group.name)}
                  >
                    {testingKey === `group:${group.name}` ? (
                      <>
                        <span class="spinner" style={{ width: '11px', height: '11px' }} /> 测速中...
                      </>
                    ) : (
                      '整组测速'
                    )}
                  </button>
                  <button
                    class="btn btn-sm btn-ghost"
                    onClick={() => setCollapsed((c) => ({ ...c, [group.name]: !c[group.name] }))}
                  >
                    {isCollapsed ? '展开' : '折叠'}
                  </button>
                </div>
              </div>

              {!isCollapsed && (
                <div class="node-grid">
                  {filtered.map((nodeName) => {
                    const node = proxies[nodeName];
                    const delay = getLastDelay(node);
                    const selected = group.now === nodeName;
                    const isNested = Array.isArray(node?.all) && node.all.length > 0;
                    const isBusy = selectingKey === `${group.name}::${nodeName}`;

                    return (
                      <div
                        key={nodeName}
                        role={isSelectable ? 'button' : undefined}
                        tabIndex={isSelectable ? 0 : undefined}
                        title={
                          isSelectable
                            ? `点击切换到 ${nodeName}`
                            : `${group.type} 策略组由 Mihomo 自动选择，不支持手动切换`
                        }
                        class={`node-card ${selected ? 'selected' : ''} ${isSelectable ? '' : 'readonly-node'}`}
                        onClick={() => {
                          if (isSelectable && !isBusy) void handleSelect(group.name, nodeName);
                        }}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && isSelectable && !isBusy) {
                            e.preventDefault();
                            void handleSelect(group.name, nodeName);
                          }
                        }}
                      >
                        <div class="row-between" style={{ width: '100%' }}>
                          <span class="node-name" title={nodeName}>
                            {nodeName}
                          </span>
                          <div class="row" style={{ gap: '4px' }}>
                            {node?.udp && <span class="badge" style={{ padding: '1px 6px', fontSize: '10px' }}>UDP</span>}
                            {isNested && <span class="badge badge-purple" style={{ padding: '1px 6px', fontSize: '10px' }}>策略组</span>}
                          </div>
                        </div>
                        <div class="node-meta">
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {node?.type || 'Proxy'}
                            {isNested && node?.now ? ` → ${node.now}` : ''}
                          </span>
                          <button
                            type="button"
                            class={`badge ${delay === null ? '' : delayColorClass(delay)}`}
                            style={{ border: 0, cursor: 'pointer', flexShrink: 0 }}
                            disabled={testingKey !== null}
                            onClick={(e) => void handleTestNode(e, nodeName)}
                            title="点击单节点测速"
                          >
                            {testingKey === `node:${nodeName}`
                              ? '...'
                              : delay === null
                                ? '测速'
                                : delay > 0
                                  ? `${delay} ms`
                                  : '超时'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
