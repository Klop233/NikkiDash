import { useCallback, useEffect, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { StateView } from '../components/StateView';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatBytes } from '../utils/format';
import type { AsyncTask, ProfilesResponse, SubscriptionItem } from '../api/types';

export function ProfilesPage(props: {
  onRefreshStatus: () => void;
  onTrackTask: (task: AsyncTask) => void;
  onEditFile: (category: string, name: string) => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [data, setData] = useState<ProfilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Subscription editor modal
  const [subModal, setSubModal] = useState<Partial<SubscriptionItem> | null>(null);
  const [subSaving, setSubSaving] = useState(false);

  // Import file modal
  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState('profile.yaml');
  const [importContent, setImportContent] = useState('');
  const [importActivate, setImportActivate] = useState(false);
  const [importing, setImporting] = useState(false);

  // Delete confirmation (with active profile protection)
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'file' | 'subscription'; id: string; label: string; active: boolean } | null>(null);
  const [fallbackProfile, setFallbackProfile] = useState('');
  const [forceStop, setForceStop] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const allChoices = [
    ...(data?.subscriptions || []).map((s) => ({ value: `subscription:${s.id}`, label: `订阅: ${s.name}` })),
    ...(data?.files || []).map((f) => ({ value: `file:${f.name}`, label: `文件: ${f.name}` }))
  ];

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
      if (res.http_warning) {
        props.notify('info', '提示：该订阅使用明文 HTTP，建议优先改用 HTTPS');
      }
      props.notify('success', '订阅配置已保存');
      setSubModal(null);
      await load();
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

  if (loading && !data) return <StateView kind="loading" title="正在加载配置与订阅..." />;
  if (error && !data) return <StateView kind="error" title="无法读取配置列表" message={error} actionLabel="重试" onAction={load} />;

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">配置与订阅管理</h2>
          <p class="page-desc">管理远程订阅与本地 YAML 配置文件，当前活动配置：{data?.active_profile || '未选择'}</p>
        </div>
        <div class="row">
          <button
            class="btn btn-primary"
            onClick={() => setSubModal({ name: '', url: '', info_url: '', user_agent: 'clash.meta', prefer: 'remote' })}
          >
            新增订阅
          </button>
          <button class="btn" onClick={() => setImportOpen(true)}>
            导入本地 YAML
          </button>
        </div>
      </div>

      {/* Subscriptions */}
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">远程订阅 ({data?.subscriptions.length ?? 0})</h3>
          <button class="btn btn-sm" onClick={load}>
            刷新
          </button>
        </div>
        {(data?.subscriptions.length ?? 0) === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '14px 0' }}>暂无订阅，点击右上角「新增订阅」添加。</div>
        ) : (
          <div class="grid-2">
            {data!.subscriptions.map((sub) => (
              <div
                key={sub.id}
                class="card"
                style={{
                  margin: 0,
                  borderColor: sub.active ? 'var(--accent)' : 'var(--border)',
                  background: sub.active ? 'var(--accent-soft)' : 'var(--surface-2)'
                }}
              >
                <div class="row-between">
                  <div class="row">
                    <strong>{sub.name}</strong>
                    {sub.active && <span class="badge badge-green">当前活动</span>}
                    {sub.success === '0' && <span class="badge badge-red">上次更新失败</span>}
                  </div>
                  <span class="badge">{sub.prefer === 'remote' ? '优先远程' : '优先本地'}</span>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                  <div>已用: {sub.used || '-'} / 总量: {sub.total || '-'} · 剩余: {sub.avaliable || '-'}</div>
                  <div>到期: {sub.expire || '-'} · 更新: {sub.update || '未拉取'}</div>
                  <div>本地缓存: {sub.file_exists ? formatBytes(sub.file_size) : '尚无缓存文件'}</div>
                </div>

                <div class="row" style={{ marginTop: '12px' }}>
                  {!sub.active && (
                    <button class="btn btn-sm btn-primary" onClick={() => handleSwitch(`subscription:${sub.id}`, true)}>
                      切换并应用
                    </button>
                  )}
                  <button class="btn btn-sm btn-success" onClick={() => handleUpdateSub(sub.id)}>
                    立即更新
                  </button>
                  <button class="btn btn-sm" onClick={() => setSubModal({ ...sub })}>
                    编辑
                  </button>
                  {sub.file_exists && (
                    <button class="btn btn-sm" onClick={() => props.onEditFile('subscription', `${sub.id}.yaml`)}>
                      查看 YAML
                    </button>
                  )}
                  <button
                    class="btn btn-sm btn-danger"
                    onClick={() =>
                      setDeleteTarget({ kind: 'subscription', id: sub.id, label: sub.name, active: sub.active })
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Local File Profiles */}
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">本地配置文件 (/etc/nikki/profiles) ({data?.files.length ?? 0})</h3>
        </div>
        {(data?.files.length ?? 0) === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '14px 0' }}>暂无本地配置文件。</div>
        ) : (
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>文件名</th>
                  <th>大小</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data!.files.map((f) => (
                  <tr key={f.name}>
                    <td class="mono" style={{ fontWeight: 600 }}>
                      {f.name}
                    </td>
                    <td class="mono">{formatBytes(f.size)}</td>
                    <td>{f.active ? <span class="badge badge-green">当前活动</span> : <span class="badge">备用</span>}</td>
                    <td>
                      <div class="row">
                        {!f.active && (
                          <button class="btn btn-sm btn-primary" onClick={() => handleSwitch(`file:${f.name}`, true)}>
                            启用并应用
                          </button>
                        )}
                        <button class="btn btn-sm" onClick={() => props.onEditFile('profile', f.name)}>
                          编辑 YAML
                        </button>
                        <button
                          class="btn btn-sm btn-danger"
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
      </div>

      {/* Add/Edit Subscription Modal */}
      {subModal && (
        <div class="modal-overlay" role="dialog" aria-modal="true">
          <div class="modal-card" style={{ maxWidth: '520px' }}>
            <h3 style={{ margin: '0 0 12px' }}>{subModal.id ? '编辑订阅' : '新增订阅'}</h3>
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
                  class="input"
                  type="url"
                  value={subModal.url || ''}
                  onInput={(e) => setSubModal({ ...subModal, url: (e.currentTarget as HTMLInputElement).value })}
                  required
                />
                {(subModal.url || '').toLowerCase().startsWith('http://') && (
                  <span class="field-hint" style={{ color: 'var(--amber)' }}>
                    警告：使用 HTTP 明文链接存在流量嗅探风险，建议使用 HTTPS。
                  </span>
                )}
              </div>
              <div class="field">
                <label class="field-label">流量信息 URL (可选)</label>
                <input
                  class="input"
                  type="url"
                  value={subModal.info_url || ''}
                  onInput={(e) => setSubModal({ ...subModal, info_url: (e.currentTarget as HTMLInputElement).value })}
                />
              </div>
              <div class="grid-2">
                <div class="field">
                  <label class="field-label">User-Agent</label>
                  <input
                    class="input"
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
        <div class="modal-overlay" role="dialog" aria-modal="true">
          <div class="modal-card" style={{ maxWidth: '580px' }}>
            <h3 style={{ margin: '0 0 12px' }}>导入本地 YAML 配置</h3>
            <form class="stack" onSubmit={handleImportSubmit}>
              <div class="field">
                <label class="field-label">从本地选择 .yaml / .yml 文件（支持大文件分片上传）</label>
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
              <label class="row" style={{ cursor: 'pointer' }}>
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

      {/* Active-safe Delete Confirm Modal */}
      <ConfirmModal
        open={deleteTarget !== null}
        title={`删除${deleteTarget?.kind === 'subscription' ? '订阅' : '配置'}：${deleteTarget?.label || ''}`}
        message={
          deleteTarget?.active
            ? '这是当前正在使用的活动配置！删除前必须选择一个备用配置切换，或选择同时停止 Nikki。'
            : '删除后不可恢复，确定继续？'
        }
        danger
        busy={deleting}
        confirmLabel="确认删除"
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setFallbackProfile('');
          setForceStop(false);
        }}
      >
        {deleteTarget?.active && (
          <div class="stack" style={{ marginTop: '8px' }}>
            <div class="field">
              <label class="field-label">切换到备用配置</label>
              <select
                class="select"
                value={fallbackProfile}
                onChange={(e) => setFallbackProfile((e.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">-- 不切换（需勾选下方停止服务） --</option>
                {allChoices
                  .filter((c) => c.value !== `${deleteTarget.kind}:${deleteTarget.id}`)
                  .map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </div>
            <label class="row" style={{ cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={forceStop}
                onChange={(e) => setForceStop((e.currentTarget as HTMLInputElement).checked)}
              />
              <span>停止 Nikki 并清除当前活动配置</span>
            </label>
          </div>
        )}
      </ConfirmModal>
    </div>
  );
}
