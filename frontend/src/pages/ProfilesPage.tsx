import { useCallback, useEffect, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { StateView } from '../components/StateView';
import { ConfirmModal } from '../components/ConfirmModal';
import { IconCopy, IconPlus } from '../components/Icons';
import { formatBytes, formatExpireCountdown, parseFormattedSize } from '../utils/format';
import type { AsyncTask, ProfilesResponse, SubscriptionItem } from '../api/types';

export function ProfilesPage(props: {
  refreshSeq?: number;
  onRefreshStatus: () => void;
  onTrackTask: (task: AsyncTask) => void;
  onEditFile: (category: string, name: string) => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [data, setData] = useState<ProfilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subModal, setSubModal] = useState<Partial<SubscriptionItem> | null>(null);
  const [subFetchNow, setSubFetchNow] = useState(true);
  const [subSaving, setSubSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState('profile.yaml');
  const [importContent, setImportContent] = useState('');
  const [importActivate, setImportActivate] = useState(false);
  const [importing, setImporting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'file' | 'subscription'; id: string; label: string; active: boolean } | null>(null);
  const [fallbackProfile, setFallbackProfile] = useState('');
  const [forceStop, setForceStop] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await nikkiApi.getProfiles();
      setData(res);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if ((props.refreshSeq ?? 0) > 0) {
      void load();
    }
  }, [props.refreshSeq, load]);

  useEffect(() => {
    if (!subModal && !importOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (subModal && !subSaving) setSubModal(null);
        if (importOpen && !importing) setImportOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [subModal, subSaving, importOpen, importing]);

  const allChoices = [
    ...(data?.subscriptions || []).map((s) => ({ value: `subscription:${s.id}`, label: `订阅：${s.name}` })),
    ...(data?.files || []).map((f) => ({ value: `file:${f.name}`, label: `文件：${f.name}` }))
  ];

  const activeFriendly = (() => {
    const raw = data?.active_profile || '';
    if (!raw) return '未选择';
    if (raw.startsWith('subscription:')) {
      const id = raw.slice('subscription:'.length);
      const sub = data?.subscriptions?.find((s) => s.id === id);
      return sub ? `订阅：${sub.name}` : raw;
    }
    return raw.replace(/^file:/, '文件：');
  })();

  const handleSaveSub = async (e: Event) => {
    e.preventDefault();
    if (!subModal) return;
    setSubSaving(true);
    try {
      const res = await nikkiApi.saveSubscription({
        id: subModal.id || '',
        name: (subModal.name || '').trim(),
        url: (subModal.url || '').trim(),
        info_url: (subModal.info_url || '').trim(),
        user_agent: (subModal.user_agent || 'clash').trim(),
        prefer: subModal.prefer || 'remote',
        revision: data?.revision || ''
      });
      if (!res.id) {
        throw new Error('保存订阅失败：路由器未返回有效的订阅 ID');
      }
      if (res.http_warning) {
        props.notify('info', '提示：该订阅使用明文 HTTP，建议优先改用 HTTPS');
      }
      const isNew = !subModal.id;
      const shouldFetch = isNew && subFetchNow;
      setSubModal(null);
      await load();
      if (shouldFetch) {
        props.notify('success', '订阅已保存，正在后台拉取配置与流量信息...');
        try {
          const upd = await nikkiApi.updateSubscription(res.id, false, `sub_init_${res.id}_${Date.now()}`);
          props.onTrackTask(upd.task);
        } catch (updErr) {
          props.notify('error', `订阅已保存，但触发拉取失败：${(updErr as Error).message}`);
        }
      } else {
        props.notify('success', '订阅配置已保存');
      }
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setSubSaving(false);
    }
  };

  const handleUpdateSub = async (subId: string) => {
    try {
      const res = await nikkiApi.updateSubscription(subId, true, `sub_${subId}_${Math.floor(Date.now() / 5000)}`);
      props.onTrackTask(res.task);
      props.notify('info', '已开始后台更新订阅...');
    } catch (err) {
      props.notify('error', (err as Error).message);
    }
  };

  const handleUpdateAllSubs = async () => {
    const subs = data?.subscriptions || [];
    if (subs.length === 0 || updatingAll) return;
    setUpdatingAll(true);
    let okCount = 0;
    let failCount = 0;
    try {
      for (const sub of subs) {
        try {
          const res = await nikkiApi.updateSubscription(sub.id, sub.active, `sub_all_${sub.id}_${Date.now()}`);
          props.onTrackTask(res.task);
          // Poll sequentially so we respect the router's single write lock
          let done = false;
          for (let i = 0; i < 25; i++) {
            await new Promise((r) => window.setTimeout(r, 1200));
            const st = await nikkiApi.getTask(res.task.id);
            props.onTrackTask(st.task);
            if (st.task.status !== 'queued' && st.task.status !== 'running') {
              if (st.task.status === 'succeeded') okCount++;
              else failCount++;
              done = true;
              break;
            }
          }
          if (!done) failCount++;
        } catch {
          failCount++;
        }
      }
      await load();
      props.onRefreshStatus();
      props.notify(
        failCount === 0 ? 'success' : 'info',
        `全部订阅更新完成：成功 ${okCount} 个${failCount > 0 ? `，失败 ${failCount} 个` : ''}`
      );
    } finally {
      setUpdatingAll(false);
    }
  };

  const handleCopySubUrl = (sub: SubscriptionItem) => {
    if (!sub.url) return;
    void navigator.clipboard?.writeText(sub.url);
    props.notify('success', `已复制「${sub.name}」订阅链接`);
  };

  const handleSwitch = async (profileKey: string, applyNow: boolean) => {
    try {
      const res = await nikkiApi.switchProfile(profileKey, applyNow, `sw_${Date.now()}`);
      if (res.task) {
        props.onTrackTask(res.task);
        props.notify('info', '正在切换配置并重新应用 Nikki...');
      } else {
        props.notify('success', '活动配置已切换');
      }
      await load();
      props.onRefreshStatus();
    } catch (err) {
      props.notify('error', (err as Error).message);
    }
  };

  const handleFileUploadSelect = (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!/\.(ya?ml)$/i.test(file.name)) {
      props.notify('error', '仅支持 .yaml 或 .yml 文件');
      return;
    }
    setImportName(file.name.replace(/[^A-Za-z0-9._-]/g, '_'));
    const reader = new FileReader();
    reader.onload = () => setImportContent(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handleImportSubmit = async (e: Event) => {
    e.preventDefault();
    setImporting(true);
    try {
      await nikkiApi.importProfile(importName.trim(), importContent, importActivate);
      props.notify('success', `配置 ${importName} 已校验并导入`);
      setImportOpen(false);
      setImportContent('');
      await load();
      props.onRefreshStatus();
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === 'file') {
        await nikkiApi.deleteProfile(deleteTarget.id, deleteTarget.active ? fallbackProfile : '', deleteTarget.active && forceStop);
      } else {
        await nikkiApi.deleteSubscription(deleteTarget.id, deleteTarget.active ? fallbackProfile : '', deleteTarget.active && forceStop);
      }
      props.notify('success', `已删除 ${deleteTarget.label}`);
      setDeleteTarget(null);
      setFallbackProfile('');
      setForceStop(false);
      await load();
      props.onRefreshStatus();
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !data) return <StateView kind="loading" title="正在加载配置与订阅" />;
  if (error && !data) return <StateView kind="error" title="无法读取配置列表" message={error} actionLabel="重试" onAction={load} />;

  const deleteDisabled = Boolean(deleteTarget?.active && !fallbackProfile && !forceStop);

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">配置与订阅管理</h1>
          <p class="page-desc">管理远程订阅与本地 YAML 配置文件 · 当前活动配置：{activeFriendly}</p>
        </div>
        <div class="row" style={{ gap: '12px' }}>
          <button type="button" class="btn" onClick={() => setImportOpen(true)}>
            导入本地 YAML
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onClick={() => {
              setSubFetchNow(true);
              setSubModal({ name: '', url: '', info_url: '', user_agent: 'clash.meta', prefer: 'remote' });
            }}
          >
            <IconPlus />
            新增订阅
          </button>
        </div>
      </div>

      {/* Subscriptions */}
      <section class="card" aria-label="远程订阅列表">
        <div class="card-header">
          <h2 class="card-title">远程订阅 ({data?.subscriptions.length ?? 0})</h2>
          <div class="row" style={{ gap: '8px' }}>
            {(data?.subscriptions.length ?? 0) > 1 && (
              <button
                type="button"
                class="btn btn-sm"
                disabled={updatingAll}
                onClick={() => void handleUpdateAllSubs()}
              >
                {updatingAll ? (
                  <>
                    <span class="spinner" /> 批量更新中...
                  </>
                ) : (
                  '全部更新'
                )}
              </button>
            )}
            <button type="button" class="btn btn-ghost" onClick={() => void load()}>
              刷新
            </button>
          </div>
        </div>
        {(data?.subscriptions.length ?? 0) === 0 ? (
          <p style={{ margin: 0, padding: '16px 0', fontSize: '16px', lineHeight: '26px', color: 'var(--text-muted)' }}>
            还没有远程订阅，点击右上角「新增订阅」添加。
          </p>
        ) : (
          <div class="grid-2">
            {data!.subscriptions.map((sub) => {
              const usedBytes = parseFormattedSize(sub.used);
              const totalBytes = parseFormattedSize(sub.total);
              const pct =
                usedBytes !== null && totalBytes !== null && totalBytes > 0
                  ? Math.min(100, Math.round((usedBytes / totalBytes) * 100))
                  : null;
              const countdown = formatExpireCountdown(sub.expire);
              const fillCls =
                pct === null ? '' : pct >= 95 ? 'progress-fill-danger' : pct >= 80 ? 'progress-fill-warning' : '';
              return (
                <div key={sub.id} class={`sub-card ${sub.active ? 'active' : ''}`}>
                  <div class="row-between" style={{ marginBottom: '12px' }}>
                    <div class="row">
                      <span style={{ fontSize: '16px', lineHeight: '24px', fontWeight: 500 }}>{sub.name}</span>
                      {sub.active && <span class="badge badge-green">当前活动</span>}
                      {sub.success === '0' && <span class="badge badge-red">上次更新失败</span>}
                    </div>
                    <span class="badge">{sub.prefer === 'remote' ? '优先远程' : '优先本地'}</span>
                  </div>

                  <dl class="kv-grid" style={{ gridTemplateColumns: '88px minmax(0, 1fr)', rowGap: '8px' }}>
                    <dt class="kv-key">流量用量</dt>
                    <dd class="kv-val mono">
                      {sub.used || '—'} / {sub.total || '—'}（剩余 {sub.avaliable || '—'}）
                    </dd>
                    <dt class="kv-key">到期日期</dt>
                    <dd class="kv-val row" style={{ gap: '8px' }}>
                      <span class="mono">{sub.expire || '—'}</span>
                      {countdown && <span class={`badge ${countdown.badgeClass}`}>{countdown.text}</span>}
                    </dd>
                    <dt class="kv-key">最后更新</dt>
                    <dd class="kv-val mono">{sub.update || '未拉取'}</dd>
                    <dt class="kv-key">本地缓存</dt>
                    <dd class="kv-val mono">{sub.file_exists ? formatBytes(sub.file_size) : '尚无缓存文件'}</dd>
                  </dl>

                  {pct !== null && (
                    <div style={{ marginTop: '12px' }}>
                      <div class="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div class={`progress-fill ${fillCls}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}

                  <div class="row" style={{ marginTop: '16px', gap: '8px' }}>
                    {!sub.active && (
                      <button
                        type="button"
                        class="btn btn-sm"
                        onClick={() => void handleSwitch(`subscription:${sub.id}`, true)}
                      >
                        启用并应用
                      </button>
                    )}
                    <button
                      type="button"
                      class="btn btn-sm"
                      disabled={updatingAll}
                      onClick={() => void handleUpdateSub(sub.id)}
                    >
                      立即更新
                    </button>
                    <button type="button" class="btn btn-sm btn-ghost" onClick={() => setSubModal({ ...sub })}>
                      编辑
                    </button>
                    {sub.url && (
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost"
                        title="复制订阅 URL"
                        onClick={() => handleCopySubUrl(sub)}
                      >
                        <IconCopy />
                        复制链接
                      </button>
                    )}
                    {sub.file_exists && (
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost"
                        onClick={() => props.onEditFile('subscription', `${sub.id}.yaml`)}
                      >
                        查看 YAML
                      </button>
                    )}
                    <button
                      type="button"
                      class="btn btn-sm btn-danger"
                      style={{ marginLeft: 'auto' }}
                      onClick={() =>
                        setDeleteTarget({ kind: 'subscription', id: sub.id, label: sub.name, active: sub.active })
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Local File Profiles */}
      <section class="card-flush" aria-label="本地配置文件列表">
        <div class="card-toolbar" style={{ justifyContent: 'space-between' }}>
          <h2 class="card-title">
            本地配置文件 <span class="mono" style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/etc/nikki/profiles</span> (
            {data?.files.length ?? 0})
          </h2>
        </div>
        {(data?.files.length ?? 0) === 0 ? (
          <div style={{ padding: '24px 16px', fontSize: '16px', color: 'var(--text-muted)' }}>暂无本地配置文件。</div>
        ) : (
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>文件名</th>
                  <th class="th-right">大小</th>
                  <th>状态</th>
                  <th class="th-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {data!.files.map((f) => (
                  <tr key={f.name} class={f.active ? 'selected' : ''}>
                    <td class="mono" style={{ fontWeight: 500 }}>
                      {f.name}
                    </td>
                    <td class="mono td-right">{formatBytes(f.size)}</td>
                    <td>{f.active ? <span class="badge badge-green">当前活动</span> : <span class="badge">备用</span>}</td>
                    <td class="td-right">
                      <div class="row" style={{ justifyContent: 'flex-end', gap: '4px' }}>
                        {!f.active && (
                          <button type="button" class="op-btn" onClick={() => void handleSwitch(`file:${f.name}`, true)}>
                            启用并应用
                          </button>
                        )}
                        <button type="button" class="op-btn" onClick={() => props.onEditFile('profile', f.name)}>
                          编辑 YAML
                        </button>
                        <button
                          type="button"
                          class="op-btn op-btn-danger"
                          onClick={() => setDeleteTarget({ kind: 'file', id: f.name, label: f.name, active: f.active })}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add/Edit Subscription Modal */}
      {subModal && (
        <div
          class="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={subModal.id ? '编辑订阅' : '新增订阅'}
          onClick={(e) => {
            if (e.target === e.currentTarget && !subSaving) setSubModal(null);
          }}
        >
          <div class="modal-card modal-form">
            <h2 class="modal-title">{subModal.id ? '编辑订阅' : '新增订阅'}</h2>
            <form class="stack" onSubmit={handleSaveSub}>
              <div class="field">
                <label class="field-label">订阅名称</label>
                <input
                  class="input"
                  value={subModal.name || ''}
                  onInput={(e) => setSubModal({ ...subModal, name: (e.currentTarget as HTMLInputElement).value })}
                  required
                />
              </div>
              <div class="field">
                <label class="field-label">订阅 URL</label>
                <input
                  class="input mono"
                  type="url"
                  value={subModal.url || ''}
                  onInput={(e) => setSubModal({ ...subModal, url: (e.currentTarget as HTMLInputElement).value })}
                  required
                />
                {(subModal.url || '').toLowerCase().startsWith('http://') && (
                  <span class="field-hint" style={{ color: 'var(--warning)' }}>
                    警告：使用 HTTP 明文链接存在流量嗅探风险，建议使用 HTTPS。
                  </span>
                )}
              </div>
              <div class="field">
                <label class="field-label">
                  流量信息 URL <span class="field-optional">（选填）</span>
                </label>
                <input
                  class="input mono"
                  type="url"
                  value={subModal.info_url || ''}
                  onInput={(e) => setSubModal({ ...subModal, info_url: (e.currentTarget as HTMLInputElement).value })}
                />
              </div>
              <div class="grid-2">
                <div class="field">
                  <label class="field-label">User-Agent</label>
                  <input
                    class="input mono"
                    list="ua-list"
                    value={subModal.user_agent || 'clash'}
                    onInput={(e) => setSubModal({ ...subModal, user_agent: (e.currentTarget as HTMLInputElement).value })}
                  />
                  <datalist id="ua-list">
                    <option value="clash" />
                    <option value="clash.meta" />
                    <option value="mihomo" />
                  </datalist>
                </div>
                <div class="field">
                  <label class="field-label">启动优先策略</label>
                  <select
                    class="select"
                    value={subModal.prefer || 'remote'}
                    onChange={(e) =>
                      setSubModal({ ...subModal, prefer: (e.currentTarget as HTMLSelectElement).value as 'remote' | 'local' })
                    }
                  >
                    <option value="remote">优先拉取远程 (remote)</option>
                    <option value="local">优先使用本地缓存 (local)</option>
                  </select>
                </div>
              </div>
              {!subModal.id && (
                <label class="check-row">
                  <input
                    type="checkbox"
                    checked={subFetchNow}
                    onChange={(e) => setSubFetchNow((e.currentTarget as HTMLInputElement).checked)}
                  />
                  <span>保存后立即后台拉取订阅内容与流量信息</span>
                </label>
              )}
              <div class="modal-actions">
                <button type="button" class="btn" onClick={() => setSubModal(null)} disabled={subSaving}>
                  取消
                </button>
                <button type="submit" class="btn btn-primary" disabled={subSaving}>
                  {subSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Profile Modal */}
      {importOpen && (
        <div
          class="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="导入本地 YAML 配置"
          onClick={(e) => {
            if (e.target === e.currentTarget && !importing) setImportOpen(false);
          }}
        >
          <div class="modal-card modal-form">
            <h2 class="modal-title">导入本地 YAML 配置</h2>
            <form class="stack" onSubmit={handleImportSubmit}>
              <div class="field">
                <label class="field-label">
                  从本地选择 .yaml / .yml 文件 <span class="field-optional">（选填）</span>
                </label>
                <input type="file" accept=".yaml,.yml" onChange={handleFileUploadSelect} />
              </div>
              <div class="field">
                <label class="field-label">保存文件名</label>
                <input
                  class="input mono"
                  value={importName}
                  onInput={(e) => setImportName((e.currentTarget as HTMLInputElement).value)}
                  required
                />
              </div>
              <div class="field">
                <label class="field-label">YAML 内容</label>
                <textarea
                  class="textarea"
                  value={importContent}
                  onInput={(e) => setImportContent((e.currentTarget as HTMLTextAreaElement).value)}
                  required
                />
              </div>
              <label class="check-row">
                <input
                  type="checkbox"
                  checked={importActivate}
                  onChange={(e) => setImportActivate((e.currentTarget as HTMLInputElement).checked)}
                />
                <span>导入后立即设为当前活动配置</span>
              </label>
              <div class="modal-actions">
                <button type="button" class="btn" onClick={() => setImportOpen(false)} disabled={importing}>
                  取消
                </button>
                <button type="submit" class="btn btn-primary" disabled={importing}>
                  {importing ? '上传并校验中...' : '校验并导入'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title={`删除${deleteTarget?.kind === 'subscription' ? '订阅' : '配置'}「${deleteTarget?.label || ''}」？`}
        message={
          deleteTarget?.active
            ? '这是当前正在使用的活动配置。删除前必须选择一个备用配置切换，或勾选停止 Nikki。'
            : '删除后不可撤销，请确认继续。'
        }
        danger
        busy={deleting}
        confirmDisabled={deleteDisabled}
        confirmLabel={deleteTarget?.kind === 'subscription' ? '删除订阅' : '删除配置'}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setFallbackProfile('');
          setForceStop(false);
        }}
      >
        {deleteTarget?.active && (
          <div class="stack">
            <div class="field">
              <label class="field-label">切换到备用配置</label>
              <select
                class="select"
                value={fallbackProfile}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  setFallbackProfile(v);
                  if (v) setForceStop(false);
                }}
              >
                <option value="">不切换（需勾选下方停止服务）</option>
                {allChoices
                  .filter((c) => c.value !== `${deleteTarget.kind}:${deleteTarget.id}`)
                  .map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </div>
            <label class="check-row">
              <input
                type="checkbox"
                checked={forceStop}
                onChange={(e) => {
                  const chk = (e.currentTarget as HTMLInputElement).checked;
                  setForceStop(chk);
                  if (chk) setFallbackProfile('');
                }}
              />
              <span>停止 Nikki 并清除当前活动配置</span>
            </label>
          </div>
        )}
      </ConfirmModal>
    </div>
  );
}
