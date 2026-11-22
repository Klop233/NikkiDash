import { useCallback, useEffect, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { StateView } from '../components/StateView';
import type { AsyncTask, ConfigResponse, SchemaOptionSpec } from '../api/types';

type TabKey = 'basic' | 'procd' | 'proxy' | 'acl' | 'mixin_general' | 'tun_dns' | 'sniffer_rules' | 'routing' | 'log';

const FIELD_LABELS: Record<string, string> = {
  enabled: '启用',
  profile: '当前配置文件 / 订阅',
  start_delay: '开机启动延迟 (秒)',
  scheduled_restart: '定时重启',
  scheduled_restart_cron: '定时重启 Cron',
  test_profile: '启动前校验配置 (mihomo -t)',
  core_only: '仅运行核心 (不接管透明代理)',
  fast_reload: '快速重载 (SIGHUP)',
  env_go_max_procs: 'GOMAXPROCS',
  env_go_mem_limit: 'GOMEMLIMIT',
  env_safe_paths: 'SAFE_PATHS 安全路径列表',
  env_disable_loopback_detector: '禁用回环检测',
  env_disable_quic_go_gso: '禁用 quic-go GSO',
  env_disable_quic_go_ecn: '禁用 quic-go ECN',
  env_skip_system_ipv6_check: '跳过系统 IPv6 检查',
  redirect_listener_name: 'Redirect 监听器名称',
  tproxy_listener_name: 'TPROXY 监听器名称',
  tun_listener_name: 'TUN 监听器名称',
  tcp_mode: 'TCP 透明代理模式',
  udp_mode: 'UDP 透明代理模式',
  ipv4_dns_hijack: 'IPv4 DNS 劫持',
  ipv6_dns_hijack: 'IPv6 DNS 劫持',
  ipv4_proxy: 'IPv4 透明代理',
  ipv6_proxy: 'IPv6 透明代理',
  fake_ip_ping_hijack: 'Fake-IP ICMP Ping 劫持',
  router_proxy: '代理路由器本机流量',
  lan_proxy: '代理局域网设备流量',
  lan_inbound_interface: '局域网入站接口',
  bypass_china_mainland_ip: '绕过中国大陆 IPv4',
  bypass_china_mainland_ip6: '绕过中国大陆 IPv6',
  proxy_tcp_dport: '代理目标 TCP 端口',
  proxy_udp_dport: '代理目标 UDP 端口',
  bypass_dscp: '绕过 DSCP 列表',
  bypass_fwmark: '绕过 FWMark 列表',
  reserved_ip: '保留绕过 IPv4 CIDR',
  reserved_ip6: '保留绕过 IPv6 CIDR',
  tun_timeout: 'TUN 就绪超时 (秒)',
  tun_interval: 'TUN 轮询间隔 (秒)',
  log_level: '日志级别',
  mode: '默认运行模式',
  match_process: '进程匹配模式',
  outbound_interface: '出站接口',
  ipv6: '核心 IPv6 支持',
  unify_delay: '统一延迟计算',
  tcp_concurrent: 'TCP 并发连接',
  disable_tcp_keep_alive: '禁用 TCP Keep-Alive',
  tcp_keep_alive_idle: 'TCP Keep-Alive Idle',
  tcp_keep_alive_interval: 'TCP Keep-Alive Interval',
  ui_path: '内置 UI 目录',
  ui_name: '内置 UI 名称',
  ui_url: '内置 UI 下载 URL',
  api_listen: '控制器 HTTP 监听地址',
  api_tls_listen: '控制器 HTTPS 监听地址',
  api_tls_cert: '控制器 TLS 证书路径',
  api_tls_key: '控制器 TLS 私钥路径',
  api_tls_ech_key: '控制器 ECH 私钥',
  api_secret: '控制器 API Secret (留空保持不变)',
  selection_cache: '记住策略组节点选择',
  allow_lan: '允许局域网连接入站端口',
  http_port: 'HTTP 代理端口',
  socks_port: 'SOCKS 代理端口',
  mixed_port: 'Mixed 混合代理端口',
  redir_port: 'Redirect 端口',
  tproxy_port: 'TPROXY 端口',
  authentication: '覆盖入站认证列表',
  tun_enabled: '启用 TUN',
  tun_device: 'TUN 网卡名称',
  tun_stack: 'TUN 协议栈',
  tun_mtu: 'TUN MTU',
  tun_gso: 'TUN GSO',
  tun_gso_max_size: 'TUN GSO 最大分片',
  tun_dns_hijack: '覆盖 TUN DNS 劫持列表',
  tun_dns_hijacks: 'TUN DNS 劫持目标',
  dns_enabled: '启用内置 DNS',
  dns_cache_algorithm: 'DNS 缓存算法',
  dns_listen: 'DNS 监听地址',
  dns_ipv6: 'DNS IPv6 解析',
  dns_mode: 'DNS 增强模式',
  fake_ip_range: 'Fake-IP IPv4 网段',
  fake_ip6_range: 'Fake-IP IPv6 网段',
  fake_ip_ttl: 'Fake-IP TTL',
  fake_ip_filter: '覆盖 Fake-IP 过滤列表',
  fake_ip_filters: 'Fake-IP 过滤域名',
  fake_ip_filter_mode: 'Fake-IP 过滤模式',
  fake_ip_cache: '缓存 Fake-IP 映射',
  dns_respect_rules: 'DNS 遵循分流规则',
  dns_doh_prefer_http3: 'DoH 优先 HTTP/3',
  dns_system_hosts: '使用系统 Hosts',
  dns_hosts: '使用自定义 Hosts',
  hosts: '覆盖 Hosts 表',
  dns_nameserver: '覆盖 DNS Nameserver 列表',
  dns_proxy_server_nameserver_policy: '覆盖代理节点域名解析策略',
  dns_direct_nameserver_follow_policy: '直连 DNS 遵循策略',
  dns_nameserver_policy: '覆盖 Nameserver Policy',
  sniffer: '启用流量嗅探 (Sniffer)',
  sniffer_sniff_dns_mapping: '嗅探 Redir-Host',
  sniffer_sniff_pure_ip: '嗅探纯 IP 连接',
  sniffer_force_domain_name: '覆盖强制嗅探域名',
  sniffer_force_domain_names: '强制嗅探域名列表',
  sniffer_ignore_domain_name: '覆盖跳过嗅探域名',
  sniffer_ignore_domain_names: '跳过嗅探域名列表',
  sniffer_sniff: '覆盖分协议嗅探端口',
  rule_provider: '追加规则 Provider',
  rule: '追加前置分流规则',
  geoip_format: 'GeoIP 格式',
  geodata_loader: 'GeoData 加载模式',
  geosite_url: 'GeoSite 下载 URL',
  geoip_mmdb_url: 'GeoIP MMDB URL',
  geoip_dat_url: 'GeoIP DAT URL',
  geoip_asn_url: 'GeoIP ASN URL',
  geox_auto_update: 'GeoX 自动更新',
  geox_update_interval: 'GeoX 更新间隔 (小时)',
  mixin_file_content: '合并 /etc/nikki/mixin.yaml 原文内容',
  clear_at_stop: '停止服务时清空日志',
  scheduled_clear: '定时清理超大日志',
  scheduled_clear_cron: '定时清理 Cron',
  scheduled_clear_size_limit: '单日志大小上限',
  scheduled_clear_size_limit_unit: '大小单位'
};

function labelOf(k: string): string {
  return FIELD_LABELS[k] || k;
}

export function SettingsPage(props: {
  onTrackTask: (task: AsyncTask) => void;
  onRefreshStatus: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [namedDraft, setNamedDraft] = useState<Record<string, Record<string, unknown>>>({});
  const [repDraft, setRepDraft] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [tab, setTab] = useState<TabKey>('basic');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await nikkiApi.getConfig();
      setCfg(res);
      setNamedDraft(JSON.parse(JSON.stringify(res.named || {})));
      setRepDraft(JSON.parse(JSON.stringify(res.repeatable || {})));
      setDirty(false);
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

  const setNamedVal = (sec: string, opt: string, value: unknown) => {
    setNamedDraft((prev) => ({
      ...prev,
      [sec]: { ...(prev[sec] || {}), [opt]: value }
    }));
    setDirty(true);
  };

  const updateRepRow = (rtype: string, idx: number, opt: string, value: unknown) => {
    setRepDraft((prev) => {
      const rows = [...(prev[rtype] || [])];
      rows[idx] = { ...rows[idx], [opt]: value };
      return { ...prev, [rtype]: rows };
    });
    setDirty(true);
  };

  const addRepRow = (rtype: string) => {
    const spec = cfg?.schema?.repeatable_sections?.[rtype];
    const row: Record<string, unknown> = {};
    if (spec) {
      for (const [k, o] of Object.entries(spec.options)) {
        if (o.readonly) continue;
        if (o.kind.startsWith('list_')) row[k] = [];
        else if (o.default !== undefined) row[k] = o.default;
        else row[k] = '';
      }
    }
    setRepDraft((prev) => ({ ...prev, [rtype]: [...(prev[rtype] || []), row] }));
    setDirty(true);
  };

  const removeRepRow = (rtype: string, idx: number) => {
    setRepDraft((prev) => {
      const rows = [...(prev[rtype] || [])];
      rows.splice(idx, 1);
      return { ...prev, [rtype]: rows };
    });
    setDirty(true);
  };

  const moveRepRow = (rtype: string, idx: number, dir: -1 | 1) => {
    setRepDraft((prev) => {
      const rows = [...(prev[rtype] || [])];
      const next = idx + dir;
      if (next < 0 || next >= rows.length) return prev;
      [rows[idx], rows[next]] = [rows[next], rows[idx]];
      return { ...prev, [rtype]: rows };
    });
    setDirty(true);
  };

  const submitAction = async (action: 'save' | 'test' | 'apply') => {
    if (!cfg) return;
    setSaving(true);
    try {
      // Do not overwrite subscriptions from SettingsPage (managed on ProfilesPage)
      const repPayload = { ...repDraft };
      delete repPayload.subscription;

      const res = await nikkiApi.applyConfig(
        cfg.revision,
        { named: namedDraft, repeatable: repPayload },
        action,
        `cfg_${action}_${Date.now()}`
      );
      if (res.task) {
        props.onTrackTask(res.task);
        props.notify('info', action === 'test' ? '正在执行配置校验测试...' : '已提交事务应用任务...');
      } else {
        props.notify('success', '设置已保存到 /etc/config/nikki（未重启服务）');
        await load();
      }
      setDirty(false);
    } catch (err) {
      props.notify('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const renderField = (sec: string, opt: string, spec: SchemaOptionSpec) => {
    if (spec.readonly) return null;
    const secData = namedDraft[sec] || {};
    if (spec.depends) {
      for (const [dk, dv] of Object.entries(spec.depends)) {
        if (String(secData[dk] ?? '') !== dv) return null;
      }
    }

    const val = secData[opt];
    const isSecretSet = Boolean(secData[`${opt}_set`]);

    if (spec.kind === 'bool') {
      const checked = val === '1' || val === true;
      return (
        <div key={opt} class="field">
          <label class="switch">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setNamedVal(sec, opt, (e.currentTarget as HTMLInputElement).checked ? '1' : '0')}
            />
            <span class="switch-track" />
            <span class="field-label" style={{ color: 'var(--text)' }}>
              {labelOf(opt)}
            </span>
          </label>
        </div>
      );
    }

    if (spec.kind === 'tri_bool') {
      const strVal = val === undefined || val === null ? '' : String(val);
      return (
        <div key={opt} class="field">
          <label class="field-label">{labelOf(opt)}</label>
          <select
            class="select"
            value={strVal}
            onChange={(e) => setNamedVal(sec, opt, (e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">保持配置原样</option>
            <option value="1">启用 (1)</option>
            <option value="0">禁用 (0)</option>
          </select>
        </div>
      );
    }

    if (spec.kind === 'enum') {
      return (
        <div key={opt} class="field">
          <label class="field-label">{labelOf(opt)}</label>
          <select
            class="select"
            value={String(val ?? '')}
            onChange={(e) => setNamedVal(sec, opt, (e.currentTarget as HTMLSelectElement).value)}
          >
            {spec.optional && <option value="">保持原样 / 禁用</option>}
            {(spec.values || []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (spec.kind === 'interface') {
      return (
        <div key={opt} class="field">
          <label class="field-label">{labelOf(opt)}</label>
          <select
            class="select"
            value={String(val ?? '')}
            onChange={(e) => setNamedVal(sec, opt, (e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">自动 / 保持原样</option>
            {(cfg?.identifiers?.networks || []).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (spec.kind.startsWith('list_') || spec.kind === 'colon_list') {
      const arr = Array.isArray(val) ? val.map(String) : val ? [String(val)] : [];
      return (
        <div key={opt} class="field" style={{ gridColumn: '1 / -1' }}>
          <label class="field-label">{labelOf(opt)}（每行一项）</label>
          <textarea
            class="textarea"
            style={{ minHeight: '84px' }}
            value={arr.join('\n')}
            onInput={(e) => {
              const lines = (e.currentTarget as HTMLTextAreaElement).value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
              setNamedVal(sec, opt, lines);
            }}
          />
        </div>
      );
    }

    return (
      <div key={opt} class="field">
        <label class="field-label">{labelOf(opt)}</label>
        <input
          class="input mono"
          type={spec.secret ? 'password' : 'text'}
          placeholder={spec.secret && isSecretSet ? '已设置（留空保持不变）' : spec.default || ''}
          value={String(val ?? '')}
          onInput={(e) => setNamedVal(sec, opt, (e.currentTarget as HTMLInputElement).value)}
        />
      </div>
    );
  };

  const renderNamedGroup = (title: string, sec: string, onlyKeys?: string[]) => {
    const spec = cfg?.schema?.named_sections?.[sec];
    if (!spec) return null;
    const keys = onlyKeys || Object.keys(spec.options);
    return (
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">{title}</h3>
          <span class="badge mono">nikki.{sec}</span>
        </div>
        <div class="grid-2">{keys.map((k) => spec.options[k] && renderField(sec, k, spec.options[k]))}</div>
      </div>
    );
  };

  const renderRepeatable = (title: string, rtype: string) => {
    const spec = cfg?.schema?.repeatable_sections?.[rtype];
    if (!spec) return null;
    const rows = repDraft[rtype] || [];
    const optEntries = Object.entries(spec.options).filter(([, s]) => !s.readonly || rtype === 'sniff');

    return (
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            {title} ({rows.length})
          </h3>
          {spec.addremove && (
            <button class="btn btn-sm btn-primary" onClick={() => addRepRow(rtype)}>
              添加一项
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>暂无条目</div>
        ) : (
          <div class="stack">
            {rows.map((row, idx) => (
              <div
                key={`${rtype}-${idx}`}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                  background: 'var(--surface-2)'
                }}
              >
                <div class="row-between" style={{ marginBottom: '10px' }}>
                  <span class="badge mono">#{idx + 1}</span>
                  <div class="row">
                    {spec.sortable && (
                      <>
                        <button class="btn btn-sm" disabled={idx === 0} onClick={() => moveRepRow(rtype, idx, -1)}>
                          上移
                        </button>
                        <button class="btn btn-sm" disabled={idx === rows.length - 1} onClick={() => moveRepRow(rtype, idx, 1)}>
                          下移
                        </button>
                      </>
                    )}
                    {spec.addremove && (
                      <button class="btn btn-sm btn-danger" onClick={() => removeRepRow(rtype, idx)}>
                        删除
                      </button>
                    )}
                  </div>
                </div>
                <div class="grid-3">
                  {optEntries.map(([k, ospec]) => {
                    const v = row[k];
                    if (ospec.kind === 'bool') {
                      return (
                        <label key={k} class="switch">
                          <input
                            type="checkbox"
                            checked={v === '1' || v === true}
                            onChange={(e) =>
                              updateRepRow(rtype, idx, k, (e.currentTarget as HTMLInputElement).checked ? '1' : '0')
                            }
                          />
                          <span class="switch-track" />
                          <span class="field-label">{labelOf(k)}</span>
                        </label>
                      );
                    }
                    if (ospec.kind === 'enum') {
                      return (
                        <div key={k} class="field">
                          <label class="field-label">{labelOf(k)}</label>
                          <select
                            class="select"
                            disabled={ospec.readonly}
                            value={String(v ?? '')}
                            onChange={(e) => updateRepRow(rtype, idx, k, (e.currentTarget as HTMLSelectElement).value)}
                          >
                            {(ospec.values || []).map((ev) => (
                              <option key={ev} value={ev}>
                                {ev}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    }
                    if (ospec.kind.startsWith('list_')) {
                      const arr = Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
                      return (
                        <div key={k} class="field">
                          <label class="field-label">{labelOf(k)}（逗号或换行分隔）</label>
                          <input
                            class="input mono"
                            value={arr.join(', ')}
                            onInput={(e) => {
                              const parts = (e.currentTarget as HTMLInputElement).value
                                .split(/[,\n]/)
                                .map((s) => s.trim())
                                .filter(Boolean);
                              updateRepRow(rtype, idx, k, parts);
                            }}
                          />
                        </div>
                      );
                    }
                    return (
                      <div key={k} class="field">
                        <label class="field-label">{labelOf(k)}</label>
                        <input
                          class="input mono"
                          type={ospec.secret ? 'password' : 'text'}
                          placeholder={ospec.secret && row[`${k}_set`] ? '已设置（留空保留）' : ''}
                          value={String(v ?? '')}
                          onInput={(e) => updateRepRow(rtype, idx, k, (e.currentTarget as HTMLInputElement).value)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  if (loading && !cfg) return <StateView kind="loading" title="正在加载 Nikki 完整 UCI 设置..." />;
  if (error && !cfg) return <StateView kind="error" title="无法加载设置" message={error} actionLabel="重试" onAction={load} />;

  const unknownOptCount = Object.values(cfg?.unknown_options || {}).reduce((acc, o) => acc + Object.keys(o).length, 0);
  const unknownSecCount = cfg?.unknown_sections?.length ?? 0;

  return (
    <div>
      <div class="page-header">
        <div>
          <h2 class="page-title">Nikki 完整设置</h2>
          <p class="page-desc">
            完整覆盖 OpenWrt-nikki UCI 配置（Schema v{cfg?.schema_version}），保存采用乐观并发校验、配置测试与失败自动回滚
          </p>
        </div>
        <div class="row">
          <button class="btn" onClick={load} disabled={saving}>
            重新加载
          </button>
          <button class="btn" onClick={() => submitAction('test')} disabled={saving}>
            测试配置
          </button>
          <button class="btn" onClick={() => submitAction('save')} disabled={saving || !dirty}>
            仅保存 UCI
          </button>
          <button class="btn btn-primary" onClick={() => submitAction('apply')} disabled={saving}>
            {saving ? '提交中...' : '保存并应用'}
          </button>
        </div>
      </div>

      {(unknownOptCount > 0 || unknownSecCount > 0) && (
        <div class="alert alert-info">
          <div>
            检测到 {unknownOptCount} 个未识别的 UCI 字段和 {unknownSecCount} 个扩展 Section。NikkiDash 保存时会自动保留它们，绝不会静默丢弃。
          </div>
        </div>
      )}

      <div class="tabs">
        {(
          [
            ['basic', '基本'],
            ['procd', '进程 / 核心'],
            ['proxy', '透明代理'],
            ['acl', '访问控制'],
            ['mixin_general', '混入 / 入站'],
            ['tun_dns', 'TUN / DNS'],
            ['sniffer_rules', '嗅探 / 规则 / GeoX'],
            ['routing', '路由标记'],
            ['log', '日志策略']
          ] as Array<[TabKey, string]>
        ).map(([k, label]) => (
          <button key={k} class={`tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'basic' && renderNamedGroup('基本配置', 'config')}
      {tab === 'procd' && (
        <>
          {renderNamedGroup('procd 进程与环境变量', 'procd')}
          {renderNamedGroup('核心监听器名称', 'core')}
        </>
      )}
      {tab === 'proxy' && renderNamedGroup('透明代理与绕过设置', 'proxy')}
      {tab === 'acl' && (
        <>
          {renderRepeatable('路由器本机访问控制 (router_access_control)', 'router_access_control')}
          {renderRepeatable('局域网设备访问控制 (lan_access_control)', 'lan_access_control')}
        </>
      )}
      {tab === 'mixin_general' && (
        <>
          {renderNamedGroup('常规与外部控制 Mixin', 'mixin', [
            'log_level', 'mode', 'match_process', 'outbound_interface', 'ipv6', 'unify_delay',
            'tcp_concurrent', 'disable_tcp_keep_alive', 'tcp_keep_alive_idle', 'tcp_keep_alive_interval',
            'api_listen', 'api_tls_listen', 'api_tls_cert', 'api_tls_key', 'api_tls_ech_key', 'api_secret',
            'ui_path', 'ui_name', 'ui_url', 'selection_cache'
          ])}
          {renderNamedGroup('入站端口与认证', 'mixin', [
            'allow_lan', 'http_port', 'socks_port', 'mixed_port', 'redir_port', 'tproxy_port', 'authentication'
          ])}
          {renderRepeatable('入站代理认证账号 (authentication)', 'authentication')}
        </>
      )}
      {tab === 'tun_dns' && (
        <>
          {renderNamedGroup('TUN 配置', 'mixin', [
            'tun_enabled', 'tun_device', 'tun_stack', 'tun_mtu', 'tun_gso', 'tun_gso_max_size',
            'tun_dns_hijack', 'tun_dns_hijacks'
          ])}
          {renderNamedGroup('DNS 与 Fake-IP 配置', 'mixin', [
            'dns_enabled', 'dns_cache_algorithm', 'dns_listen', 'dns_ipv6', 'dns_mode',
            'fake_ip_range', 'fake_ip6_range', 'fake_ip_ttl', 'fake_ip_filter', 'fake_ip_filters',
            'fake_ip_filter_mode', 'fake_ip_cache', 'dns_respect_rules', 'dns_doh_prefer_http3',
            'dns_system_hosts', 'dns_hosts', 'hosts', 'dns_nameserver',
            'dns_proxy_server_nameserver_policy', 'dns_direct_nameserver_follow_policy', 'dns_nameserver_policy'
          ])}
          {renderRepeatable('自定义 Hosts (hosts)', 'hosts')}
          {renderRepeatable('DNS 上游服务器 (nameserver)', 'nameserver')}
          {renderRepeatable('代理节点域名解析策略 (proxy_server_nameserver_policy)', 'proxy_server_nameserver_policy')}
          {renderRepeatable('域名分流解析策略 (nameserver_policy)', 'nameserver_policy')}
        </>
      )}
      {tab === 'sniffer_rules' && (
        <>
          {renderNamedGroup('流量嗅探 (Sniffer)', 'mixin', [
            'sniffer', 'sniffer_sniff_dns_mapping', 'sniffer_sniff_pure_ip',
            'sniffer_force_domain_name', 'sniffer_force_domain_names',
            'sniffer_ignore_domain_name', 'sniffer_ignore_domain_names', 'sniffer_sniff'
          ])}
          {renderRepeatable('分协议嗅探端口 (sniff)', 'sniff')}
          {renderNamedGroup('规则、GeoX 与 Mixin 原文开关', 'mixin', [
            'rule_provider', 'rule', 'geoip_format', 'geodata_loader',
            'geosite_url', 'geoip_mmdb_url', 'geoip_dat_url', 'geoip_asn_url',
            'geox_auto_update', 'geox_update_interval', 'mixin_file_content'
          ])}
          {renderRepeatable('追加规则 Provider (rule_provider)', 'rule_provider')}
          {renderRepeatable('追加前置规则 (rule)', 'rule')}
        </>
      )}
      {tab === 'routing' && renderNamedGroup('策略路由与防火墙标记 (routing)', 'routing')}
      {tab === 'log' && renderNamedGroup('日志清理策略 (log)', 'log')}
    </div>
  );
}
