import { useCallback, useMemo, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { usePolling } from '../hooks/usePolling';
import { StateView } from '../components/StateView';
import { IconChevronLeft, IconChevronRight, IconInfo, IconSearch } from '../components/Icons';
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
    return <StateView kind="loading" title="正在加载规则与 Providers" />;
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
          <h1 class="page-title">规则与提供者</h1>
          <p class="page-desc">查看 Mihomo 当前生效的运行时规则与外部规则、代理提供者</p>
        </div>
        <button type="button" class="btn" onClick={refresh}>
          刷新
        </button>
      </div>

      <div class="alert alert-info" role="status">
        <IconInfo className="alert-icon" />
        <div class="alert-body">
          此页面展示 Mihomo <strong>运行时内存中的生效规则</strong>。若要持久化修改规则或 Provider，请前往「Nikki 设置 → 嗅探 / 规则 / GeoX」或「高级 YAML」编辑并应用。
        </div>
      </div>

      <div class="tabs" role="tablist" aria-label="规则与提供者分类">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'rules'}
          class={`tab-btn ${tab === 'rules' ? 'active' : ''}`}
          onClick={() => setTab('rules')}
        >
          运行时规则<span class="tab-cnt">{rules.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'rule_providers'}
          class={`tab-btn ${tab === 'rule_providers' ? 'active' : ''}`}
          onClick={() => setTab('rule_providers')}
        >
          规则 Providers<span class="tab-cnt">{rProvList.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'proxy_providers'}
          class={`tab-btn ${tab === 'proxy_providers' ? 'active' : ''}`}
          onClick={() => setTab('proxy_providers')}
        >
          代理 Providers<span class="tab-cnt">{pProvList.length}</span>
        </button>
      </div>

      {tab === 'rules' && (
        <section class="card-flush" aria-label="运行时规则列表">
          <div class="card-toolbar">
            <label class="search-box" style={{ maxWidth: '340px' }}>
              <IconSearch />
              <input
                type="search"
                aria-label="搜索规则"
                placeholder="搜索规则类型、匹配内容或目标策略"
                value={search}
                onInput={(e) => {
                  setSearch((e.currentTarget as HTMLInputElement).value);
                  setPage(1);
                }}
              />
            </label>
            {search && (
              <button
                type="button"
                class="btn btn-ghost"
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
              >
                清除筛选
              </button>
            )}
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th style={{ width: '72px' }}>序号</th>
                  <th>类型</th>
                  <th>匹配项</th>
                  <th>目标策略</th>
                </tr>
              </thead>
              <tbody>
                {pageRules.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                      {search ? `没有找到「${search}」相关的规则` : '当前没有规则记录'}
                    </td>
                  </tr>
                ) : (
                  pageRules.map((r, i) => (
                    <tr key={`${safePage}-${i}`}>
                      <td class="mono" style={{ color: 'var(--text-muted)' }}>
                        {(safePage - 1) * PAGE_SIZE + i + 1}
                      </td>
                      <td>
                        <span class="badge mono">{r.type}</span>
                      </td>
                      <td class="mono">{r.payload || '—'}</td>
                      <td>
                        <span class="badge badge-accent">{r.proxy}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div class="card-footer">
            <span>
              共 <span class="mono">{filteredRules.length}</span> 条规则
              {totalPages > 1 ? ` · 第 ${safePage} / ${totalPages} 页` : ''}
            </span>
            {totalPages > 1 && (
              <nav class="pagination" aria-label="规则分页">
                <button
                  type="button"
                  class="page-btn"
                  aria-label="上一页"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <IconChevronLeft />
                </button>
                <span class="page-btn active" aria-current="page">
                  {safePage}
                </span>
                <button
                  type="button"
                  class="page-btn"
                  aria-label="下一页"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <IconChevronRight />
                </button>
              </nav>
            )}
          </div>
        </section>
      )}

      {tab === 'rule_providers' &&
        (rProvList.length === 0 ? (
          <StateView kind="empty" title="未配置规则 Provider" message="当前运行配置未声明外部 rule-providers。" />
        ) : (
          <section class="card-flush" aria-label="规则 Provider 列表">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>来源 / 行为</th>
                    <th>格式</th>
                    <th class="th-right">规则数</th>
                    <th>最后更新</th>
                    <th class="th-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rProvList.map((p) => (
                    <tr key={p.name}>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td>
                        <div class="row" style={{ gap: '6px' }}>
                          <span class="badge">{p.vehicleType || p.type}</span>
                          <span class="badge badge-accent">{p.behavior || '—'}</span>
                        </div>
                      </td>
                      <td class="mono">{p.format || '—'}</td>
                      <td class="mono td-right">{p.ruleCount ?? '—'}</td>
                      <td class="mono" style={{ color: 'var(--text-muted)' }}>
                        {formatTimeAgo(p.updatedAt)}
                      </td>
                      <td class="td-right">
                        <button
                          type="button"
                          class="op-btn"
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
            <div class="card-footer">
              <span>
                共 <span class="mono">{rProvList.length}</span> 项
              </span>
            </div>
          </section>
        ))}

      {tab === 'proxy_providers' &&
        (pProvList.length === 0 ? (
          <StateView kind="empty" title="未配置代理 Provider" message="当前运行配置未声明外部 proxy-providers。" />
        ) : (
          <section class="card-flush" aria-label="代理 Provider 列表">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>来源</th>
                    <th class="th-right">节点数</th>
                    <th>最后更新</th>
                    <th class="th-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pProvList.map((p) => (
                    <tr key={p.name}>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td>
                        <span class="badge">{p.vehicleType || p.type}</span>
                      </td>
                      <td class="mono td-right">{p.proxies?.length ?? 0}</td>
                      <td class="mono" style={{ color: 'var(--text-muted)' }}>
                        {formatTimeAgo(p.updatedAt)}
                      </td>
                      <td class="td-right">
                        <button
                          type="button"
                          class="op-btn"
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
            <div class="card-footer">
              <span>
                共 <span class="mono">{pProvList.length}</span> 项
              </span>
            </div>
          </section>
        ))}
    </div>
  );
}
