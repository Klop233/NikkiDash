import { useCallback, useEffect, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { StateView } from '../components/StateView';
import { ConfirmModal } from '../components/ConfirmModal';
import { IconError, IconSuccess, IconWarning } from '../components/Icons';
import type {
  AccessConfig,
  AccessMode,
  AsyncTask,
  CapabilitiesResponse,
  LangCode,
  SessionState,
  ThemeMode
} from '../api/types';

export function PanelSettingsPage(props: {
  session: SessionState;
  capabilities?: CapabilitiesResponse | null;
  theme: ThemeMode;
  lang: LangCode;
  onThemeChange: (t: ThemeMode) => void;
  onLangChange: (l: LangCode) => void;
  onSwitchToAdminLogin: () => void;
  onTrackTask?: (task: AsyncTask) => void;
  onRefreshCapabilities?: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [access, setAccess] = useState<AccessConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [coreVariant, setCoreVariant] = useState<'meta' | 'alpha'>(
    props.capabilities?.platform?.mihomo_variant === 'alpha' ? 'alpha' : 'meta'
  );
  const [coreBusy, setCoreBusy] = useState(false);
  const [removeLuciModal, setRemoveLuciModal] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  const [mode, setMode] = useState<AccessMode>('lan_auth');
  const [httpPort, setHttpPort] = useState(18080);
  const [httpsPort, setHttpsPort] = useState(18443);
  const [ifaces, setIfaces] = useState('lan');
  const [cert, setCert] = useState('/etc/nikki-dash/server.crt');
  const [key, setKey] = useState('/etc/nikki-dash/server.key');
  const [timeout, setTimeoutVal] = useState(3600);
  const [confirmWan, setConfirmWan] = useState(false);
  const [genCert, setGenCert] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await nikkiApi.getAccess();
      const a = res.access;
      setAccess(a);
      setMode(a.access_mode);
      setHttpPort(a.http_port);
      setHttpsPort(a.https_port);
      setIfaces((a.listen_interfaces || ['lan']).join(', '));
      setCert(a.cert);
      setKey(a.key);
      setTimeoutVal(a.session_timeout);
      setConfirmWan(a.wan_risk_acknowledged);
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

  const handleSave = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await nikkiApi.setAccess({
        access_mode: mode,
        http_port: Number(httpPort),
        https_port: Number(httpsPort),
        listen_interfaces: ifaces
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        cert: cert.trim(),
        key: key.trim(),
        session_timeout: Number(timeout),
        confirm_wan_risk: confirmWan,
        generate_self_signed: genCert,
        theme: props.theme,
        lang: props.lang
      });
      setAccess(res.access);
      if (res.restarting) {
        const host = typeof window !== 'undefined' ? window.location.hostname : '192.168.1.1';
        const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
        const nextUrl = `${res.next_scheme}://${formattedHost}:${res.next_port}/`;
        setRedirectUrl(nextUrl);
        props.notify('info', `面板访问配置已保存，独立 uhttpd 正在重载到 ${nextUrl}`);
      } else {
        setRedirectUrl(null);
        props.notify('success', '面板设置已保存');
      }
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleInstallOrUpgradeCore = async () => {
    setCoreBusy(true);
    try {
      const res = await nikkiApi.installCore(coreVariant, `panel_core_${coreVariant}_${Math.floor(Date.now() / 5000)}`);
      if (props.onTrackTask) props.onTrackTask(res.task);
      props.notify('info', `已提交 Nikki 核心 + mihomo-${coreVariant} 安装/更新任务...`);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setCoreBusy(false);
    }
  };

  const handleRemoveLuci = async () => {
    setCoreBusy(true);
    try {
      const res = await nikkiApi.removeLuciNikki(`rm_luci_${Math.floor(Date.now() / 5000)}`);
      if (props.onTrackTask) props.onTrackTask(res.task);
      props.notify('info', '已提交旧版 luci-app-nikki 卸载任务（将保留 nikki 核心与配置）...');
      setRemoveLuciModal(false);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setCoreBusy(false);
    }
  };

  const plat = props.capabilities?.platform;

  if (loading && !access) return <StateView kind="loading" title="正在加载面板设置" />;
  if (error && !access) return <StateView kind="error" title="无法读取面板设置" message={error} actionLabel="重试" onAction={load} />;

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">面板访问与安全设置</h1>
          <p class="page-desc">配置独立 uhttpd 端口、LAN / WAN HTTPS / LAN 免登录访问模式、主题与语言</p>
        </div>
      </div>

      {props.session.isGuest && (
        <div class="alert alert-warning" role="status">
          <IconWarning className="alert-icon" />
          <div class="alert-body">
            <strong>当前为 LAN 免登录受限身份：</strong>
            修改端口、切换 WAN 模式或停用免登录需要路由器管理员身份。
          </div>
          <button type="button" class="btn" onClick={props.onSwitchToAdminLogin}>
            切换为管理员登录
          </button>
        </div>
      )}

      {redirectUrl && (
        <div class="alert alert-success" role="status">
          <IconSuccess className="alert-icon" />
          <div class="alert-body">
            <strong>独立 uhttpd 正在重载到新监听地址：</strong>
            <span class="mono">{redirectUrl}</span>（约 2 秒后生效）
          </div>
          <a class="btn" href={redirectUrl}>
            前往新地址
          </a>
        </div>
      )}

      {access?.last_service_error && (
        <div class="alert alert-danger" role="alert">
          <IconError className="alert-icon" />
          <div class="alert-body">
            <strong>最近一次面板启动错误：</strong> {access.last_service_error}
          </div>
        </div>
      )}

      <form class="stack" onSubmit={handleSave}>
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">访问模式（三选一，严格互斥）</h2>
            <span class="badge badge-accent mono">当前监听：{(access?.effective_listen_addrs || []).join(', ') || '—'}</span>
          </div>

          <div class="grid-3">
            {(
              [
                ['lan_auth', '仅 LAN 认证（推荐默认）', '仅监听 LAN 接口，需路由器账号密码登录。自动禁用免登录身份。'],
                ['lan_guest', '仅 LAN 免登录', '仅监听 LAN 接口，启用受限的 nikki-dash-guest 会话（无通用 uci/file/exec 权限），严禁与 WAN 共存。'],
                ['wan_https', 'WAN HTTPS 认证', '启用全接口 HTTPS 监听，强制路由器管理员登录并撤销免登录身份。不会自动放行防火墙。']
              ] as Array<[AccessMode, string, string]>
            ).map(([m, title, desc]) => (
              <label
                key={m}
                class={`node-card ${mode === m ? 'selected' : ''}`}
                style={{ cursor: props.session.isGuest ? 'not-allowed' : 'pointer' }}
              >
                <div class="row">
                  <input
                    type="radio"
                    name="access_mode"
                    checked={mode === m}
                    disabled={props.session.isGuest}
                    onChange={() => setMode(m)}
                  />
                  <span style={{ fontWeight: 500, fontSize: '14px' }}>{title}</span>
                </div>
                <div style={{ fontSize: '14px', lineHeight: '22px', color: 'var(--text-muted)' }}>{desc}</div>
              </label>
            ))}
          </div>

          {mode === 'wan_https' && (
            <div class="alert alert-danger" role="alert" style={{ marginTop: '16px', marginBottom: 0 }}>
              <IconError className="alert-icon" />
              <div class="alert-body stack" style={{ gap: '8px' }}>
                <div>
                  <strong>安全边界声明：</strong>
                  标准 <span class="mono">uhttpd /ubus</span> 是通用 ubus 入口。通过路由器 <span class="mono">root</span>{' '}
                  账号登录后，该会话拥有完整路由器管理员权限（NikkiDash ACL 不会缩小 root 权限），请确保仅限受信任管理员访问。
                </div>
                <div>
                  <strong>防火墙说明：</strong>
                  NikkiDash 不会自动添加 WAN 防火墙放行规则、UPnP 或 DDNS，请在 OpenWrt 防火墙中手动配置受控访问（或使用 VPN / WireGuard）。
                </div>
                <label class="check-row">
                  <input
                    type="checkbox"
                    checked={confirmWan}
                    disabled={props.session.isGuest}
                    onChange={(e) => setConfirmWan((e.currentTarget as HTMLInputElement).checked)}
                  />
                  <span>我已理解 WAN HTTPS 的管理员权限边界，并确认由受信任管理员访问</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">端口、接口与 TLS 证书</h2>
          </div>
          <div class="grid-2">
            <div class="field">
              <label class="field-label">HTTP 端口 (LAN 模式)</label>
              <input
                class="input mono"
                type="number"
                min={1024}
                max={65535}
                disabled={props.session.isGuest}
                value={httpPort}
                onInput={(e) => setHttpPort(Number((e.currentTarget as HTMLInputElement).value))}
              />
            </div>
            <div class="field">
              <label class="field-label">HTTPS 端口 (WAN 模式)</label>
              <input
                class="input mono"
                type="number"
                min={1024}
                max={65535}
                disabled={props.session.isGuest}
                value={httpsPort}
                onInput={(e) => setHttpsPort(Number((e.currentTarget as HTMLInputElement).value))}
              />
            </div>
            <div class="field">
              <label class="field-label">LAN 监听网络接口（逗号分隔）</label>
              <input
                class="input mono"
                disabled={props.session.isGuest}
                value={ifaces}
                onInput={(e) => setIfaces((e.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <div class="field">
              <label class="field-label">会话超时时间（秒，300–86400）</label>
              <input
                class="input mono"
                type="number"
                min={300}
                max={86400}
                disabled={props.session.isGuest}
                value={timeout}
                onInput={(e) => setTimeoutVal(Number((e.currentTarget as HTMLInputElement).value))}
              />
            </div>
            <div class="field">
              <label class="field-label">TLS 证书路径（{access?.cert_exists ? '已存在' : '不存在'}）</label>
              <input
                class="input mono"
                disabled={props.session.isGuest}
                value={cert}
                onInput={(e) => setCert((e.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <div class="field">
              <label class="field-label">TLS 私钥路径（{access?.key_exists ? '已存在' : '不存在'}）</label>
              <input
                class="input mono"
                disabled={props.session.isGuest}
                value={key}
                onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)}
              />
            </div>
          </div>
          {mode === 'wan_https' && (!access?.cert_exists || !access?.key_exists) && (
            <label class="check-row" style={{ marginTop: '12px' }}>
              <input
                type="checkbox"
                checked={genCert}
                disabled={props.session.isGuest}
                onChange={(e) => setGenCert((e.currentTarget as HTMLInputElement).checked)}
              />
              <span>证书不存在时自动生成自签名 EC P-256 证书（需 px5g 或 openssl）</span>
            </label>
          )}
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">界面外观与语言</h2>
          </div>
          <div class="grid-2">
            <div class="field">
              <label class="field-label">主题模式</label>
              <select
                class="select"
                value={props.theme}
                onChange={(e) => props.onThemeChange((e.currentTarget as HTMLSelectElement).value as ThemeMode)}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色模式</option>
                <option value="dark">深色模式</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label">界面语言</label>
              <select
                class="select"
                value={props.lang}
                onChange={(e) => props.onLangChange((e.currentTarget as HTMLSelectElement).value as LangCode)}
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </div>
          </div>
        </div>

        <div class="row" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" class="btn btn-primary" disabled={saving || props.session.isGuest}>
            {saving ? '保存中...' : '保存并应用面板设置'}
          </button>
        </div>
      </form>

      <div class="card" style={{ marginTop: '24px' }}>
        <div class="card-header">
          <h2 class="card-title">Nikki 核心集成与旧版 LuCI 管理</h2>
          <span class={`badge ${plat?.nikki_installed && plat?.mihomo_installed ? 'badge-green' : 'badge-amber'}`}>
            {plat?.nikki_installed && plat?.mihomo_installed ? '核心已就绪' : '未安装核心'}
          </span>
        </div>

        <dl class="kv-grid" style={{ marginBottom: '20px', gridTemplateColumns: '128px minmax(0, 1fr)' }}>
          <dt class="kv-key">系统环境</dt>
          <dd class="kv-val mono">
            {plat ? `${plat.distrib_id} ${plat.distrib_release} / ${plat.arch} / ${plat.pkg_mgr}` : '加载中...'}
          </dd>
          <dt class="kv-key">Nikki 核心包</dt>
          <dd class="kv-val mono">{props.capabilities?.versions.nikki || (plat?.nikki_installed ? '已安装' : '未安装')}</dd>
          <dt class="kv-key">Mihomo 内核</dt>
          <dd class="kv-val mono">
            {props.capabilities?.versions.core || '未安装'}
            {plat?.mihomo_variant ? ` (mihomo-${plat.mihomo_variant})` : ''}
          </dd>
          <dt class="kv-key">官方核心源</dt>
          <dd class="kv-val mono">{plat?.feed_url || '不支持'}</dd>
          <dt class="kv-key">旧版 LuCI 界面</dt>
          <dd class="kv-val">
            {plat?.luci_nikki_installed ? (
              <span class="badge badge-amber">{plat.luci_packages.join(', ')}</span>
            ) : (
              <span class="badge badge-green">未安装 / 已清理</span>
            )}
          </dd>
        </dl>

        <div class="row" style={{ gap: '12px' }}>
          <select
            class="select"
            aria-label="Mihomo 内核分支"
            style={{ maxWidth: '220px' }}
            value={coreVariant}
            disabled={coreBusy || props.session.isGuest}
            onChange={(e) => setCoreVariant((e.currentTarget as HTMLSelectElement).value as 'meta' | 'alpha')}
          >
            <option value="meta">mihomo-meta（稳定版）</option>
            <option value="alpha">mihomo-alpha（测试版）</option>
          </select>
          <button
            type="button"
            class="btn"
            disabled={coreBusy || props.session.isGuest || (plat ? !plat.supported : false)}
            onClick={handleInstallOrUpgradeCore}
          >
            {plat?.nikki_installed && plat?.mihomo_installed ? '更新 Nikki / Mihomo 核心' : '一键安装 Nikki + Mihomo 核心'}
          </button>
          {plat?.luci_nikki_installed && (
            <button
              type="button"
              class="btn btn-danger"
              disabled={coreBusy || props.session.isGuest}
              onClick={() => setRemoveLuciModal(true)}
            >
              卸载旧版 LuCI 界面
            </button>
          )}
          {props.onRefreshCapabilities && (
            <button type="button" class="btn btn-ghost" onClick={props.onRefreshCapabilities}>
              刷新状态
            </button>
          )}
        </div>
      </div>

      <div class="card" style={{ marginTop: '24px' }}>
        <div class="card-header">
          <h2 class="card-title">故障恢复命令（SSH）</h2>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: '16px', lineHeight: '26px', color: 'var(--text)' }}>
          若误配端口或证书导致面板无法访问，不影响 OpenWrt SSH、原 LuCI 与 Nikki 代理运行。通过 SSH 执行以下命令即可恢复默认 LAN 18080 端口：
        </p>
        <pre class="log-box" style={{ height: 'auto', margin: 0 }}>
          {access?.security_notes?.recovery_cli}
        </pre>
      </div>

      <ConfirmModal
        open={removeLuciModal}
        title="卸载旧版 LuCI Nikki 界面？"
        message={`将仅卸载 ${(plat?.luci_packages || []).join(', ')}。核心包 nikki、mihomo 与 /etc/config/nikki 配置文件将完整保留，NikkiDash 面板不受影响。`}
        danger
        busy={coreBusy}
        confirmLabel="卸载旧版 LuCI"
        onConfirm={handleRemoveLuci}
        onCancel={() => setRemoveLuciModal(false)}
      />
    </div>
  );
}
