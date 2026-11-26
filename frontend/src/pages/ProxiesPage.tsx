import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { usePolling } from '../hooks/usePolling';
import { StateView } from '../components/StateView';
import {
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconCrosshair,
  IconList,
  IconSearch,
  IconSliders,
  IconTabs
} from '../components/Icons';
import { delayColorClass, formatBytes, formatTimeAgo } from '../utils/format';
import type { ProxyMode, ProxyNode, ProxyProvider } from '../api/types';

function getLastDelay(node?: ProxyNode): number | null {
  if (!node?.history || node.history.length === 0) return null;
  const last = node.history[node.history.length - 1];
  return typeof last?.delay === 'number' ? last.delay : null;
}

function resolveNodeDelay(proxies: Record<string, ProxyNode>, nodeName: string): number | null {
  let cur = nodeName;
  const seen = new Set<string>();
  let delay: number | null = null;
  for (let i = 0; i < 6; i++) {
    if (!cur || seen.has(cur)) break;
    seen.add(cur);
    const node = proxies[cur];
    if (!node) break;
    const d = getLastDelay(node);
    if (d !== null) delay = d;
    if (node.now && Array.isArray(node.all) && node.all.length > 0) {
      cur = node.now;
    } else {
      break;
    }
  }
  return delay;
}

const BUILTIN_NODES = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);
const INFO_NODE_RE =
  /(剩余流量|流量剩余|套餐到期|到期时间|过期时间|下次重置|重置剩余|距离.*重置|官网|网址|最新地址|客服|通知|公告|防失联|群组|频道|traffic\s*[:：]|expire\s*[:：]|reset\s*[:：])/i;

function isInfoPseudoNode(name: string, node?: ProxyNode): boolean {
  if (BUILTIN_NODES.has(name)) return false;
  if (node && Array.isArray(node.all) && node.all.length > 0) return false;
  return INFO_NODE_RE.test(name);
}

const GROUP_TYPE_LABEL: Record<string, string> = {
  Selector: '手动选择',
  URLTest: '自动测速',
  Fallback: '故障转移',
  LoadBalance: '负载均衡',
  Relay: '链式代理'
};

const SELECTED_GROUP_KEY = 'nikki_dash_proxy_group';
const VIEW_MODE_KEY = 'nikki_dash_proxy_view';
const HIDE_INFO_KEY = 'nikki_dash_proxy_hide_info';
const CLOSE_ON_SWITCH_KEY = 'nikki_dash_proxy_close_on_switch';
const TEST_URL_KEY = 'nikki_dash_proxy_test_url';

const TEST_URL_PRESETS = [
  { label: 'Google 204', url: 'https://www.gstatic.com/generate_204' },
  { label: 'Cloudflare', url: 'https://cp.cloudflare.com/generate_204' },
  { label: 'Apple', url: 'http://captive.apple.com/hotspot-detect.html' }
];

function readStorage(key: string, fallback: string): string {
  try {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function delayText(delay: number | null): string {
  if (delay === null) return '—';
  return delay > 0 ? `${delay} ms` : '超时';
}

export function ProxiesPage(props: {
  running: boolean;
  mode?: ProxyMode;
  initialGroup?: string | null;
  onConsumeInitialGroup?: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [proxies, setProxies] = useState<Record<string, ProxyNode>>({});
  const [providers, setProviders] = useState<Record<string, ProxyProvider>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'delay' | 'name'>('default');
  const [hideDead, setHideDead] = useState(false);
  const [hideInfo, setHideInfo] = useState<boolean>(() => readStorage(HIDE_INFO_KEY, '1') !== '0');
  const [closeOnSwitch, setCloseOnSwitch] = useState<boolean>(() => readStorage(CLOSE_ON_SWITCH_KEY, '0') === '1');
  const [viewMode, setViewMode] = useState<'tabs' | 'list'>(() =>
    readStorage(VIEW_MODE_KEY, 'tabs') === 'list' ? 'list' : 'tabs'
  );
  const [showSettings, setShowSettings] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeGroup, setActiveGroup] = useState<string>(() => props.initialGroup || readStorage(SELECTED_GROUP_KEY, ''));
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);
  const [updatingProv, setUpdatingProv] = useState<string | null>(null);
  const [locatePulseKey, setLocatePulseKey] = useState<string | null>(null);
  const [testUrl, setTestUrl] = useState<string>(() =>
    readStorage(TEST_URL_KEY, 'https://www.gstatic.com/generate_204')
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

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
      if (isGroup(p) && !seen.has(name) && !p.hidden) {
        ordered.push(p);
        seen.add(name);
      }
    }
    for (const p of Object.values(proxies)) {
      if (isGroup(p) && p.name !== 'GLOBAL' && !seen.has(p.name) && !p.hidden) {
        ordered.push(p);
        seen.add(p.name);
      }
    }
    if (props.mode === 'global' && isGroup(globalNode)) {
      return [globalNode, ...ordered];
    }
    return ordered;
  }, [proxies, props.mode]);

  const groupNameSet = useMemo(() => new Set(groups.map((g) => g.name)), [groups]);

  // Honor direct jump from Overview strategy group card
  useEffect(() => {
    if (!props.initialGroup || groups.length === 0) return;
    if (groupNameSet.has(props.initialGroup)) {
      setActiveGroup(props.initialGroup);
      writeStorage(SELECTED_GROUP_KEY, props.initialGroup);
      setCollapsedGroups((prev) => ({ ...prev, [props.initialGroup!]: false }));
    }
    props.onConsumeInitialGroup?.();
  }, [props.initialGroup, groups.length, groupNameSet, props.onConsumeInitialGroup]);

  const providerList = useMemo(
    () => Object.values(providers).filter((p) => p.vehicleType !== 'Compatible'),
    [providers]
  );

  const current = groups.find((g) => g.name === activeGroup) ?? groups[0];

  const chooseGroup = (name: string) => {
    setActiveGroup(name);
    writeStorage(SELECTED_GROUP_KEY, name);
  };

  const jumpToGroup = (name: string) => {
    if (!groupNameSet.has(name)) return;
    chooseGroup(name);
    setCollapsedGroups((prev) => ({ ...prev, [name]: false }));
    if (viewMode === 'list') {
      window.setTimeout(() => {
        const el = containerRef.current?.querySelector(`[data-group-card="${CSS.escape(name)}"]`);
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }, 30);
    } else {
      window.setTimeout(() => {
        const tab = containerRef.current?.querySelector(`[data-group-tab="${CSS.escape(name)}"]`);
        tab?.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }, 30);
    }
  };

  const locateSelected = (groupName: string) => {
    const selKey = `${groupName}::${proxies[groupName]?.now || ''}`;
    setCollapsedGroups((prev) => ({ ...prev, [groupName]: false }));
    setLocatePulseKey(null);
    window.setTimeout(() => {
      const target = containerRef.current?.querySelector(
        `[data-node-key="${CSS.escape(selKey)}"]`
      ) as HTMLElement | null;
      if (target) {
        target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        setLocatePulseKey(selKey);
        window.setTimeout(() => setLocatePulseKey((cur) => (cur === selKey ? null : cur)), 1200);
      } else {
        props.notify('info', '当前选中节点已被筛选条件隐藏');
      }
    }, 30);
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
      if (closeOnSwitch) {
        try {
          await nikkiApi.closeAllConnections();
          props.notify('success', `${group} → ${nodeName}（已断开旧连接）`);
        } catch {
          props.notify('success', `${group} → ${nodeName}`);
        }
      } else {
        props.notify('success', `${group} → ${nodeName}`);
      }
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

  const filterAndSortNodes = (group: ProxyNode) => {
    const q = search.trim().toLowerCase();
    const rawNodes = group.all || [];
    let hiddenInfoCount = 0;
    let nodes = rawNodes.filter((n) => {
      const nodeObj = proxies[n];
      if (isInfoPseudoNode(n, nodeObj)) {
        if (hideInfo && group.now !== n) {
          hiddenInfoCount++;
          return false;
        }
      }
      if (q && !n.toLowerCase().includes(q)) return false;
      if (hideDead) {
        const d = resolveNodeDelay(proxies, n);
        if (d !== null && d <= 0) return false;
      }
      return true;
    });

    if (sortBy === 'name') {
      nodes = [...nodes].sort((a, b) => a.localeCompare(b));
    } else if (sortBy === 'delay') {
      nodes = [...nodes].sort((a, b) => {
        const da = resolveNodeDelay(proxies, a);
        const db = resolveNodeDelay(proxies, b);
        return (da && da > 0 ? da : 999999) - (db && db > 0 ? db : 999999);
      });
    }
    return { nodes, rawCount: rawNodes.length, hiddenInfoCount };
  };

  const renderNodeGrid = (group: ProxyNode, nodes: string[]) => {
    const isSelectable = group.type === 'Selector';
    const testingGroup = testingKey === `group:${group.name}`;
    const q = search.trim();

    if (nodes.length === 0) {
      return (
        <p style={{ margin: 0, padding: '24px 0', textAlign: 'center', fontSize: '16px', color: 'var(--text-muted)' }}>
          {q ? `没有找到「${search}」相关的节点` : '该策略组没有可显示的节点'}
        </p>
      );
    }

    return (
      <div class="node-grid">
        {nodes.map((nodeName) => {
          const node = proxies[nodeName];
          const delay = resolveNodeDelay(proxies, nodeName);
          const selected = group.now === nodeName;
          const isNested = Array.isArray(node?.all) && node.all.length > 0;
          const canJumpSub = isNested && groupNameSet.has(nodeName);
          const nodeKey = `${group.name}::${nodeName}`;
          const isBusy = selectingKey === nodeKey;
          const nodeTesting = testingGroup || testingKey === `node:${nodeName}`;
          const isPulsing = locatePulseKey === nodeKey;

          return (
            <div
              key={nodeName}
              data-node-key={nodeKey}
              role={isSelectable ? 'button' : undefined}
              tabIndex={isSelectable ? 0 : undefined}
              aria-pressed={isSelectable ? selected : undefined}
              title={
                isSelectable ? `点击切换到 ${nodeName}` : `${group.type} 策略组由 Mihomo 自动选择，不支持手动切换`
              }
              class={`node-card ${selected ? 'selected' : ''} ${isSelectable ? '' : 'readonly-node'} ${isPulsing ? 'locate-flash' : ''}`}
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
                <div class="row" style={{ gap: '6px', flexWrap: 'nowrap', flexShrink: 0 }}>
                  {canJumpSub && (
                    <button
                      type="button"
                      class="node-jump-btn"
                      title={`打开子策略组「${nodeName}」`}
                      onClick={(e) => {
                        e.stopPropagation();
                        jumpToGroup(nodeName);
                      }}
                    >
                      查看
                    </button>
                  )}
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
            </div>
          );
        })}
      </div>
    );
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

  const currentFiltered = filterAndSortNodes(current);
  const testingCurrent = testingKey === `group:${current.name}`;
  const totalHiddenInfoAll = groups.reduce((acc, g) => acc + filterAndSortNodes(g).hiddenInfoCount, 0);

  const renderSettingsDrawer = () =>
    showSettings ? (
      <div class="toolbar-drawer">
        <div class="row" style={{ gap: '8px', flex: '1 1 320px' }}>
          <span class="field-label" style={{ whiteSpace: 'nowrap' }}>
            测速 URL
          </span>
          <input
            class="input mono"
            aria-label="测速 URL"
            style={{ maxWidth: '360px' }}
            value={testUrl}
            onInput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              setTestUrl(v);
              writeStorage(TEST_URL_KEY, v);
            }}
          />
          {TEST_URL_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              class={`chip ${testUrl === p.url ? 'active' : ''}`}
              onClick={() => {
                setTestUrl(p.url);
                writeStorage(TEST_URL_KEY, p.url);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label class="check-row" title="在手动选择策略组切换节点后自动关闭现有旧连接，让长连接立即切到新节点">
          <input
            type="checkbox"
            checked={closeOnSwitch}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLInputElement).checked;
              setCloseOnSwitch(v);
              writeStorage(CLOSE_ON_SWITCH_KEY, v ? '1' : '0');
            }}
          />
          <span>切换节点后自动断开旧连接</span>
        </label>
      </div>
    ) : null;

  const renderSharedFilters = (hiddenInfoCount: number) => (
    <div class="row" style={{ gap: '12px' }}>
      <label class="search-box" style={{ maxWidth: '220px' }}>
        <IconSearch />
        <input
          type="search"
          aria-label="搜索节点"
          placeholder="搜索节点（按 / 聚焦）"
          value={search}
          onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <select
        class="select"
        aria-label="排序方式"
        style={{ width: '148px' }}
        value={sortBy}
        onChange={(e) => setSortBy((e.currentTarget as HTMLSelectElement).value as 'default' | 'delay' | 'name')}
      >
        <option value="default">按配置顺序</option>
        <option value="delay">按延迟升序</option>
        <option value="name">按名称排序</option>
      </select>
      <label class="check-row" title="隐藏订阅中的剩余流量、到期时间、官网公告等占位信息项">
        <input
          type="checkbox"
          checked={hideInfo}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLInputElement).checked;
            setHideInfo(v);
            writeStorage(HIDE_INFO_KEY, v ? '1' : '0');
          }}
        />
        <span>隐藏信息节点{hiddenInfoCount > 0 ? ` (${hiddenInfoCount})` : ''}</span>
      </label>
      <label class="check-row">
        <input
          type="checkbox"
          checked={hideDead}
          onChange={(e) => setHideDead((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>隐藏超时</span>
      </label>
      <button
        type="button"
        class={`btn btn-sm ${showSettings ? 'badge-accent' : ''}`}
        aria-expanded={showSettings}
        onClick={() => setShowSettings((v) => !v)}
        title="测速 URL 与切换断开旧连接设置"
      >
        <IconSliders />
        选项
      </button>
    </div>
  );

  return (
    <div ref={containerRef}>
      <div class="page-header">
        <div>
          <h1 class="page-title">代理</h1>
          <p class="page-desc">
            策略组按配置文件顺序排列；点击节点即时切换，支持分组标签与全部展开双视图
          </p>
        </div>
        <div class="row" style={{ gap: '12px' }}>
          <div class="segmented" role="group" aria-label="策略组视图模式">
            <button
              type="button"
              class={viewMode === 'tabs' ? 'active' : ''}
              onClick={() => {
                setViewMode('tabs');
                writeStorage(VIEW_MODE_KEY, 'tabs');
              }}
              title="分组标签视图"
            >
              <span class="row" style={{ gap: '6px' }}>
                <IconTabs />
                标签
              </span>
            </button>
            <button
              type="button"
              class={viewMode === 'list' ? 'active' : ''}
              onClick={() => {
                setViewMode('list');
                writeStorage(VIEW_MODE_KEY, 'list');
              }}
              title="全部展开列表视图"
            >
              <span class="row" style={{ gap: '6px' }}>
                <IconList />
                列表
              </span>
            </button>
          </div>
          <button type="button" class="btn" onClick={() => void refresh()}>
            刷新
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={testingKey !== null}
            onClick={() => void handleTestGroup(current.name)}
          >
            {testingCurrent ? (
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

      {viewMode === 'tabs' ? (
        <>
          {/* Group tabs in profile order */}
          <div class="group-tabs" role="tablist" aria-label="策略组">
            {groups.map((g) => {
              const tabDelay = g.now ? resolveNodeDelay(proxies, g.now) : null;
              return (
                <button
                  key={g.name}
                  data-group-tab={g.name}
                  type="button"
                  role="tab"
                  aria-selected={g.name === current.name}
                  class={`group-tab ${g.name === current.name ? 'active' : ''}`}
                  onClick={() => chooseGroup(g.name)}
                  title={`${g.name}（${GROUP_TYPE_LABEL[g.type] || g.type}）`}
                >
                  <div class="group-tab-head">
                    <span class="group-tab-name">{g.name}</span>
                    {tabDelay !== null && (
                      <span class={`group-tab-delay mono ${delayColorClass(tabDelay)}`}>
                        {tabDelay > 0 ? `${tabDelay}ms` : '超时'}
                      </span>
                    )}
                  </div>
                  <span class="group-tab-now">{g.now || '—'}</span>
                </button>
              );
            })}
          </div>

          <section class="card-flush" aria-label={`${current.name} 节点列表`}>
            <div class="card-toolbar" style={{ justifyContent: 'space-between' }}>
              <div class="row" style={{ gap: '10px' }}>
                <h2 class="card-title">{current.name}</h2>
                <span class="badge">{GROUP_TYPE_LABEL[current.type] || current.type}</span>
                <span class="badge badge-accent">当前：{current.now || '—'}</span>
                <span class="mono" style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                  {currentFiltered.nodes.length} / {currentFiltered.rawCount}
                </span>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  onClick={() => locateSelected(current.name)}
                  title="滚动定位到当前选中节点"
                >
                  <IconCrosshair />
                  定位
                </button>
              </div>
              {renderSharedFilters(currentFiltered.hiddenInfoCount)}
            </div>

            {renderSettingsDrawer()}

            <div style={{ padding: '12px 16px 16px' }}>
              {renderNodeGrid(current, currentFiltered.nodes)}
            </div>
          </section>
        </>
      ) : (
        <>
          <section class="card-flush" style={{ marginBottom: '16px' }} aria-label="节点筛选与排序">
            <div class="card-toolbar" style={{ justifyContent: 'space-between' }}>
              <div class="row" style={{ gap: '8px' }}>
                <span class="card-title">全部策略组 ({groups.length})</span>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  onClick={() => setCollapsedGroups({})}
                >
                  全部展开
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    for (const g of groups) next[g.name] = true;
                    setCollapsedGroups(next);
                  }}
                >
                  全部折叠
                </button>
              </div>
              {renderSharedFilters(totalHiddenInfoAll)}
            </div>
            {renderSettingsDrawer()}
          </section>

          <div>
            {groups.map((g) => {
              const filtered = filterAndSortNodes(g);
              if (search.trim() && filtered.nodes.length === 0) return null;
              const isCollapsed = collapsedGroups[g.name] === true;
              const gDelay = g.now ? resolveNodeDelay(proxies, g.now) : null;
              const isTestingThis = testingKey === `group:${g.name}`;

              return (
                <section
                  key={g.name}
                  data-group-card={g.name}
                  class="list-group-card"
                  aria-label={`${g.name} 策略组`}
                >
                  <div class="list-group-head">
                    <div class="row" style={{ gap: '10px' }}>
                      <button
                        type="button"
                        class="list-group-toggle"
                        aria-expanded={!isCollapsed}
                        onClick={() =>
                          setCollapsedGroups((prev) => ({ ...prev, [g.name]: !prev[g.name] }))
                        }
                      >
                        <IconChevronDown className={`chevron-icon ${isCollapsed ? 'collapsed' : ''}`} />
                        <span>{g.name}</span>
                      </button>
                      <span class="badge">{GROUP_TYPE_LABEL[g.type] || g.type}</span>
                      <span class="badge badge-accent">当前：{g.now || '—'}</span>
                      {gDelay !== null && (
                        <span class={`badge mono ${delayColorClass(gDelay)}`}>{delayText(gDelay)}</span>
                      )}
                      <span class="mono" style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                        {filtered.nodes.length} / {filtered.rawCount}
                      </span>
                    </div>
                    <div class="row" style={{ gap: '8px' }}>
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost"
                        onClick={() => locateSelected(g.name)}
                        title="定位当前选中节点"
                      >
                        <IconCrosshair />
                        定位
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm"
                        disabled={testingKey !== null}
                        onClick={() => {
                          chooseGroup(g.name);
                          void handleTestGroup(g.name);
                        }}
                      >
                        {isTestingThis ? (
                          <>
                            <span class="spinner" /> 测速中...
                          </>
                        ) : (
                          <>
                            <IconBolt />
                            测速
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  {!isCollapsed && (
                    <div style={{ padding: '0 16px 16px' }}>{renderNodeGrid(g, filtered.nodes)}</div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

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
