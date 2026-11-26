import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { usePolling } from '../hooks/usePolling';
import { TrafficChart } from '../components/TrafficChart';
import { StateView } from '../components/StateView';
import { ConfirmModal } from '../components/ConfirmModal';
import { IconError, IconWarning } from '../components/Icons';
import { formatBytes, formatDuration } from '../utils/format';
import type {
  AsyncTask,
  CapabilitiesResponse,
  NetworkProbeResponse,
  OverviewMetricsResponse,
  ProxyMode,
  ServiceCheckItem,
  StatusResponse
} from '../api/types';

function formatClock(epochSec?: number): string {
  if (!epochSec) return '—';
  const d = new Date(epochSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ispTypeBadgeClass(code?: string): string {
  if (code === 'residential') return 'badge-green';
  if (code === 'business' || code === 'education' || code === 'mobile') return 'badge-accent';
  if (code === 'hosting') return 'badge-amber';
  if (code === 'vpn' || code === 'tor') return 'badge-red';
  return '';
}

function riskBadgeClass(level?: string): string {
  if (level === 'low') return 'badge-green';
  if (level === 'medium') return 'badge-amber';
  if (level === 'high' || level === 'critical') return 'badge-red';
  return '';
}

function riskFillClass(level?: string): string {
  if (level === 'low') return 'progress-fill-success';
  if (level === 'medium') return 'progress-fill-warning';
  if (level === 'high' || level === 'critical') return 'progress-fill-danger';
  return '';
}

function serviceBadge(svc: ServiceCheckItem): { cls: string; text: string } {
  if (svc.status_kind === 'fail' || !svc.ok) {
    return { cls: 'badge-red', text: svc.http_code > 0 ? `HTTP ${svc.http_code}` : '不可达' };
  }
  if (svc.status_kind === 'restricted') {
    const ms = svc.latency_ms != null ? `${svc.latency_ms} ms` : '';
    return { cls: 'badge-amber', text: ms ? `受限 ${ms}` : `受限 ${svc.http_code}` };
  }
  const ms = svc.latency_ms ?? 0;
  const cls = ms < 300 ? 'badge-green' : ms < 900 ? 'badge-amber' : 'badge-red';
  return { cls, text: `${ms} ms` };
}

function routeModeLabel(mode?: string): string {
  if (mode === 'transparent') return '透明代理路径';
  if (mode === 'local_proxy') return 'Mihomo 代理端口';
  if (mode === 'direct') return '路由器直连';
  return '';
}

export function OverviewPage(props: {
  capabilities?: CapabilitiesResponse | null;
  status: StatusResponse | null;
  statusError: string | null;
  profileDisplayName?: string;
  busyAction?: boolean;
  onRefreshStatus: () => void;
  onToggleService: (next: boolean) => void;
  onServiceAction: (act: 'restart' | 'reload' | 'enable' | 'disable') => void;
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

  const [probe, setProbe] = useState<NetworkProbeResponse | null>(null);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const autoProbedRef = useRef(false);

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

  // Load cached network probe on mount; auto-trigger if idle or older than 5 minutes
  const triggerProbe = useCallback(async () => {
    setProbeErr(null);
    try {
      const res = await nikkiApi.runNetworkProbe();
      setProbe(res);
    } catch (err) {
      setProbeErr((err as Error)?.message || '启动网络质量检测失败');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const res = await nikkiApi.getNetworkProbe();
        if (!active) return;
        setProbe(res);
        setProbeErr(null);
        const ageSec = res.updated_at ? Math.floor(Date.now() / 1000) - res.updated_at : 999999;
        if (!autoProbedRef.current && (res.status === 'idle' || (res.status === 'done' && ageSec > 300))) {
          autoProbedRef.current = true;
          await triggerProbe();
        }
      } catch (err) {
        if (!active) return;
        setProbeErr((err as Error)?.message || '读取网络检测状态失败');
      }
    };
    void init();
    return () => {
      active = false;
    };
  }, [triggerProbe]);

  const probeRunning = probe?.status === 'running';
  const fetchProbe = useCallback((signal: AbortSignal) => nikkiApi.getNetworkProbe({ signal, timeoutMs: 6000 }), []);

  usePolling(
    fetchProbe,
    (res) => {
      setProbe(res);
      setProbeErr(res.status === 'error' ? res.error || '网络检测失败' : null);
    },
    (err) => {
      setProbeErr((err as Error)?.message || '读取检测结果失败');
    },
    { intervalMs: 900, enabled: probeRunning }
  );

  const handleCopyIp = (ip?: string) => {
    if (!ip) return;
    void navigator.clipboard?.writeText(ip);
    props.notify('success', `已复制 IP：${ip}`);
  };

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

  const dom = probe?.domestic;
  const ov = probe?.overseas;
  const services = probe?.services ?? [];
  const domServices = services.filter((s) => s.group === 'domestic');
  const ovServices = services.filter((s) => s.group === 'overseas');
  const okSvcCount = services.filter((s) => s.ok).length;

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">运行总览</h1>
          <p class="page-desc">实时监控 Nikki 透明代理状态、出口 IP 纯净度、服务连通性与策略组</p>
        </div>
        <div class="row" style={{ gap: '12px' }}>
          <label class="switch" title="路由器重启后自动启动 Nikki">
            <input
              type="checkbox"
              checked={st.autostart === true}
              disabled={props.busyAction}
              aria-label="Nikki 开机自启"
              onChange={(e) => {
                const target = e.currentTarget as HTMLInputElement;
                const desired = target.checked;
                target.checked = st.autostart === true;
                props.onServiceAction(desired ? 'enable' : 'disable');
              }}
            />
            <span class="switch-track" />
            <span>开机自启</span>
          </label>
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

      {/* Top 4 KPI Metric Cards */}
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

      {/* Exit IP, Fraud Score, ISP Type & Common Services Connectivity */}
      <section class="card" style={{ marginTop: '24px' }} aria-label="出口 IP 与网络质量">
        <div class="card-header">
          <div class="row" style={{ gap: '12px' }}>
            <h2 class="card-title">出口 IP 与纯净度检测</h2>
            {probe?.route_mode && <span class="badge">{routeModeLabel(probe.route_mode)}</span>}
            {probe?.updated_at ? (
              <span class="mono" style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                检测于 {formatClock(probe.updated_at)}
              </span>
            ) : null}
          </div>
          <button type="button" class="btn" disabled={probeRunning} onClick={() => void triggerProbe()}>
            {probeRunning ? (
              <>
                <span class="spinner" /> 检测中...
              </>
            ) : (
              '重新检测'
            )}
          </button>
        </div>

        {probeErr && (
          <div class="alert alert-danger" role="alert">
            <IconError className="alert-icon" />
            <div class="alert-body">{probeErr}</div>
          </div>
        )}

        {!dom && !ov && probeRunning ? (
          <div class="grid-2" aria-busy="true" aria-label="正在检测国内外出口 IP">
            {[0, 1].map((i) => (
              <div key={i} class="sub-card">
                <div class="skeleton-row">
                  <span class="sk" style={{ width: '36%', height: '16px' }} />
                  <span class="sk" style={{ width: '24%', height: '22px', marginLeft: 'auto', borderRadius: '999px' }} />
                </div>
                <div class="skeleton-row">
                  <span class="sk" style={{ width: '58%', height: '22px' }} />
                </div>
                <div class="skeleton-row">
                  <span class="sk" style={{ width: '80%', height: '14px' }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div class="grid-2">
            {/* Domestic IP Card */}
            <div class="sub-card">
              <div class="row-between" style={{ marginBottom: '12px' }}>
                <span style={{ fontSize: '16px', lineHeight: '24px', fontWeight: 500 }}>国内直连 IP</span>
                <span class={`badge ${dom?.ok ? 'badge-green' : ''}`}>{dom?.ok ? '直连正常' : '未获取'}</span>
              </div>

              <div class="ip-headline">
                <span class="ip-value mono">{dom?.ip || '—'}</span>
                {dom?.ip && (
                  <button type="button" class="btn btn-ghost" onClick={() => handleCopyIp(dom.ip)}>
                    复制
                  </button>
                )}
              </div>

              <dl class="kv-grid" style={{ gridTemplateColumns: '84px minmax(0, 1fr)' }}>
                <dt class="kv-key">归属地</dt>
                <dd class="kv-val">{dom?.location || '—'}</dd>
                <dt class="kv-key">运营商</dt>
                <dd class="kv-val">{dom?.isp || '—'}</dd>
                <dt class="kv-key">ASN</dt>
                <dd class="kv-val mono">{dom?.asn || '—'}</dd>
                <dt class="kv-key">数据来源</dt>
                <dd class="kv-val mono" style={{ color: 'var(--text-muted)' }}>
                  {dom?.source || '—'}
                </dd>
              </dl>
            </div>

            {/* Overseas / Proxy Exit IP Card */}
            <div class="sub-card">
              <div class="row-between" style={{ marginBottom: '12px' }}>
                <span style={{ fontSize: '16px', lineHeight: '24px', fontWeight: 500 }}>国外 / 代理出口 IP</span>
                <div class="row" style={{ gap: '6px' }}>
                  {ov?.ok && <span class={`badge ${ispTypeBadgeClass(ov.isp_type)}`}>{ov.isp_type_label}</span>}
                  {ov?.ok && ov.fraud_score != null && (
                    <span class={`badge mono ${riskBadgeClass(ov.risk_level)}`}>
                      欺诈分 {ov.fraud_score}
                    </span>
                  )}
                </div>
              </div>

              <div class="ip-headline">
                <span class="ip-value mono">{ov?.ip || '—'}</span>
                {ov?.ip && (
                  <button type="button" class="btn btn-ghost" onClick={() => handleCopyIp(ov.ip)}>
                    复制
                  </button>
                )}
              </div>

              <dl class="kv-grid" style={{ gridTemplateColumns: '84px minmax(0, 1fr)' }}>
                <dt class="kv-key">归属地</dt>
                <dd class="kv-val">
                  {ov?.location || '—'}
                  {ov?.country_code ? <span class="mono" style={{ color: 'var(--text-muted)' }}> ({ov.country_code})</span> : null}
                </dd>
                <dt class="kv-key">运营商</dt>
                <dd class="kv-val">
                  {ov?.asn ? <span class="mono">{ov.asn}</span> : null}
                  {ov?.asn && (ov?.isp || ov?.org) ? ' · ' : ''}
                  {ov?.isp || ov?.org || (ov?.asn ? '' : '—')}
                </dd>
                <dt class="kv-key">ISP 类型</dt>
                <dd class="kv-val">
                  {ov?.ok ? (
                    <div class="row" style={{ gap: '6px' }}>
                      <span class={`badge ${ispTypeBadgeClass(ov.isp_type)}`}>{ov.isp_type_label}</span>
                      <span class={`badge ${ov.flags.is_proxy || ov.flags.is_vpn ? 'badge-amber' : 'badge-green'}`}>
                        {ov.flags.is_vpn ? 'VPN 出口' : ov.flags.is_proxy ? '代理 IP' : '非代理'}
                      </span>
                      {ov.flags.is_datacenter && <span class="badge badge-amber">数据中心</span>}
                      {ov.flags.is_mobile && <span class="badge badge-accent">移动网络</span>}
                      {ov.flags.is_tor && <span class="badge badge-red">Tor</span>}
                    </div>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt class="kv-key">IP 欺诈分</dt>
                <dd class="kv-val">
                  {ov?.ok && ov.fraud_score != null ? (
                    <div class="stack" style={{ gap: '6px' }}>
                      <div class="row-between">
                        <span class="mono" style={{ fontWeight: 500 }}>
                          {ov.fraud_score} / 100
                        </span>
                        <span class={`badge ${riskBadgeClass(ov.risk_level)}`}>{ov.risk_label}</span>
                      </div>
                      <div
                        class="progress-bar"
                        role="progressbar"
                        aria-label="IP 欺诈分"
                        aria-valuenow={ov.fraud_score}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          class={`progress-fill ${riskFillClass(ov.risk_level)}`}
                          style={{ width: `${Math.max(4, Math.min(100, ov.fraud_score))}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt class="kv-key">检测来源</dt>
                <dd class="kv-val mono" style={{ color: 'var(--text-muted)' }}>
                  {ov?.sources?.length ? ov.sources.join(' · ') : '—'}
                </dd>
              </dl>
            </div>
          </div>
        )}
      </section>

      {/* Common Services Connectivity */}
      <section class="card" style={{ marginTop: '24px' }} aria-label="常见服务连通性">
        <div class="card-header">
          <div class="row" style={{ gap: '12px' }}>
            <h2 class="card-title">常见服务连通性</h2>
            {services.length > 0 && (
              <span class={`badge mono ${okSvcCount === services.length ? 'badge-green' : okSvcCount > 0 ? 'badge-amber' : 'badge-red'}`}>
                可达 {okSvcCount} / {services.length}
              </span>
            )}
          </div>
          <button type="button" class="btn btn-ghost" disabled={probeRunning} onClick={() => void triggerProbe()}>
            {probeRunning ? '检测中...' : '刷新连通性'}
          </button>
        </div>

        {services.length === 0 ? (
          probeRunning ? (
            <div class="probe-grid" aria-busy="true" aria-label="正在测试常见服务连通性">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} class="probe-tile">
                  <span class="sk" style={{ width: '48%', height: '14px' }} />
                  <span class="sk" style={{ width: '32%', height: '22px', borderRadius: '999px' }} />
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '16px', lineHeight: '26px', color: 'var(--text-muted)' }}>
              点击「刷新连通性」测试国内与海外常见服务的访问状态与延迟。
            </p>
          )
        ) : (
          <div class="stack" style={{ gap: '20px' }}>
            {domServices.length > 0 && (
              <div>
                <div class="probe-group-label">国内服务</div>
                <div class="probe-grid">
                  {domServices.map((svc) => {
                    const b = serviceBadge(svc);
                    return (
                      <div key={svc.id} class="probe-tile" title={`HTTP ${svc.http_code || '超时'}`}>
                        <span class="probe-name">{svc.name}</span>
                        <span class={`badge mono ${b.cls}`}>{b.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {ovServices.length > 0 && (
              <div>
                <div class="probe-group-label">海外与常用服务</div>
                <div class="probe-grid">
                  {ovServices.map((svc) => {
                    const b = serviceBadge(svc);
                    return (
                      <div key={svc.id} class="probe-tile" title={`HTTP ${svc.http_code || '超时'}`}>
                        <span class="probe-name">{svc.name}</span>
                        <span class={`badge mono ${b.cls}`}>{b.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Traffic Sparkline & Health Summary */}
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

      {/* Strategy Groups Quick Entry */}
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
