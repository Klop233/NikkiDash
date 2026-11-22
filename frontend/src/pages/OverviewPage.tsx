import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { usePolling } from '../hooks/usePolling';
import { TrafficChart } from '../components/TrafficChart';
import { StateView } from '../components/StateView';
import { ConfirmModal } from '../components/ConfirmModal';
import { IconError, IconWarning } from '../components/Icons';
import { formatBytes, formatDuration } from '../utils/format';
import type { AsyncTask, CapabilitiesResponse, OverviewMetricsResponse, ProxyMode, StatusResponse } from '../api/types';

export function OverviewPage(props: {
  capabilities?: CapabilitiesResponse | null;
  status: StatusResponse | null;
  statusError: string | null;
  profileDisplayName?: string;
  busyAction?: boolean;
  onRefreshStatus: () => void;
  onToggleService: (next: boolean) => void;
  onServiceAction: (act: 'restart' | 'reload') => void;
  onModeChange: (mode: ProxyMode) => void;
  onNavigate: (page: 'proxies' | 'profiles' | 'logs' | 'onboarding' | 'settings') => void;
  onTrackTask: (task: AsyncTask) => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [metrics, setMetrics] = useState<OverviewMetricsResponse | null>(null);
  const [metricsErr, setMetricsErr] = useState<string | null>(null);
  const [upRate, setUpRate] = useState(0);
  const [downRate, setDownRate] = useState(0);
  const [upHist, setUpHist] = useState<number[]>([0]);
  const [downHist, setDownHist] = useState<number[]>([0]);
  const prevRef = useRef<{ up: number; down: number; ts: number } | null>(null);
  const [fixModal, setFixModal] = useState(false);
  const [fixing, setFixing] = useState(false);

  const running = props.status?.running ?? false;

  useEffect(() => {
    prevRef.current = null;
    if (!running) {
      setUpRate(0);
      setDownRate(0);
      setUpHist([0]);
      setDownHist([0]);
      setMetrics(null);
      setMetricsErr(null);
    }
  }, [running]);

  const fetchMetrics = useCallback((signal: AbortSignal) => nikkiApi.getOverviewMetrics({ signal, timeoutMs: 8000 }), []);

  usePolling(
    fetchMetrics,
    (data) => {
      setMetrics(data);
      setMetricsErr(null);
      const now = Date.now();
      if (prevRef.current) {
        const dt = Math.max(0.5, (now - prevRef.current.ts) / 1000);
        const du = Math.max(0, (data.upload_total - prevRef.current.up) / dt);
        const dd = Math.max(0, (data.download_total - prevRef.current.down) / dt);
        setUpRate(du);
        setDownRate(dd);
        setUpHist((h) => [...h.slice(-29), du]);
        setDownHist((h) => [...h.slice(-29), dd]);
      }
      prevRef.current = { up: data.upload_total, down: data.download_total, ts: now };
    },
    (err) => {
      setMetricsErr((err as Error)?.message || '无法读取 Mihomo 指标');
    },
    { intervalMs: 3000, enabled: running }
  );

  const handleFixBind = async () => {
    setFixing(true);
    try {
      const res = await nikkiApi.fixControllerBind('127.0.0.1:9090', false, true);
      if (res.task) props.onTrackTask(res.task);
      props.notify('info', '已提交控制器监听修复任务，将改为仅监听 127.0.0.1:9090');
      setFixModal(false);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setFixing(false);
    }
  };

  if (!props.status && props.statusError) {
    return <StateView kind="error" title="无法读取 Nikki 状态" message={props.statusError} actionLabel="重试" onAction={props.onRefreshStatus} />;
  }
  if (!props.status) {
    return <StateView kind="loading" title="正在读取路由器状态" message="正在获取 Nikki 运行状态与核心版本" />;
  }

  const st = props.status;
  const coreVer = st.core_version || props.capabilities?.versions.core || '—';
  const profLabel = props.profileDisplayName || (st.profile ? st.profile.replace(/^(file|subscription):/, '') : '未选择');

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">运行总览</h1>
          <p class="page-desc">实时监控 Nikki 透明代理状态、Mihomo 核心流量与策略组</p>
        </div>
        <div class="row" style={{ gap: '12px' }}>
          <button
            type="button"
            class="btn"
            onClick={() => props.onServiceAction('reload')}
            disabled={!st.running || props.busyAction}
          >
            重载配置
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => props.onServiceAction('restart')}
            disabled={props.busyAction}
          >
            重启 Nikki
          </button>
          <button
            type="button"
            class={`btn ${st.running ? 'btn-danger' : 'btn-primary'}`}
            disabled={props.busyAction}
            onClick={() => props.onToggleService(!st.running)}
          >
            {props.busyAction ? (
              <>
                <span class="spinner" /> 处理中...
              </>
            ) : st.running ? (
              '停止代理'
            ) : (
              '启动代理'
            )}
          </button>
        </div>
      </div>

      {props.capabilities &&
        (!props.capabilities.dependencies.nikki_installed || !props.capabilities.dependencies.mihomo_installed) && (
          <div class="alert alert-warning" role="status">
            <IconWarning className="alert-icon" />
            <div class="alert-body">
              <strong>尚未安装 Nikki / Mihomo 核心：</strong>
              NikkiDash 已就绪，可前往引导页一键安装官方 Nikki 与 Mihomo 核心，无需 SSH 手动配置。
            </div>
            <button type="button" class="btn" onClick={() => props.onNavigate('onboarding')}>
              一键安装核心
            </button>
          </div>
        )}

      {st.controller.exposed_warning && (
        <div class="alert alert-warning" role="status">
          <IconWarning className="alert-icon" />
          <div class="alert-body">
            <strong>控制器暴露提醒：</strong>
            Mihomo 外部控制器当前监听 <span class="mono">{st.controller.listen_addr}</span>（非回环地址），建议改为仅监听{' '}
            <span class="mono">127.0.0.1:9090</span>，由 NikkiDash 后端代理访问。
          </div>
          <button type="button" class="btn" onClick={() => setFixModal(true)}>
            修复为 127.0.0.1
          </button>
        </div>
      )}

      {st.health.conflicts.length > 0 && (
        <div class="alert alert-danger" role="alert">
          <IconError className="alert-icon" />
          <div class="alert-body">
            <strong>检测到代理冲突：</strong>
            {st.health.conflicts.map((c) => c.service).join(', ')} 正在运行，请先停止冲突服务避免 nftables 或 DNS 异常。
          </div>
          <button type="button" class="btn" onClick={() => props.onNavigate('onboarding')}>
            查看详情
          </button>
        </div>
      )}

      {st.running && !st.controller.reachable && (
        <div class="alert alert-danger" role="alert">
          <IconError className="alert-icon" />
          <div class="alert-body">
            <strong>Mihomo 控制器不可达：</strong>
            {st.controller.error || '请检查控制器地址、TLS 或密钥配置'}
          </div>
          <button type="button" class="btn" onClick={() => props.onNavigate('logs')}>
            查看日志
          </button>
        </div>
      )}

      <div class="grid-4">
        <div class="card">
          <div class="metric-label">服务状态</div>
          <div class="metric-value" style={{ color: st.running ? 'var(--success)' : 'var(--text-muted)' }}>
            {st.running ? '运行中' : '已停止'}
          </div>
          <div class="metric-sub mono">
            {st.running ? `PID ${st.pid ?? '—'} · ${formatDuration(st.uptime)}` : '代理未接管网络'}
          </div>
        </div>

        <div class="card">
          <div class="metric-label">实时下行 / 上行</div>
          <div class="metric-value mono" style={{ fontSize: '24px' }}>
            {st.running ? formatBytes(downRate, true) : '—'}
          </div>
          <div class="metric-sub mono">
            {st.running ? `上行 ${formatBytes(upRate, true)} · 总计 ${formatBytes(metrics?.download_total ?? 0)}` : '启动后显示实时速率'}
          </div>
        </div>

        <div class="card">
          <div class="metric-label">活跃连接 / 内存</div>
          <div class="metric-value mono">{st.running ? (metrics?.connection_count ?? 0) : '—'}</div>
          <div class="metric-sub mono">
            {st.running ? `内存 ${formatBytes(metrics?.memory ?? 0)}` : `模式：${st.core_only ? '仅核心' : '透明代理'}`}
          </div>
        </div>

        <div class="card">
          <div class="metric-label">活动配置与版本</div>
          <div class="metric-value" style={{ fontSize: '18px', lineHeight: '28px', wordBreak: 'break-all' }}>
            {profLabel}
          </div>
          <div class="metric-sub mono">
            Mihomo {coreVer} · Dash v{st.dash_version}
          </div>
        </div>
      </div>

      <div class="grid-2" style={{ marginTop: '24px' }}>
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">实时速率趋势</h2>
            <div class="row">
              <span class="badge badge-green mono">↓ {formatBytes(downRate, true)}</span>
              <span class="badge badge-accent mono">↑ {formatBytes(upRate, true)}</span>
            </div>
          </div>
          <TrafficChart up={upHist} down={downHist} />
          {metricsErr && st.running && (
            <div style={{ marginTop: '12px', fontSize: '14px', color: 'var(--warning)' }}>
              指标拉取异常：{metricsErr}
            </div>
          )}
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">健康摘要</h2>
            <div class="row">
              <button type="button" class="btn btn-ghost" onClick={() => props.onNavigate('settings')}>
                设置
              </button>
              <button type="button" class="btn btn-ghost" onClick={() => props.onNavigate('logs')}>
                日志与诊断
              </button>
            </div>
          </div>
          <dl class="kv-grid" style={{ gridTemplateColumns: '148px minmax(0, 1fr)' }}>
            <dt class="kv-key">外部控制器</dt>
            <dd class="kv-val row-between">
              <span class="mono">{st.controller.listen_addr || '—'}</span>
              <span class={`badge ${st.health.controller_ok ? 'badge-green' : 'badge-red'}`}>
                {st.health.controller_ok ? '正常' : '离线'}
              </span>
            </dd>

            <dt class="kv-key">透明代理劫持</dt>
            <dd class="kv-val row-between">
              <span class="mono">
                {st.tcp_mode || '—'} / {st.udp_mode || '—'}
              </span>
              <span class={`badge ${st.health.nft_hijack_ok ? 'badge-green' : st.core_only ? 'badge-amber' : 'badge-red'}`}>
                {st.health.nft_hijack_ok ? '已生效' : st.core_only ? '仅核心模式' : '未加载'}
              </span>
            </dd>

            <dt class="kv-key">TUN 虚拟网卡</dt>
            <dd class="kv-val row-between">
              <span>{st.health.tun_up ? '已启动' : '未启用'}</span>
              <span class={`badge ${st.health.tun_up ? 'badge-green' : ''}`}>
                {st.health.tun_up ? 'UP' : 'DOWN'}
              </span>
            </dd>

            <dt class="kv-key">DNS / 运行模式</dt>
            <dd class="kv-val row">
              <span class="badge badge-accent">{st.dns_mode || '未覆盖'}</span>
              <span class="badge">{st.mode}</span>
            </dd>
          </dl>
        </div>
      </div>

      <div class="card" style={{ marginTop: '24px' }}>
        <div class="card-header">
          <h2 class="card-title">常用策略组快捷入口</h2>
          <button type="button" class="btn" onClick={() => props.onNavigate('proxies')}>
            管理全部节点
          </button>
        </div>
        {!st.running ? (
          <p style={{ margin: 0, fontSize: '16px', lineHeight: '26px', color: 'var(--text)' }}>
            Nikki 尚未启动。你可以前往{' '}
            <a
              href="#profiles"
              onClick={(e) => {
                e.preventDefault();
                props.onNavigate('profiles');
              }}
            >
              配置与订阅
            </a>{' '}
            确认配置后，点击右上角「启动代理」。
          </p>
        ) : (metrics?.groups?.length ?? 0) === 0 ? (
          <p style={{ margin: 0, fontSize: '16px', lineHeight: '26px', color: 'var(--text-muted)' }}>当前没有可用的策略组</p>
        ) : (
          <div class="node-grid">
            {metrics!.groups.map((g) => (
              <button
                key={g.name}
                type="button"
                class="node-card"
                onClick={() => props.onNavigate('proxies')}
              >
                <div class="row-between" style={{ width: '100%' }}>
                  <span class="node-name">{g.name}</span>
                  <span class="badge">{g.type}</span>
                </div>
                <div class="node-meta">
                  <span style={{ color: 'var(--accent-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.now || '—'}
                  </span>
                  <span class="mono" style={{ flexShrink: 0 }}>
                    {g.count} 节点
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={fixModal}
        title="将控制器监听改为仅本机回环？"
        message="这将修改 /etc/config/nikki 中 mixin.api_listen 为 127.0.0.1:9090 并重新应用配置。NikkiDash 后端仍可正常管理，局域网设备将无法直接访问 9090 端口。"
        confirmLabel="修复并应用"
        busy={fixing}
        onConfirm={handleFixBind}
        onCancel={() => setFixModal(false)}
      />
    </div>
  );
}
