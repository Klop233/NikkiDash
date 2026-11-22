import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { usePolling } from '../hooks/usePolling';
import { ConfirmModal } from '../components/ConfirmModal';
import { downloadTextFile, formatBytes } from '../utils/format';

export function LogsDiagnosticsPage(props: {
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [source, setSource] = useState<'app' | 'core'>('app');
  const [lines, setLines] = useState<string[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [level, setLevel] = useState<'all' | 'error' | 'warn' | 'info' | 'debug'>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [diagBusy, setDiagBusy] = useState(false);
  const [diagMd, setDiagMd] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const fetcher = useCallback(
    (signal: AbortSignal) => nikkiApi.getLogs(source, 500, { signal }),
    [source]
  );

  const { refresh } = usePolling(
    fetcher,
    (res) => {
      setLines(res.lines || []);
      setTotalBytes(res.total_bytes || 0);
      setTruncated(res.truncated || false);
      setPollError(null);
    },
    (err) => {
      setPollError((err as Error).message || '读取日志失败');
    },
    { intervalMs: 4000, enabled: !paused, refreshKey: source }
  );

  const filteredLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((line) => {
      const low = line.toLowerCase();
      if (level === 'error' && !low.includes('err') && !low.includes('fail')) return false;
      if (level === 'warn' && !low.includes('warn')) return false;
      if (level === 'info' && !low.includes('info')) return false;
      if (level === 'debug' && !low.includes('debug')) return false;
      if (q && !low.includes(q)) return false;
      return true;
    });
  }, [lines, level, search]);

  useEffect(() => {
    if (autoScroll && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [filteredLines, autoScroll]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await nikkiApi.clearLogs(source);
      setLines([]);
      setTotalBytes(0);
      setClearOpen(false);
      props.notify('success', `已清空 ${source === 'app' ? 'App' : 'Core'} 日志`);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setClearing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(filteredLines.join('\n'));
      props.notify('success', '已复制当前日志内容');
    } catch {
      props.notify('error', '无法访问剪贴板，请使用下载按钮');
    }
  };

  const handleGenerateDiag = async () => {
    setDiagBusy(true);
    try {
      const res = await nikkiApi.getDiagnostics();
      setDiagMd(res.markdown);
      props.notify('success', '已生成脱敏诊断包（不会重启或改动 Nikki）');
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setDiagBusy(false);
    }
  };

  const classifyLine = (l: string) => {
    const low = l.toLowerCase();
    if (low.includes('error') || low.includes('fatal') || low.includes('failed')) return 'log-line-err';
    if (low.includes('warn')) return 'log-line-warn';
    if (low.includes('info')) return 'log-line-info';
    return '';
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">日志与诊断</h2>
          <p class="page-desc">实时查看经过脱敏处理的 Nikki 应用日志与 Mihomo 核心日志，支持一键生成脱敏诊断包</p>
        </div>
        <div class="row">
          <button class={`btn ${paused ? 'btn-primary' : ''}`} onClick={() => setPaused((p) => !p)}>
            {paused ? '继续刷新' : '暂停刷新'}
          </button>
          <button class="btn btn-primary" onClick={handleGenerateDiag} disabled={diagBusy}>
            {diagBusy ? '正在生成诊断包...' : '生成脱敏诊断包'}
          </button>
        </div>
      </div>

      <div class="tabs">
        <button class={`tab-btn ${source === 'app' ? 'active' : ''}`} onClick={() => setSource('app')}>
          Nikki 应用日志 (app.log)
        </button>
        <button class={`tab-btn ${source === 'core' ? 'active' : ''}`} onClick={() => setSource('core')}>
          Mihomo 核心日志 (core.log)
        </button>
      </div>

      {pollError && (
        <div class="alert alert-danger">
          <div>读取日志异常：{pollError}</div>
          <button class="btn btn-sm" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      )}

      <div class="card">
        <div class="row-between" style={{ marginBottom: '12px' }}>
          <div class="row">
            <input
              class="input"
              style={{ maxWidth: '240px' }}
              placeholder="搜索关键词..."
              value={search}
              onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
            />
            <select
              class="select"
              style={{ maxWidth: '130px' }}
              value={level}
              onChange={(e) => setLevel((e.currentTarget as HTMLSelectElement).value as typeof level)}
            >
              <option value="all">全部级别</option>
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
            <label class="row" style={{ cursor: 'pointer', fontSize: '12.5px' }}>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll((e.currentTarget as HTMLInputElement).checked)}
              />
              <span>自动滚动</span>
            </label>
          </div>
          <div class="row">
            <span class="badge">
              {filteredLines.length} 行 · {formatBytes(totalBytes)} {truncated ? '(已截断尾部)' : ''}
            </span>
            <button class="btn btn-sm" onClick={() => void refresh()}>
              刷新
            </button>
            <button class="btn btn-sm" onClick={() => void handleCopy()}>
              复制
            </button>
            <button
              class="btn btn-sm"
              onClick={() => downloadTextFile(`nikki-${source}.log`, filteredLines.join('\n'))}
            >
              下载
            </button>
            <button class="btn btn-sm btn-danger" onClick={() => setClearOpen(true)}>
              清空日志
            </button>
          </div>
        </div>

        <div class="log-box" ref={boxRef} role="log">
          {filteredLines.length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>暂无日志记录</div>
          ) : (
            filteredLines.map((line, i) => (
              <div key={i} class={classifyLine(line)}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>

      {diagMd && (
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">诊断包预览（敏感凭据、密钥、订阅 URL、客户端 IP/MAC 均已脱敏）</h3>
            <div class="row">
              <button
                class="btn btn-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(diagMd);
                  props.notify('success', '已复制诊断报告');
                }}
              >
                复制 Markdown
              </button>
              <button
                class="btn btn-sm btn-primary"
                onClick={() => downloadTextFile(`nikki-dash-diagnostics-${Date.now()}.md`, diagMd, 'text/markdown;charset=utf-8')}
              >
                下载 .md
              </button>
              <button class="btn btn-sm btn-ghost" onClick={() => setDiagMd(null)}>
                关闭
              </button>
            </div>
          </div>
          <pre class="log-box" style={{ height: '320px', margin: 0 }}>
            {diagMd}
          </pre>
        </div>
      )}

      <ConfirmModal
        open={clearOpen}
        title={`清空 ${source === 'app' ? 'app.log' : 'core.log'}？`}
        message="清空后无法恢复，不会影响 Nikki 运行状态。"
        danger
        busy={clearing}
        confirmLabel="确认清空"
        onConfirm={handleClear}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}
