import { useCallback, useEffect, useState } from 'preact/hooks';
import yaml from 'js-yaml';
import { nikkiApi } from '../api/nikki';
import { StateView } from '../components/StateView';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatBytes } from '../utils/format';
import type { ManagedFileEntry } from '../api/types';

export function YamlEditorPage(props: {
  initialTarget?: { category: string; name: string } | null;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [catalog, setCatalog] = useState<Record<string, ManagedFileEntry[]>>({});
  const [selected, setSelected] = useState<{ category: string; name: string }>(
    props.initialTarget || { category: 'mixin', name: 'mixin.yaml' }
  );
  const [content, setContent] = useState('');
  const [revision, setRevision] = useState('');
  const [writable, setWritable] = useState(true);
  const [backups, setBackups] = useState<Array<{ id: string; size: number; mtime: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clientYamlErr, setClientYamlErr] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    const res = await nikkiApi.listFiles();
    setCatalog(res.files || {});
  }, []);

  const loadFile = useCallback(async (cat: string, name: string) => {
    setLoading(true);
    setClientYamlErr(null);
    try {
      const f = await nikkiApi.readFile(cat, cat === 'mixin' || cat === 'run_config' ? '' : name);
      setContent(f.content || '');
      setRevision(f.revision || '');
      setWritable(f.writable);
      if (f.writable) {
        const b = await nikkiApi.listBackups(cat, cat === 'mixin' ? '' : name);
        setBackups(b.backups || []);
      } else {
        setBackups([]);
      }
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [props]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (props.initialTarget) {
      setSelected(props.initialTarget);
    }
  }, [props.initialTarget]);

  useEffect(() => {
    void loadFile(selected.category, selected.name);
  }, [selected, loadFile]);

  const validateClientYaml = (text: string): boolean => {
    if (selected.category === 'rule_provider' && !/\.(ya?ml)$/i.test(selected.name)) {
      setClientYamlErr(null);
      return true;
    }
    try {
      yaml.load(text);
      setClientYamlErr(null);
      return true;
    } catch (err) {
      setClientYamlErr((err as Error).message);
      return false;
    }
  };

  const handleSave = async () => {
    if (!writable) return;
    if (!validateClientYaml(content)) {
      props.notify('error', '前端 YAML 语法检查未通过，请修复后再保存');
      return;
    }
    setSaving(true);
    try {
      const targetName = selected.category === 'mixin' ? '' : selected.name;
      const res = await nikkiApi.saveFileSmart(
        selected.category,
        targetName,
        content,
        revision,
        selected.category === 'profile'
      );
      setRevision(res.revision);
      props.notify('success', `文件已校验并原子保存（${formatBytes(res.size)}）`);
      const b = await nikkiApi.listBackups(selected.category, targetName);
      setBackups(b.backups || []);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreId) return;
    try {
      const targetName = selected.category === 'mixin' ? '' : selected.name;
      await nikkiApi.restoreBackup(selected.category, targetName, restoreId);
      props.notify('success', `已恢复备份 ${restoreId}`);
      setRestoreId(null);
      await loadFile(selected.category, selected.name);
    } catch (err) {
      props.notify('error', (err as Error).message);
    }
  };

  const options: Array<{ group: string; category: string; items: ManagedFileEntry[] }> = [
    { group: 'Mixin 文件', category: 'mixin', items: catalog.mixin || [] },
    { group: '运行配置（只读）', category: 'run_config', items: catalog.run_config || [] },
    { group: '本地 Profile', category: 'profile', items: catalog.profile || [] },
    { group: '订阅缓存（更新时覆盖）', category: 'subscription', items: catalog.subscription || [] },
    { group: '规则 Provider', category: 'rule_provider', items: catalog.rule_provider || [] },
    { group: '代理 Provider', category: 'proxy_provider', items: catalog.proxy_provider || [] }
  ];

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">高级 YAML 编辑器</h2>
          <p class="page-desc">编辑 mixin.yaml、本地 Profile 与 Provider 文件（服务端二次 yq 校验 + 自动备份 + 分片保存）</p>
        </div>
        <div class="row">
          <button class="btn" onClick={() => validateClientYaml(content)}>
            本地语法检查
          </button>
          <button class="btn btn-primary" disabled={!writable || saving} onClick={handleSave}>
            {saving ? '校验保存中...' : '保存文件'}
          </button>
        </div>
      </div>

      {selected.category === 'run_config' && (
        <div class="alert alert-info">
          <div>
            <strong>/etc/nikki/run/config.yaml 为只读运行文件：</strong>
            每次启动 Nikki 时都会重新生成。如需持久化修改，请编辑 <span class="mono">mixin.yaml</span> 或原始 Profile。
          </div>
        </div>
      )}

      {selected.category === 'subscription' && (
        <div class="alert alert-warning">
          <div>
            <strong>注意：</strong>直接编辑订阅缓存文件会在下一次更新订阅时被覆盖，建议将自定义规则写在 <span class="mono">mixin.yaml</span>。
          </div>
        </div>
      )}

      {clientYamlErr && (
        <div class="alert alert-danger">
          <div class="mono" style={{ fontSize: '12px' }}>
            YAML 语法错误：{clientYamlErr}
          </div>
        </div>
      )}

      <div class="card">
        <div class="row-between" style={{ marginBottom: '12px' }}>
          <select
            class="select"
            style={{ maxWidth: '380px' }}
            value={`${selected.category}::${selected.name}`}
            onChange={(e) => {
              const [category, name] = (e.currentTarget as HTMLSelectElement).value.split('::');
              setSelected({ category, name });
            }}
          >
            {options.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map((item) => (
                  <option key={`${g.category}::${item.name}`} value={`${g.category}::${item.name}`}>
                    {item.name} ({formatBytes(item.size)}){item.writable ? '' : ' [只读]'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <div class="row">
            <span class={`badge ${writable ? 'badge-green' : 'badge-amber'}`}>{writable ? '可写' : '只读'}</span>
            <button class="btn btn-sm" onClick={() => loadFile(selected.category, selected.name)}>
              重新读取
            </button>
          </div>
        </div>

        {loading ? (
          <StateView kind="loading" title="正在读取文件内容..." />
        ) : (
          <textarea
            class="textarea"
            style={{ minHeight: '440px' }}
            readOnly={!writable}
            value={content}
            onInput={(e) => {
              const v = (e.currentTarget as HTMLTextAreaElement).value;
              setContent(v);
              if (clientYamlErr) validateClientYaml(v);
            }}
          />
        )}
      </div>

      {writable && backups.length > 0 && (
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">历史备份（最多保留 5 份）</h3>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>备份 ID</th>
                  <th>大小</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td class="mono">{b.id}</td>
                    <td class="mono">{formatBytes(b.size)}</td>
                    <td>
                      <button class="btn btn-sm" onClick={() => setRestoreId(b.id)}>
                        恢复此备份
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmModal
        open={restoreId !== null}
        title="恢复历史备份？"
        message={`将使用备份 ${restoreId} 覆盖当前文件内容（当前内容会先自动再备份一份）。`}
        confirmLabel="确认恢复"
        onConfirm={handleRestore}
        onCancel={() => setRestoreId(null)}
      />
    </div>
  );
}
