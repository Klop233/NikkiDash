import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { usePolling } from '../hooks/usePolling';
import { StateView } from '../components/StateView';
import { IconBolt, IconCheck, IconSearch } from '../components/Icons';
import { delayColorClass, formatBytes, formatTimeAgo } from '../utils/format';
import type { ProxyMode, ProxyNode, ProxyProvider } from '../api/types';

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

const SELECTED_GROUP_KEY = 'nikki_dash_proxy_group';

function delayText(delay: number | null): string {
  if (delay === null) return '—';
  return delay > 0 ? `${delay} ms` : '超时';
}

export function ProxiesPage(props: {
  running: boolean;
  mode?: ProxyMode;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [proxies, setProxies] = useState<Record<string, ProxyNode>>({});
  const [providers, setProviders] = useState<Record<string, ProxyProvider>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'delay' | 'name'>('default');
  const [hideDead, setHideDead] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string>(() => {
    try {
      return localStorage.getItem(SELECTED_GROUP_KEY) || '';
    } catch {
      return '';
    }
  });
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

  const fetcher = useCallback((signal: AbortSignal) => nikkiApi.getProxies({ signal, timeoutMs: 20000 }), []);

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
    { intervalMs: 15000, enabled: props.running }
  );

  // Groups follow the exact order of `proxy-groups` in the profile: Mihomo lists them in GLOBAL.all.
  const groups = useMemo(() => {
    const isGroup = (p?: ProxyNode) => !!p && Array.isArray(p.all) && p.all.length > 0;
    const globalNode = proxies['GLOBAL'];
    const ordered: ProxyNode[] = [];
    const seen = new Set<string>();

    for (const name of globalNode?.all || []) {
      const p = proxies[name];
      if (isGroup(p) && !seen.has(name) && !(p as ProxyNode & { hidden?: boolean }).hidden) {
        ordered.push(p);
        seen.add(name);
      }
    }
    for (const p of Object.values(proxies)) {
      if (isGroup(p) && p.name !== 'GLOBAL' && !seen.has(p.name) && !(p as ProxyNode & { hidden?: boolean }).hidden) {
        ordered.push(p);
        seen.add(p.name);
      }
    }
    if (props.mode === 'global' && isGroup(globalNode)) {
      return [globalNode, ...ordered];
    }
    return ordered;
  }, [proxies, props.mode]);

  const providerList = useMemo(
    () => Object.values(providers).filter((p) => p.vehicleType !== 'Compatible'),
    [providers]
  );

  const current = groups.find((g) => g.name === activeGroup) ?? groups[0];

  const chooseGroup = (name: string) => {
    setActiveGroup(name);
    try {
      localStorage.setItem(SELECTED_GROUP_KEY, name);
    } catch {
      // ignore
    }
  };

  const handleSelect = async (group: string, nodeName: string) => {
    const key = `${group}::${nodeName}`;
    if (selectingKey) return;
    const prevNow = proxies[group]?.now;
    setSelectingKey(key);
    // Optimistic update for instant FlClash-like feedback
    setProxies((prev) => ({ ...prev, [group]: { ...prev[group], now: nodeName } }));
    try {
      await nikkiApi.selectProxy(group, nodeName);
      props.notify('success', `${group} → ${nodeName}`);
    } catch (err) {
      setProxies((prev) => ({ ...prev, [group]: { ...prev[group], now: prevNow } }));
      props.notify('error', `切换失败：${(err as Error).message}`);
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
    const push = (delay: number) =>
      setProxies((prev) => {
        const cur = prev[nodeName];
        if (!cur) return prev;
        return {
          ...prev,
          [nodeName]: { ...cur, history: [...(cur.history || []), { time: new Date().toISOString(), delay }] }
        };
      });
    try {
      const r = await nikkiApi.testDelay('proxy', nodeName, testUrl, 5000);
      const resObj = r.result as { delay?: number; timeout?: boolean } | undefined;
      const delay = resObj?.timeout ? 0 : Number(resObj?.delay ?? 0);
      push(delay);
    } catch (err) {
      push(0);
      props.notify('error', `${nodeName} 测速失败：${(err as Error).message}`);
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

  if (!props.running) {
    return <StateView kind="empty" title="Nikki 未运行" message="请先在顶部或总览页启动 Nikki 服务，再管理策略组与节点。" />;
  }
  if (loading && groups.length === 0) {
    return <StateView kind="loading" title="正在加载策略组" message="正在从 Mihomo 控制器读取节点与延迟信息" />;
  }
  if (error && groups.length === 0) {
    return <StateView kind="error" title="无法加载策略组" message={error} actionLabel="重试" onAction={refresh} />;
  }
  if (groups.length === 0 || !current) {
    return <StateView kind="empty" title="未找到策略组" message="当前配置可能未定义 proxy-groups。" />;
  }

  const q = search.trim().toLowerCase();
  const rawNodes = current.all || [];
  let nodes = rawNodes.filter((n) => {
    if (q && !n.toLowerCase().includes(q)) return false;
    if (hideDead) {
      const d = getLastDelay(proxies[n]);
      if (d !== null && d <= 0) return false;
    }
    return true;
  });
  if (sortBy === 'name') {
    nodes = [...nodes].sort((a, b) => a.localeCompare(b));
  } else if (sortBy === 'delay') {
    nodes = [...nodes].sort((a, b) => {
      const da = getLastDelay(proxies[a]);
      const db = getLastDelay(proxies[b]);
      return (da && da > 0 ? da : 999999) - (db && db > 0 ? db : 999999);
    });
  }
  const isSelectable = current.type === 'Selector';
  const testingGroup = testingKey === `group:${current.name}`;

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">代理</h1>
          <p class="page-desc">
            策略组按配置文件顺序排列；点击节点即可切换，自动测速与故障转移组由 Mihomo 自动选择
          </p>
        </div>
        <div class="row" style={{ gap: '12px' }}>
          <button type="button" class="btn" onClick={() => void refresh()}>
            刷新
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={testingKey !== null}
            onClick={() => void handleTestGroup(current.name)}
          >
            {testingGroup ? (
              <>
                <span class="spinner" /> 测速中...
              </>
            ) : (
              <>
                <IconBolt />
                测试当前组延迟
              </>
            )}
          </button>
        </div>
      </div>

      {/* Group tabs in profile order */}
      <div class="group-tabs" role="tablist" aria-label="策略组">
        {groups.map((g) => (
          <button
            key={g.name}
            type="button"
            role="tab"
            aria-selected={g.name === current.name}
            class={`group-tab ${g.name === current.name ? 'active' : ''}`}
            onClick={() => chooseGroup(g.name)}
            title={`${g.name}（${GROUP_TYPE_LABEL[g.type] || g.type}）`}
          >
            <span class="group-tab-name">{g.name}</span>
            <span class="group-tab-now">{g.now || '—'}</span>
          </button>
        ))}
      </div>

      <section class="card-flush" aria-label={`${current.name} 节点列表`}>
        <div class="card-toolbar" style={{ justifyContent: 'space-between' }}>
          <div class="row" style={{ gap: '12px' }}>
            <h2 class="card-title">{current.name}</h2>
            <span class="badge">{GROUP_TYPE_LABEL[current.type] || current.type}</span>
            <span class="badge badge-accent">当前：{current.now || '—'}</span>
            <span class="mono" style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
              {nodes.length} / {rawNodes.length}
            </span>
          </div>
          <div class="row" style={{ gap: '12px' }}>
            <label class="search-box" style={{ maxWidth: '220px' }}>
              <IconSearch />
              <input
                type="search"
                aria-label="搜索节点"
                placeholder="搜索节点"
                value={search}
                onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <select
              class="select"
              aria-label="排序方式"
              style={{ width: '150px' }}
              value={sortBy}
              onChange={(e) => setSortBy((e.currentTarget as HTMLSelectElement).value as 'default' | 'delay' | 'name')}
            >
              <option value="default">按配置顺序</option>
              <option value="delay">按延迟升序</option>
              <option value="name">按名称排序</option>
            </select>
            <label class="check-row">
              <input
                type="checkbox"
                checked={hideDead}
                onChange={(e) => setHideDead((e.currentTarget as HTMLInputElement).checked)}
              />
              <span>隐藏超时</span>
            </label>
          </div>
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          {nodes.length === 0 ? (
            <p style={{ margin: 0, padding: '24px 0', textAlign: 'center', fontSize: '16px', color: 'var(--text-muted)' }}>
              {q ? `没有找到「${search}」相关的节点` : '该策略组没有可显示的节点'}
            </p>
          ) : (
            <div class="node-grid">
              {nodes.map((nodeName) => {
                const node = proxies[nodeName];
                const delay = getLastDelay(node);
                const selected = current.now === nodeName;
                const isNested = Array.isArray(node?.all) && node.all.length > 0;
                const isBusy = selectingKey === `${current.name}::${nodeName}`;
                const nodeTesting = testingGroup || testingKey === `node:${nodeName}`;

                return (
                  <div
                    key={nodeName}
                    role={isSelectable ? 'button' : undefined}
                    tabIndex={isSelectable ? 0 : undefined}
                    aria-pressed={isSelectable ? selected : undefined}
                    title={
                      isSelectable ? `点击切换到 ${nodeName}` : `${current.type} 策略组由 Mihomo 自动选择，不支持手动切换`
                    }
                    class={`node-card ${selected ? 'selected' : ''} ${isSelectable ? '' : 'readonly-node'}`}
                    onClick={() => {
                      if (isSelectable && !isBusy) void handleSelect(current.name, nodeName);
                    }}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && isSelectable && !isBusy) {
                        e.preventDefault();
                        void handleSelect(current.name, nodeName);
                      }
                    }}
                  >
                    <div class="row-between" style={{ width: '100%', flexWrap: 'nowrap' }}>
                      <span class="node-name" title={nodeName}>
                        {nodeName}
                      </span>
                      {selected && (
                        <span class="node-check" aria-label="当前选中">
                          <IconCheck />
                        </span>
                      )}
                    </div>
                    <div class="node-meta">
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {node?.type || 'Proxy'}
                        {isNested && node?.now ? ` → ${node.now}` : ''}
                        {node?.udp ? ' · UDP' : ''}
                      </span>
                      <button
                        type="button"
                        class={`delay-btn mono ${delay === null ? '' : delayColorClass(delay)}`}
                        disabled={testingKey !== null}
                        onClick={(e) => void handleTestNode(e, nodeName)}
                        title="点击单节点测速"
                      >
                        {nodeTesting ? <span class="spinner" /> : delayText(delay)}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <div class="card" style={{ marginTop: '24px' }}>
        <div class="row-between" style={{ marginBottom: '12px' }}>
          <h2 class="card-title">测速设置</h2>
        </div>
        <div class="field" style={{ maxWidth: '480px' }}>
          <label class="field-label">测速 URL</label>
          <input
            class="input mono"
            aria-label="测速 URL"
            value={testUrl}
            onInput={(e) => setTestUrl((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
      </div>

      {providerList.length > 0 && (
        <div class="card" style={{ marginTop: '24px' }}>
          <div class="card-header">
            <h2 class="card-title">订阅与代理集合 ({providerList.length})</h2>
          </div>
          <div class="grid-3">
            {providerList.map((prov) => {
              const info = prov.subscriptionInfo;
              const used = info ? (info.Upload || 0) + (info.Download || 0) : 0;
              const total = info?.Total || 0;
              const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null;
              return (
                <div key={prov.name} class="sub-card">
                  <div class="row-between">
                    <span style={{ fontWeight: 500 }}>{prov.name}</span>
                    <button
                      type="button"
                      class="btn btn-sm"
                      disabled={updatingProv !== null}
                      onClick={() => void handleUpdateProvider(prov.name)}
                    >
                      {updatingProv === prov.name ? '更新中...' : '更新'}
                    </button>
                  </div>
                  <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    <span class="mono">{prov.count ?? prov.proxies?.length ?? 0}</span> 节点 · 更新于{' '}
                    {formatTimeAgo(prov.updatedAt)}
                  </div>
                  {pct !== null && (
                    <div style={{ marginTop: '12px' }}>
                      <div class="row-between mono" style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '6px' }}>
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
    </div>
  );
}
