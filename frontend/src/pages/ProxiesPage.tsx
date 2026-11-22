import { useCallback, useMemo, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { usePolling } from '../hooks/usePolling';
import { StateView } from '../components/StateView';
import { delayColorClass } from '../utils/format';
import type { ProxyNode } from '../api/types';

function getLastDelay(node?: ProxyNode): number | null {
  if (!node?.history || node.history.length === 0) return null;
  const last = node.history[node.history.length - 1];
  return typeof last?.delay === 'number' ? last.delay : null;
}

export function ProxiesPage(props: {
  running: boolean;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [proxies, setProxies] = useState<Record<string, ProxyNode>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'delay' | 'name'>('default');
  const [hideDead, setHideDead] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);
  const [testUrl, setTestUrl] = useState('https://www.gstatic.com/generate_204');

  const fetcher = useCallback((signal: AbortSignal) => nikkiApi.getProxies({ signal }), []);

  const { refresh } = usePolling(
    fetcher,
    (data) => {
      setProxies(data.proxies || {});
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
    // Put GLOBAL at the end, Selector groups first
    entries.sort((a, b) => {
      if (a.name === 'GLOBAL') return 1;
      if (b.name === 'GLOBAL') return -1;
      if (a.type === 'Selector' && b.type !== 'Selector') return -1;
      if (a.type !== 'Selector' && b.type === 'Selector') return 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }, [proxies]);

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
      const delay = Number((r.result as { delay?: number })?.delay ?? 0);
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
      props.notify('info', `${nodeName}: ${delay > 0 ? `${delay} ms` : '超时'}`);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setTestingKey(null);
    }
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
          <h2 class="page-title">代理策略组</h2>
          <p class="page-desc">切换策略组节点、单节点或整组延迟测试，支持嵌套策略组展示</p>
        </div>
        <div class="row">
          <button class="btn" onClick={refresh}>
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
          const isSelectable = group.type === 'Selector' || group.type === 'Fallback' || group.type === 'URLTest';

          return (
            <div key={group.name} class="card">
              <div class="card-header">
                <div class="row" style={{ cursor: 'pointer' }} onClick={() => setCollapsed((c) => ({ ...c, [group.name]: !c[group.name] }))}>
                  <h3 class="card-title">{group.name}</h3>
                  <span class="badge badge-purple">{group.type}</span>
                  <span class="badge badge-accent">当前: {group.now || '-'}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    ({filtered.length}/{rawNodes.length})
                  </span>
                </div>
                <div class="row">
                  <button
                    class="btn btn-sm"
                    disabled={testingKey !== null}
                    onClick={() => handleTestGroup(group.name)}
                  >
                    {testingKey === `group:${group.name}` ? '测速中...' : '整组测速'}
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
                        role="button"
                        tabIndex={0}
                        class={`node-card ${selected ? 'selected' : ''}`}
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
                          {isNested && <span class="badge badge-purple">嵌套</span>}
                        </div>
                        <div class="node-meta">
                          <span>
                            {node?.type || 'Proxy'}
                            {isNested && node?.now ? ` → ${node.now}` : ''}
                          </span>
                          <button
                            type="button"
                            class={`badge ${delay === null ? '' : delayColorClass(delay)}`}
                            style={{ border: 0, cursor: 'pointer' }}
                            disabled={testingKey !== null}
                            onClick={(e) => handleTestNode(e, nodeName)}
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
