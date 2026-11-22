import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { nikkiApi } from '../api/nikki';
import { StateView } from '../components/StateView';
import { IconInfo, IconSearch } from '../components/Icons';
import type { AsyncTask, ConfigResponse, ProfilesResponse, SchemaOptionSpec } from '../api/types';

type TabKey = 'basic' | 'procd' | 'proxy' | 'acl' | 'mixin_general' | 'tun_dns' | 'sniffer_rules' | 'routing' | 'log';

const FIELD_LABELS: Record<string, string> = {
  // Basic & Procd & Core
  enabled: '启用',
  profile: '当前活动配置 / 订阅',
  start_delay: '开机启动延迟 (秒)',
  scheduled_restart: '定时重启',
  scheduled_restart_cron: '定时重启 Cron',
  test_profile: '启动前校验配置 (mihomo -t)',
  core_only: '仅运行核心 (不接管透明代理)',
  fast_reload: '快速重载 (SIGHUP)',
  rlimit_nproc_soft: '最大进程数限制 (Soft)',
  rlimit_nproc_hard: '最大进程数限制 (Hard)',
  rlimit_address_space_soft: '虚拟地址空间限制 (Soft)',
  rlimit_address_space_hard: '虚拟地址空间限制 (Hard)',
  rlimit_data_soft: '数据段大小限制 (Soft)',
  rlimit_data_hard: '数据段大小限制 (Hard)',
  rlimit_stack_soft: '栈大小限制 (Soft)',
  rlimit_stack_hard: '栈大小限制 (Hard)',
  rlimit_nofile_soft: '最大文件描述符 (Soft)',
  rlimit_nofile_hard: '最大文件描述符 (Hard)',
  env_go_max_procs: 'GOMAXPROCS (CPU 核数限制)',
  env_go_mem_limit: 'GOMEMLIMIT (内存软上限，如 256MiB)',
  env_safe_paths: 'SAFE_PATHS 安全路径列表',
  env_disable_loopback_detector: '禁用回环检测',
  env_disable_quic_go_gso: '禁用 quic-go GSO',
  env_disable_quic_go_ecn: '禁用 quic-go ECN',
  env_skip_system_ipv6_check: '跳过系统 IPv6 检查',
  redirect_listener_name: 'Redirect 监听器名称',
  tproxy_listener_name: 'TPROXY 监听器名称',
  tun_listener_name: 'TUN 监听器名称',
  // Proxy
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
  bypass_dscp: '绕过 DSCP 列表 (0-63)',
  bypass_fwmark: '绕过 FWMark 列表',
  reserved_ip: '保留绕过 IPv4 CIDR',
  reserved_ip6: '保留绕过 IPv6 CIDR',
  tun_timeout: 'TUN 就绪超时 (秒)',
  tun_interval: 'TUN 轮询间隔 (秒)',
  // Mixin
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
  // Routing & Log
  tproxy_fw_mark: 'TPROXY 防火墙标记 (FWMark)',
  tproxy_fw_mask: 'TPROXY 标记掩码 (FWMask)',
  tun_fw_mark: 'TUN 防火墙标记 (FWMark)',
  tun_fw_mask: 'TUN 标记掩码 (FWMask)',
  tproxy_rule_pref: 'TPROXY 路由规则优先级',
  tun_rule_pref: 'TUN 路由规则优先级',
  tproxy_route_table: 'TPROXY 策略路由表编号',
  tun_route_table: 'TUN 策略路由表编号',
  cgroup_id: '绕过 CGroup ID (十六进制)',
  cgroup_name: '绕过 CGroup 名称',
  dummy_device: '虚拟 Dummy 网卡名称',
  clear_at_stop: '停止服务时清空日志',
  scheduled_clear: '定时清理超大日志',
  scheduled_clear_cron: '定时清理 Cron',
  scheduled_clear_size_limit: '单日志大小上限',
  scheduled_clear_size_limit_unit: '大小单位',
  // Repeatable row fields
  username: '用户名',
  password: '密码',
  domain_name: '域名',
  ip: 'IPv4 / CIDR 列表',
  ip6: 'IPv6 / CIDR 列表',
  mac: 'MAC 地址列表',
  type: '类型',
  nameserver: 'DNS 服务器列表',
  matcher: '匹配表达式',
  protocol: '协议',
  port: '端口列表',
  overwrite_destination: '覆盖目标地址',
  name: '名称',
  url: 'URL 地址',
  node: '下载所走策略节点',
  file_size_limit: '文件大小限制 (0=不限)',
  file_path: '本地文件路径',
  file_format: '文件格式',
  behavior: '规则行为',
  update_interval: '更新间隔 (秒)',
  no_resolve: '不解析域名 (no-resolve)',
  user: 'Linux 用户列表',
  group: 'Linux 用户组列表',
  cgroup: 'CGroup 路径列表',
  dns: '允许 DNS 劫持',
  proxy: '允许透明代理'
};

function labelOf(k: string): string {
  return FIELD_LABELS[k] || k;
}

/**
 * Unlocks normal Enter/comma typing for list fields without losing trailing separators while editing.
 */
function RawListEditor(props: {
  mode: 'multiline' | 'inline';
  values: string[];
  resetKey: string;
  suggestions?: Array<{ value: string; label?: string }>;
  onChange: (next: string[]) => void;
}) {
  const sep = props.mode === 'multiline' ? '\n' : ', ';
  const [text, setText] = useState(() => props.values.join(sep));
  const lastResetRef = useRef(props.resetKey);

  useEffect(() => {
    if (lastResetRef.current !== props.resetKey) {
      lastResetRef.current = props.resetKey;
      setText(props.values.join(sep));
    }
  }, [props.resetKey, props.values, sep]);

  const commit = (raw: string) => {
    setText(raw);
    const parsed = raw
      .split(props.mode === 'multiline' ? '\n' : /[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    props.onChange(parsed);
  };

  const appendSuggestion = (val: string) => {
    const existing = text
      .split(props.mode === 'multiline' ? '\n' : /[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (existing.includes(val)) return;
    const next = [...existing, val];
    setText(next.join(sep));
    props.onChange(next);
  };

  return (
    <div class="stack" style={{ gap: '6px' }}>
      {props.mode === 'multiline' ? (
        <textarea
          class="textarea"
          style={{ minHeight: '84px' }}
          value={text}
          onInput={(e) => commit((e.currentTarget as HTMLTextAreaElement).value)}
        />
      ) : (
        <input
          class="input mono"
          value={text}
          onInput={(e) => commit((e.currentTarget as HTMLInputElement).value)}
        />
      )}
      {props.suggestions && props.suggestions.length > 0 && (
        <div class="row" style={{ gap: '5px' }}>
          {props.suggestions.slice(0, 12).map((s) => (
            <button
              key={s.value}
              type="button"
              class="chip mono"
              onClick={() => appendSuggestion(s.value)}
              title={`点击添加 ${s.value}`}
            >
              + {s.label || s.value}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsPage(props: {
  refreshSeq?: number;
  onTrackTask: (task: AsyncTask) => void;
  onRefreshStatus: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}) {
  const notifyRef = useRef(props.notify);
  notifyRef.current = props.notify;

  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [profiles, setProfiles] = useState<ProfilesResponse | null>(null);
  const [namedDraft, setNamedDraft] = useState<Record<string, Record<string, unknown>>>({});
  const [repDraft, setRepDraft] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [resetEpoch, setResetEpoch] = useState(1);
  const [tab, setTab] = useState<TabKey>('basic');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    try {
      const [res, prof] = await Promise.all([nikkiApi.getConfig(), nikkiApi.getProfiles()]);
      setCfg(res);
      setProfiles(prof);
      setNamedDraft(JSON.parse(JSON.stringify(res.named || {})));
      setRepDraft(JSON.parse(JSON.stringify(res.repeatable || {})));
      setResetEpoch((n) => n + 1);
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

  // Reload fresh revision & anonymous UCI IDs whenever an async task finishes
  useEffect(() => {
    if ((props.refreshSeq ?? 0) > 0 && !dirtyRef.current) {
      void load();
    }
  }, [props.refreshSeq, load]);

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
    setResetEpoch((n) => n + 1);
    setDirty(true);
  };

  const removeRepRow = (rtype: string, idx: number) => {
    setRepDraft((prev) => {
      const rows = [...(prev[rtype] || [])];
      rows.splice(idx, 1);
      return { ...prev, [rtype]: rows };
    });
    setResetEpoch((n) => n + 1);
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
    setResetEpoch((n) => n + 1);
    setDirty(true);
  };

  const submitAction = async (action: 'save' | 'test' | 'apply') => {
    if (!cfg) return;
    setSaving(true);
    try {
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
        notifyRef.current('info', action === 'test' ? '正在执行配置校验测试...' : '已提交事务应用任务...');
        if (action === 'apply') setDirty(false);
      } else {
        notifyRef.current('success', '设置已保存到 /etc/config/nikki（未重启服务）');
        await load();
        props.onRefreshStatus();
      }
    } catch (err) {
      notifyRef.current('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const profileChoices = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [];
    for (const s of profiles?.subscriptions || []) {
      list.push({ value: `subscription:${s.id}`, label: `订阅: ${s.name}` });
    }
    for (const f of profiles?.files || []) {
      list.push({ value: `file:${f.name}`, label: `文件: ${f.name}` });
    }
    return list;
  }, [profiles]);

  const suggestionsForKind = (kind: string): Array<{ value: string; label?: string }> => {
    if (!cfg?.identifiers) return [];
    if (kind === 'list_interface') return (cfg.identifiers.networks || []).map((n) => ({ value: n }));
    if (kind === 'list_user') return (cfg.identifiers.users || []).slice(0, 12).map((u) => ({ value: u }));
    if (kind === 'list_group') return (cfg.identifiers.groups || []).slice(0, 12).map((g) => ({ value: g }));
    if (kind === 'list_cgroup') return (cfg.identifiers.cgroups || []).slice(0, 10).map((cg) => ({ value: cg }));
    if (kind === 'list_cidr4') {
      const ips: Array<{ value: string; label?: string }> = [];
      for (const h of cfg.identifiers.hosts || []) {
        for (const ip of h.ipaddrs || []) {
          ips.push({ value: ip, label: h.name ? `${h.name} (${ip})` : ip });
        }
      }
      return ips;
    }
    if (kind === 'list_mac') {
      return (cfg.identifiers.hosts || []).map((h) => ({
        value: h.mac,
        label: h.name ? `${h.name} (${h.mac})` : h.mac
      }));
    }
    return [];
  };

  const renderField = (sec: string, opt: string, spec: SchemaOptionSpec, ignoreDepends = false) => {
    if (spec.readonly) return null;
    const secData = namedDraft[sec] || {};
    if (!ignoreDepends && spec.depends) {
      for (const [dk, dv] of Object.entries(spec.depends)) {
        if (String(secData[dk] ?? '') !== dv) return null;
      }
    }

    const val = secData[opt];
    const isSecretSet = Boolean(secData[`${opt}_set`]);

    // Special friendly dropdown for config.profile
    if (sec === 'config' && opt === 'profile') {
      const curStr = String(val ?? '');
      const hasCur = curStr && !profileChoices.some((c) => c.value === curStr);
      return (
        <div key={`${sec}.${opt}`} class="field">
          <label class="field-label">{labelOf(opt)}</label>
          <select
            class="select"
            value={curStr}
            onChange={(e) => setNamedVal(sec, opt, (e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">-- 未选择配置 --</option>
            {hasCur && <option value={curStr}>{curStr}</option>}
            {profileChoices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (spec.kind === 'bool') {
      const checked = val === '1' || val === true;
      return (
        <div key={`${sec}.${opt}`} class="field">
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
        <div key={`${sec}.${opt}`} class="field">
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
        <div key={`${sec}.${opt}`} class="field">
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
        <div key={`${sec}.${opt}`} class="field">
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
        <div key={`${sec}.${opt}`} class="field" style={{ gridColumn: '1 / -1' }}>
          <label class="field-label">{labelOf(opt)}（每行一项）</label>
          <RawListEditor
            mode="multiline"
            values={arr}
            resetKey={`${resetEpoch}:${sec}.${opt}`}
            suggestions={suggestionsForKind(spec.kind)}
            onChange={(lines) => setNamedVal(sec, opt, lines)}
          />
        </div>
      );
    }

    return (
      <div key={`${sec}.${opt}`} class="field">
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
          <h2 class="card-title">{title}</h2>
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
          <h2 class="card-title">
            {title} ({rows.length})
          </h2>
          {spec.addremove && (
            <button type="button" class="btn btn-sm" onClick={() => addRepRow(rtype)}>
              添加一项
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>暂无条目</div>
        ) : (
          <div class="stack">
            {rows.map((row, idx) => (
              <div
                key={`${rtype}-${idx}-${String(row['.name'] || '')}`}
                class="sub-card"
              >
                <div class="row-between" style={{ marginBottom: '12px' }}>
                  <span class="badge mono">#{idx + 1}</span>
                  <div class="row">
                    {spec.sortable && (
                      <>
                        <button type="button" class="btn btn-sm" disabled={idx === 0} onClick={() => moveRepRow(rtype, idx, -1)}>
                          上移
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm"
                          disabled={idx === rows.length - 1}
                          onClick={() => moveRepRow(rtype, idx, 1)}
                        >
                          下移
                        </button>
                      </>
                    )}
                    {spec.addremove && (
                      <button type="button" class="btn btn-sm btn-danger" onClick={() => removeRepRow(rtype, idx)}>
                        删除
                      </button>
                    )}
                  </div>
                </div>
                <div class="grid-3">
                  {optEntries.map(([k, ospec]) => {
                    if (ospec.depends) {
                      for (const [dk, dv] of Object.entries(ospec.depends)) {
                        if (String(row[dk] ?? '') !== dv) return null;
                      }
                    }
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
                          <span class="field-label" style={{ color: 'var(--text)' }}>
                            {labelOf(k)}
                          </span>
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
                        <div key={k} class="field" style={{ gridColumn: '1 / -1' }}>
                          <label class="field-label">{labelOf(k)}（逗号分隔）</label>
                          <RawListEditor
                            mode="inline"
                            values={arr}
                            resetKey={`${resetEpoch}:${rtype}[${idx}].${k}`}
                            suggestions={suggestionsForKind(ospec.kind)}
                            onChange={(parts) => updateRepRow(rtype, idx, k, parts)}
                          />
                        </div>
                      );
                    }
                    const listId = ospec.suggestions ? `dl-${rtype}-${k}` : undefined;
                    return (
                      <div key={k} class="field">
                        <label class="field-label">{labelOf(k)}</label>
                        <input
                          class="input mono"
                          list={listId}
                          type={ospec.secret ? 'password' : 'text'}
                          placeholder={ospec.secret && row[`${k}_set`] ? '已设置（留空保留）' : ospec.default || ''}
                          value={String(v ?? '')}
                          onInput={(e) => updateRepRow(rtype, idx, k, (e.currentTarget as HTMLInputElement).value)}
                        />
                        {listId && ospec.suggestions && (
                          <datalist id={listId}>
                            {ospec.suggestions.map((sg) => (
                              <option key={sg} value={sg} />
                            ))}
                          </datalist>
                        )}
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

  // Global cross-tab search results
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !cfg?.schema?.named_sections) return [];
    const hits: Array<{ sec: string; opt: string; spec: SchemaOptionSpec }> = [];
    for (const [sec, secDef] of Object.entries(cfg.schema.named_sections)) {
      for (const [opt, ospec] of Object.entries(secDef.options)) {
        if (ospec.readonly) continue;
        const lbl = labelOf(opt).toLowerCase();
        if (opt.toLowerCase().includes(q) || lbl.includes(q) || sec.toLowerCase().includes(q)) {
          hits.push({ sec, opt, spec: ospec });
        }
      }
    }
    return hits;
  }, [search, cfg]);

  if (loading && !cfg) return <StateView kind="loading" title="正在加载 Nikki 完整 UCI 设置..." />;
  if (error && !cfg) return <StateView kind="error" title="无法加载设置" message={error} actionLabel="重试" onAction={load} />;

  const unknownOptCount = Object.values(cfg?.unknown_options || {}).reduce((acc, o) => acc + Object.keys(o).length, 0);
  const unknownSecCount = cfg?.unknown_sections?.length ?? 0;

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Nikki 完整设置</h1>
          <p class="page-desc">
            完整覆盖 OpenWrt-nikki UCI 配置（Schema v{cfg?.schema_version}），保存采用乐观并发校验、配置测试与失败自动回滚
          </p>
        </div>
        <div class="row" style={{ gap: '8px' }}>
          <label class="search-box" style={{ width: '220px' }}>
            <IconSearch />
            <input
              type="search"
              aria-label="全局搜索设置项"
              placeholder="全局搜索设置项"
              value={search}
              onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <button type="button" class="btn" onClick={() => void load()} disabled={saving}>
            重新加载
          </button>
          <button type="button" class="btn" onClick={() => void submitAction('test')} disabled={saving}>
            测试配置
          </button>
          <button type="button" class="btn" onClick={() => void submitAction('save')} disabled={saving || !dirty}>
            仅保存 UCI
          </button>
          <button type="button" class="btn btn-primary" onClick={() => void submitAction('apply')} disabled={saving}>
            {saving ? '提交中...' : '保存并应用'}
          </button>
        </div>
      </div>

      {(unknownOptCount > 0 || unknownSecCount > 0) && (
        <div class="alert alert-info" role="status">
          <IconInfo className="alert-icon" />
          <div class="alert-body">
            检测到 {unknownOptCount} 个扩展或旧版 UCI 字段与 {unknownSecCount} 个扩展 Section，NikkiDash 保存时会自动无损保留。
          </div>
        </div>
      )}

      {search.trim().length > 0 ? (
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">搜索结果 ({searchMatches.length})</h2>
            <button type="button" class="btn btn-ghost" onClick={() => setSearch('')}>
              清除搜索
            </button>
          </div>
          {searchMatches.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '16px 0', fontSize: '16px' }}>
              没有找到「{search.trim()}」相关的设置项
            </div>
          ) : (
            <div class="grid-2">
              {searchMatches.map(({ sec, opt, spec }) => (
                <div key={`${sec}.${opt}`}>
                  <div class="mono" style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    nikki.{sec}.{opt}
                  </div>
                  {renderField(sec, opt, spec, true)}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div class="tabs" role="tablist" aria-label="设置分类">
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
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                class={`tab-btn ${tab === k ? 'active' : ''}`}
                onClick={() => setTab(k)}
              >
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
        </>
      )}

      {dirty && (
        <div class="sticky-savebar">
          <div style={{ fontSize: '14px', fontWeight: 500 }}>你有尚未保存的 UCI 配置更改</div>
          <div class="row" style={{ gap: '8px' }}>
            <button type="button" class="btn" disabled={saving} onClick={() => void load()}>
              放弃更改
            </button>
            <button type="button" class="btn" disabled={saving} onClick={() => void submitAction('test')}>
              测试配置
            </button>
            <button type="button" class="btn" disabled={saving} onClick={() => void submitAction('save')}>
              仅保存 UCI
            </button>
            <button type="button" class="btn btn-primary" disabled={saving} onClick={() => void submitAction('apply')}>
              {saving ? '提交中...' : '保存并应用'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
