import { useCallback, useEffect, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { StateView } from '../components/StateView';
import type { AccessConfig, AccessMode, LangCode, SessionState, ThemeMode } from '../api/types';

export function PanelSettingsPage(props: {
  session: SessionState;
  theme: ThemeMode;
  lang: LangCode;
  onThemeChange: (t: ThemeMode) => void;
  onLangChange: (l: LangCode) => void;
  onSwitchToAdminLogin: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [access, setAccess] = useState<AccessConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        props.notify(
          'info',
          `面板访问配置已保存，独立 uhttpd 正在重载到 ${res.next_scheme}://<router>:${res.next_port}`
        );
      } else {
        props.notify('success', '面板设置已保存');
      }
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !access) return <StateView kind="loading" title="正在加载面板设置..." />;
  if (error && !access) return <StateView kind="error" title="无法读取面板设置" message={error} actionLabel="重试" onAction={load} />;

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">面板访问与安全设置</h2>
          <p class="page-desc">配置独立 uhttpd 端口、LAN / WAN HTTPS / LAN 免登录访问模式、主题与语言</p>
        </div>
      </div>

      {props.session.isGuest && (
        <div class="alert alert-warning">
          <div>
            <strong>当前为 LAN 免登录受限身份：</strong>
            为保证安全，修改端口、切换 WAN 模式或停用免登录需要路由器管理员身份。
          </div>
          <button class="btn btn-sm btn-primary" onClick={props.onSwitchToAdminLogin}>
            切换为管理员登录
          </button>
        </div>
      )}

      {access?.last_service_error && (
        <div class="alert alert-danger">
          <div>
            <strong>最近一次面板启动错误：</strong> {access.last_service_error}
          </div>
        </div>
      )}

      <form class="stack" onSubmit={handleSave}>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">访问模式（三选一，严格互斥）</h3>
            <span class="badge badge-accent">当前监听: {(access?.effective_listen_addrs || []).join(', ') || '-'}</span>
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
                  <strong>{title}</strong>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{desc}</div>
              </label>
            ))}
          </div>

          {mode === 'wan_https' && (
            <div class="alert alert-danger" style={{ marginTop: '14px', marginBottom: 0 }}>
              <div class="stack" style={{ gap: '8px' }}>
                <div>
                  <strong>安全边界声明：</strong>
                  标准 <span class="mono">uhttpd /ubus</span> 是通用 ubus 入口。通过路由器 <span class="mono">root</span> 账号登录后，该会话拥有完整路由器管理员权限（NikkiDash ACL 不会缩小 root 权限）。认证后的用户必须是受信任的路由器管理员。
                </div>
                <div>
                  <strong>防火墙说明：</strong>
                  NikkiDash 不会自动添加 WAN 防火墙放行规则、UPnP 或 DDNS，请在 OpenWrt 防火墙中手动配置受控访问（或使用 VPN / WireGuard）。
                </div>
                <label class="row" style={{ cursor: 'pointer', color: 'var(--text)' }}>
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
            <h3 class="card-title">端口、接口与 TLS 证书</h3>
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
              <label class="field-label">会话超时时间（秒，300-86400）</label>
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
              <label class="field-label">TLS 证书路径 ({access?.cert_exists ? '已存在' : '不存在'})</label>
              <input
                class="input mono"
                disabled={props.session.isGuest}
                value={cert}
                onInput={(e) => setCert((e.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <div class="field">
              <label class="field-label">TLS 私钥路径 ({access?.key_exists ? '已存在' : '不存在'})</label>
              <input
                class="input mono"
                disabled={props.session.isGuest}
                value={key}
                onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)}
              />
            </div>
          </div>
          {mode === 'wan_https' && (!access?.cert_exists || !access?.key_exists) && (
            <label class="row" style={{ marginTop: '12px', cursor: 'pointer' }}>
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
            <h3 class="card-title">界面外观与语言</h3>
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
                <option value="dark">深色模式</option>
                <option value="light">浅色模式</option>
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

        <div class="row">
          <button type="submit" class="btn btn-primary" disabled={saving || props.session.isGuest}>
            {saving ? '保存中...' : '保存并应用面板设置'}
          </button>
        </div>
      </form>

      <div class="card" style={{ marginTop: '14px' }}>
        <div class="card-header">
          <h3 class="card-title">故障恢复命令（SSH）</h3>
        </div>
        <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          若误配端口或证书导致面板无法访问，不影响 OpenWrt SSH、原 LuCI 与 Nikki 代理运行。通过 SSH 执行以下命令即可恢复默认 LAN 18080 端口：
        </p>
        <pre class="log-box" style={{ height: 'auto', margin: 0 }}>
          {access?.security_notes?.recovery_cli}
        </pre>
      </div>
    </div>
  );
}
