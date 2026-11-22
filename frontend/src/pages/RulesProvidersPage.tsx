import { useCallback, useMemo, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { usePolling } from '../hooks/usePolling';
import { StateView } from '../components/StateView';
import { formatTimeAgo } from '../utils/format';
import type { ProxyProvider, RuleItem, RuleProvider } from '../api/types';

const PAGE_SIZE = 100;

export function RulesProvidersPage(props: {
  running: boolean;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [tab, setTab] = useState<'rules' | 'rule_providers' | 'proxy_providers'>('rules');
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [ruleProviders, setRuleProviders] = useState<Record<string, RuleProvider>>({});
  const [proxyProviders, setProxyProviders] = useState<Record<string, ProxyProvider>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetcher = useCallback((signal: AbortSignal) => nikkiApi.getRules({ signal }), []);

  const { refresh } = usePolling(
    fetcher,
    (data) => {
      setRules(data.rules || []);
      setRuleProviders(data.rule_providers || {});
      setProxyProviders(data.proxy_providers || {});
      setLoading(false);
      setError(null);
    },
    (err) => {
      setError((err as Error)?.message || '读取规则与 Provider 失败');
      setLoading(false);
    },
    { intervalMs: 15000, enabled: props.running }
  );

  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter(
      (r) =>
        r.type.toLowerCase().includes(q) ||
        r.payload.toLowerCase().includes(q) ||
        r.proxy.toLowerCase().includes(q)
    );
  }, [rules, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRules = filteredRules.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleUpdate = async (kind: 'rule' | 'proxy', name: string) => {
    setUpdating(`${kind}:${name}`);
    try {
      await nikkiApi.updateProvider(kind, name);
      await refresh();
      props.notify('success', `Provider ${name} 更新成功`);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setUpdating(null);
    }
  };

  if (!props.running) {
    return <StateView kind="empty" title="Nikki 未运行" message="启动 Nikki 后可查看运行时规则与 Providers 状态。" />;
  }
  if (loading && rules.length === 0) {
    return <StateView kind="loading" title="正在加载规则与 Providers..." />;
  }
  if (error && rules.length === 0) {
    return <StateView kind="error" title="无法读取规则" message={error} actionLabel="重试" onAction={refresh} />;
  }

  const rProvList = Object.values(ruleProviders);
  const pProvList = Object.values(proxyProviders);

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">规则与 Providers</h2>
          <p class="page-desc">查看 Mihomo 当前生效的运行时规则与外部规则/代理提供者</p>
        </div>
        <button class="btn" onClick={refresh}>
          刷新
        </button>
      </div>

      <div class="alert alert-info">
        <div>
          此页面展示的是 Mihomo <strong>运行时内存中的生效规则</strong>。若要持久化新增/修改规则或 Provider，请前往「Nikki 设置 → 规则」或「高级 YAML」编辑并应用。
        </div>
      </div>

      <div class="tabs">
        <button class={`tab-btn ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>
          运行时规则 ({rules.length})
        </button>
        <button class={`tab-btn ${tab === 'rule_providers' ? 'active' : ''}`} onClick={() => setTab('rule_providers')}>
          规则 Providers ({rProvList.length})
        </button>
        <button class={`tab-btn ${tab === 'proxy_providers' ? 'active' : ''}`} onClick={() => setTab('proxy_providers')}>
          代理 Providers ({pProvList.length})
        </button>
      </div>

      {tab === 'rules' && (
        <div class="card">
          <div class="row" style={{ marginBottom: '12px' }}>
            <input
              class="input"
              style={{ maxWidth: '320px' }}
              placeholder="搜索规则类型 / 匹配内容 / 目标策略..."
              value={search}
              onInput={(e) => {
                setSearch((e.currentTarget as HTMLInputElement).value);
                setPage(1);
              }}
            />
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>类型</th>
                  <th>匹配项</th>
                  <th>目标策略</th>
                </tr>
              </thead>
              <tbody>
                {pageRules.map((r, i) => (
                  <tr key={`${safePage}-${i}`}>
                    <td style={{ color: 'var(--text-muted)' }}>{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                    <td>
                      <span class="badge">{r.type}</span>
                    </td>
                    <td class="mono">{r.payload || '-'}</td>
                    <td>
                      <span class="badge badge-accent">{r.proxy}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div class="row-between" style={{ marginTop: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                第 {safePage} / {totalPages} 页
              </span>
              <div class="row">
                <button class="btn btn-sm" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </button>
                <button class="btn btn-sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'rule_providers' && (
        <div class="card">
          {rProvList.length === 0 ? (
            <StateView kind="empty" title="未配置规则 Provider" />
          ) : (
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>来源 / 行为</th>
                    <th>格式</th>
                    <th>规则数</th>
                    <th>最后更新</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rProvList.map((p) => (
                    <tr key={p.name}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>
                        <span class="badge">{p.vehicleType || p.type}</span>{' '}
                        <span class="badge badge-purple">{p.behavior || '-'}</span>
                      </td>
                      <td>{p.format || '-'}</td>
                      <td class="mono">{p.ruleCount ?? '-'}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatTimeAgo(p.updatedAt)}</td>
                      <td>
                        <button
                          class="btn btn-sm"
                          disabled={updating !== null}
                          onClick={() => handleUpdate('rule', p.name)}
                        >
                          {updating === `rule:${p.name}` ? '更新中...' : '更新'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'proxy_providers' && (
        <div class="card">
          {pProvList.length === 0 ? (
            <StateView kind="empty" title="未配置代理 Provider" />
          ) : (
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>来源</th>
                    <th>节点数</th>
                    <th>最后更新</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pProvList.map((p) => (
                    <tr key={p.name}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>
                        <span class="badge">{p.vehicleType || p.type}</span>
                      </td>
                      <td class="mono">{p.proxies?.length ?? 0}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatTimeAgo(p.updatedAt)}</td>
                      <td>
                        <button
                          class="btn btn-sm"
                          disabled={updating !== null}
                          onClick={() => handleUpdate('proxy', p.name)}
                        >
                          {updating === `proxy:${p.name}` ? '更新中...' : '更新'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
