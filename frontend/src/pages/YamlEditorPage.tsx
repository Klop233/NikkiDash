import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import yaml from 'js-yaml';
import { nikkiApi } from '../api/nikki';
import { StateView } from '../components/StateView';
import { ConfirmModal } from '../components/ConfirmModal';
import { IconError, IconInfo, IconWarning } from '../components/Icons';
import { formatBytes } from '../utils/format';
import type { ManagedFileEntry } from '../api/types';

export function YamlEditorPage(props: {
  initialTarget?: { category: string; name: string } | null;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const notifyRef = useRef(props.notify);
  notifyRef.current = props.notify;

  const [catalog, setCatalog] = useState<Record<string, ManagedFileEntry[]>>({});
  const [selected, setSelected] = useState<{ category: string; name: string }>(
    props.initialTarget || { category: 'mixin', name: 'mixin.yaml' }
  );
  const [pendingTarget, setPendingTarget] = useState<{ category: string; name: string } | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [revision, setRevision] = useState('');
  const [writable, setWritable] = useState(true);
  const [isBinary, setIsBinary] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const [backups, setBackups] = useState<Array<{ id: string; size: number; mtime: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clientYamlErr, setClientYamlErr] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);

  const dirty = writable && !isBinary && content !== savedContent;

  const loadCatalog = useCallback(async () => {
    try {
      const res = await nikkiApi.listFiles();
      setCatalog(res.files || {});
    } catch (err) {
      notifyRef.current('error', `加载文件目录失败：${(err as Error).message}`);
    }
  }, []);

  const loadFile = useCallback(async (cat: string, name: string) => {
    setLoading(true);
    setLoadError(null);
    setClientYamlErr(null);
    setIsBinary(false);

    if (/\.(mrs|dat|mmdb|db|bin|gz|zip|tar|xz)$/i.test(name)) {
      setIsBinary(true);
      setWritable(false);
      setContent('');
      setSavedContent('');
      setBackups([]);
      setLoading(false);
      return;
    }

    try {
      const targetName = cat === 'mixin' || cat === 'run_config' ? '' : name;
      const f = await nikkiApi.readFileAll(cat, targetName);
      setContent(f.content || '');
      setSavedContent(f.content || '');
      setRevision(f.revision || '');
      setWritable(f.writable);
      setFileSize(f.size || 0);
      if (f.writable) {
        const b = await nikkiApi.listBackups(cat, cat === 'mixin' ? '' : name);
        setBackups(b.backups || []);
      } else {
        setBackups([]);
      }
    } catch (err) {
      const msg = (err as Error).message || '读取文件失败';
      if (msg.includes('Binary') || msg.includes('BINARY_FILE')) {
        setIsBinary(true);
        setWritable(false);
        setContent('');
        setSavedContent('');
        setBackups([]);
      } else {
        setLoadError(msg);
        notifyRef.current('error', msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

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
  }, [selected.category, selected.name, loadFile]);

  const validateClientYaml = useCallback(
    (text: string): boolean => {
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
    },
    [selected.category, selected.name]
  );

  const handleSave = useCallback(async () => {
    if (!writable || isBinary || saving) return;
    if (!validateClientYaml(content)) {
      notifyRef.current('error', '前端 YAML 语法检查未通过，请修复后再保存');
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
      setSavedContent(content);
      setFileSize(res.size);
      notifyRef.current('success', `文件已校验并原子保存（${formatBytes(res.size)}）`);
      const b = await nikkiApi.listBackups(selected.category, targetName);
      setBackups(b.backups || []);
      void loadCatalog();
    } catch (err) {
      notifyRef.current('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [writable, isBinary, saving, validateClientYaml, content, selected.category, selected.name, revision, loadCatalog]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (writable && !isBinary && !saving) void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [writable, isBinary, saving, handleSave]);

  const handleRestore = async () => {
    if (!restoreId) return;
    try {
      const targetName = selected.category === 'mixin' ? '' : selected.name;
      await nikkiApi.restoreBackup(selected.category, targetName, restoreId);
      notifyRef.current('success', `已恢复备份 ${restoreId}`);
      setRestoreId(null);
      await loadFile(selected.category, selected.name);
    } catch (err) {
      notifyRef.current('error', (err as Error).message);
    }
  };

  const requestSwitchFile = (next: { category: string; name: string }) => {
    if (dirty) {
      setPendingTarget(next);
    } else {
      setSelected(next);
    }
  };

  const handleTextareaKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && writable) {
      e.preventDefault();
      const ta = e.currentTarget as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = content.slice(0, start) + '  ' + content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
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

  const lineCount = content ? content.split('\n').length : 0;

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">高级 YAML 编辑器</h1>
          <p class="page-desc">
            编辑 mixin.yaml、本地 Profile 与文本 Provider 文件，支持 Ctrl+S 保存、服务端 yq 二次校验与自动备份
          </p>
        </div>
        <div class="row" style={{ gap: '12px' }}>
          {dirty && <span class="badge badge-lg badge-amber">有未保存更改</span>}
          <button
            type="button"
            class="btn"
            disabled={isBinary || loading}
            onClick={() => {
              if (validateClientYaml(content)) notifyRef.current('success', '前端 YAML 语法检查通过');
            }}
          >
            本地语法检查
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!writable || isBinary || saving || loading}
            onClick={() => void handleSave()}
          >
            {saving ? '校验保存中...' : '保存文件 (Ctrl+S)'}
          </button>
        </div>
      </div>

      {selected.category === 'run_config' && (
        <div class="alert alert-info" role="status">
          <IconInfo className="alert-icon" />
          <div class="alert-body">
            <span class="mono">/etc/nikki/run/config.yaml</span> 为只读运行文件，每次启动 Nikki 时都会重新生成。如需持久化修改，请编辑{' '}
            <span class="mono">mixin.yaml</span> 或原始 Profile。
          </div>
        </div>
      )}

      {selected.category === 'subscription' && (
        <div class="alert alert-warning" role="status">
          <IconWarning className="alert-icon" />
          <div class="alert-body">
            直接编辑订阅缓存文件会在下一次更新订阅时被覆盖，建议将自定义规则写在 <span class="mono">mixin.yaml</span>。
          </div>
        </div>
      )}

      {clientYamlErr && (
        <div class="alert alert-danger" role="alert">
          <IconError className="alert-icon" />
          <div class="alert-body mono" style={{ fontSize: '14px', lineHeight: '22px' }}>
            YAML 语法错误：{clientYamlErr}
          </div>
        </div>
      )}

      <div class="card">
        <div class="row-between" style={{ marginBottom: '16px' }}>
          <select
            class="select"
            aria-label="选择编辑文件"
            style={{ maxWidth: '420px' }}
            value={`${selected.category}::${selected.name}`}
            onChange={(e) => {
              const [category, name] = (e.currentTarget as HTMLSelectElement).value.split('::');
              requestSwitchFile({ category, name });
            }}
          >
            {options.map((g) =>
              g.items.length > 0 ? (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((item) => (
                    <option key={`${g.category}::${item.name}`} value={`${g.category}::${item.name}`}>
                      {item.name} ({formatBytes(item.size)})
                      {item.binary ? ' [二进制]' : item.writable ? '' : ' [只读]'}
                    </option>
                  ))}
                </optgroup>
              ) : null
            )}
          </select>

          <div class="row">
            {!isBinary && !loading && (
              <span class="badge mono">
                {lineCount} 行 · {formatBytes(fileSize || new TextEncoder().encode(content).length)}
              </span>
            )}
            <span class={`badge ${isBinary ? '' : writable ? 'badge-green' : 'badge-amber'}`}>
              {isBinary ? '二进制文件' : writable ? '可写' : '只读'}
            </span>
            <button
              type="button"
              class="btn btn-sm"
              onClick={() => void loadFile(selected.category, selected.name)}
              disabled={loading}
            >
              重新读取
            </button>
          </div>
        </div>

        {loading ? (
          <StateView kind="loading" title="正在读取文件内容" />
        ) : isBinary ? (
          <StateView
            kind="empty"
            title={`${selected.name} 是二进制文件`}
            message="Mihomo 的 .mrs / .dat / .mmdb 二进制文件不支持纯文本编辑；若需更新请前往「规则与提供者」点击更新。"
          />
        ) : loadError ? (
          <StateView
            kind="error"
            title="读取文件失败"
            message={loadError}
            actionLabel="重试"
            onAction={() => void loadFile(selected.category, selected.name)}
          />
        ) : (
          <textarea
            class="textarea"
            aria-label="YAML 编辑区域"
            style={{ minHeight: '480px', tabSize: 2 }}
            spellcheck={false}
            readOnly={!writable}
            value={content}
            onKeyDown={handleTextareaKeyDown}
            onInput={(e) => {
              const v = (e.currentTarget as HTMLTextAreaElement).value;
              setContent(v);
              if (clientYamlErr) validateClientYaml(v);
            }}
          />
        )}
      </div>

      {dirty && (
        <div class="sticky-savebar">
          <div style={{ fontSize: '14px', fontWeight: 500 }}>
            当前文件 <span class="mono">{selected.name}</span> 有未保存更改
          </div>
          <div class="row" style={{ gap: '8px' }}>
            <button
              type="button"
              class="btn"
              onClick={() => {
                setContent(savedContent);
                setClientYamlErr(null);
              }}
            >
              还原修改
            </button>
            <button type="button" class="btn btn-primary" disabled={saving} onClick={() => void handleSave()}>
              {saving ? '保存中...' : '校验并保存'}
            </button>
          </div>
        </div>
      )}

      {writable && !isBinary && backups.length > 0 && (
        <section class="card-flush" aria-label="历史备份列表">
          <div class="card-toolbar">
            <h2 class="card-title">历史备份（最多保留 5 份）</h2>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>备份 ID</th>
                  <th class="th-right">大小</th>
                  <th class="th-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td class="mono">{b.id}</td>
                    <td class="mono td-right">{formatBytes(b.size)}</td>
                    <td class="td-right">
                      <button type="button" class="op-btn" onClick={() => setRestoreId(b.id)}>
                        恢复此备份
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ConfirmModal
        open={restoreId !== null}
        title="恢复历史备份？"
        message={`将使用备份 ${restoreId} 覆盖当前文件内容（当前内容会先自动再备份一份）。`}
        confirmLabel="恢复备份"
        onConfirm={handleRestore}
        onCancel={() => setRestoreId(null)}
      />

      <ConfirmModal
        open={pendingTarget !== null}
        title="放弃当前未保存的修改？"
        message={`切换到 ${pendingTarget?.name || ''} 将丢弃对 ${selected.name} 的未保存修改。`}
        danger
        confirmLabel="放弃并切换"
        onConfirm={() => {
          if (pendingTarget) setSelected(pendingTarget);
          setPendingTarget(null);
        }}
        onCancel={() => setPendingTarget(null)}
      />
    </div>
  );
}
