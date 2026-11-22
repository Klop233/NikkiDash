export type AccessMode = 'lan_auth' | 'lan_guest' | 'wan_https';
export type ProxyMode = 'rule' | 'global' | 'direct';
export type ThemeMode = 'system' | 'dark' | 'light';
export type LangCode = 'zh-CN' | 'en-US';

export interface AuthInfo {
  version: string;
  title: string;
  access_mode: AccessMode;
  lan_guest_enabled: boolean;
  default_theme: ThemeMode;
  default_lang: LangCode;
  session_timeout?: number;
  wan_warning: boolean;
}

export interface SessionState {
  sid: string;
  username: string;
  isGuest: boolean;
  isAdmin: boolean;
  expiresAt: number;
}

export interface CorePlatformInfo {
  distrib_id: string;
  distrib_release: string;
  arch: string;
  branch: string;
  pkg_mgr: 'apk' | 'opkg' | 'unknown';
  fw4_available: boolean;
  supported: boolean;
  feed_url: string;
  feed_configured: boolean;
  nikki_installed: boolean;
  nikki_version: string;
  mihomo_installed: boolean;
  mihomo_variant: 'meta' | 'alpha' | 'custom' | '';
  mihomo_pkg_version: string;
  luci_nikki_installed: boolean;
  luci_packages: string[];
}

export interface CapabilitiesResponse {
  ok: boolean;
  versions: {
    dash: string;
    nikki: string;
    core: string;
    openwrt: string;
  };
  schema_version: string;
  upstream_locked: Record<string, string>;
  platform?: CorePlatformInfo;
  dependencies: {
    nikki_installed: boolean;
    mihomo_installed: boolean;
    fw4_available: boolean;
    yq_available: boolean;
    curl_available: boolean;
    https_available: boolean;
  };
  conflicts: Array<{ service: string; running: boolean; message: string }>;
  caller: { authenticated: boolean };
  features: {
    chunked_upload: boolean;
    polling_mode: boolean;
    websocket_streaming: boolean;
    integrated_core_manager?: boolean;
  };
}

export interface ControllerInfo {
  configured: boolean;
  source: string;
  protocol: 'http' | 'https';
  listen_addr: string;
  loopback_only: boolean;
  exposed_warning: boolean;
  has_secret: boolean;
  reachable?: boolean;
  error?: string | null;
}

export interface TaskStep {
  at: number;
  name: string;
  status: string;
  detail: string;
}

export interface AsyncTask {
  id: string;
  kind: 'apply_config' | 'service_action' | 'update_subscription' | 'install_core' | 'remove_luci_nikki';
  idempotency_key: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'rolled_back' | 'rollback_failed' | 'unknown';
  stage: string;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  steps: TaskStep[];
  message: string;
  error: string | null;
  result: Record<string, unknown> | null;
}

export interface StatusResponse {
  ok: boolean;
  running: boolean;
  pid: number | null;
  uptime: number;
  enabled: boolean;
  profile: string;
  core_only: boolean;
  proxy_enabled: boolean;
  tcp_mode: string;
  udp_mode: string;
  dns_mode: string;
  mode: ProxyMode;
  core_version: string;
  dash_version: string;
  revision: string;
  controller: ControllerInfo;
  health: {
    controller_ok: boolean;
    nft_hijack_ok: boolean;
    tun_up: boolean;
    conflicts: Array<{ service: string; running: boolean; message: string }>;
  };
  active_tasks: AsyncTask[];
}

export interface OverviewMetricsResponse {
  ok: boolean;
  mode: ProxyMode;
  upload_total: number;
  download_total: number;
  memory: number;
  connection_count: number;
  groups: Array<{ name: string; type: string; now: string; count: number }>;
  timestamp: number;
  error?: string;
  error_code?: string;
}

export interface DomesticIpInfo {
  ok: boolean;
  ip: string;
  country: string;
  region: string;
  city: string;
  location: string;
  isp: string;
  asn: string;
  source: string;
}

export interface OverseasIpInfo {
  ok: boolean;
  ip: string;
  country: string;
  country_code: string;
  region: string;
  city: string;
  location: string;
  isp: string;
  org: string;
  asn: string;
  isp_type: 'residential' | 'business' | 'hosting' | 'vpn' | 'mobile' | 'education' | 'tor' | 'unknown';
  isp_type_label: string;
  fraud_score: number | null;
  risk_level: 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  risk_label: string;
  flags: {
    is_proxy: boolean;
    is_vpn: boolean;
    is_tor: boolean;
    is_datacenter: boolean;
    is_hosting: boolean;
    is_mobile: boolean;
  };
  sources: string[];
}

export interface ServiceCheckItem {
  id: string;
  name: string;
  group: 'domestic' | 'overseas';
  ok: boolean;
  status_kind: 'ok' | 'restricted' | 'fail';
  http_code: number;
  latency_ms: number | null;
}

export interface NetworkProbeResponse {
  ok: boolean;
  status: 'idle' | 'running' | 'done' | 'error';
  started_at?: number;
  updated_at?: number;
  route_mode?: 'transparent' | 'local_proxy' | 'direct';
  nikki_running?: boolean;
  domestic?: DomesticIpInfo;
  overseas?: OverseasIpInfo;
  services?: ServiceCheckItem[];
  error?: string;
}

export interface ProxyNode {
  name: string;
  type: string;
  now?: string;
  all?: string[];
  udp?: boolean;
  alive?: boolean;
  history?: Array<{ time: string; delay: number }>;
}

export interface ProxyProvider {
  name: string;
  type: string;
  vehicleType?: string;
  updatedAt?: string;
  proxies?: ProxyNode[];
  subscriptionInfo?: {
    Upload?: number;
    Download?: number;
    Total?: number;
    Expire?: number;
  };
}

export interface RuleItem {
  type: string;
  payload: string;
  proxy: string;
  size?: number;
}

export interface RuleProvider {
  name: string;
  type: string;
  vehicleType?: string;
  behavior?: string;
  format?: string;
  ruleCount?: number;
  updatedAt?: string;
}

export interface ConnectionItem {
  id: string;
  upload: number;
  download: number;
  start: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  metadata: {
    network: string;
    type: string;
    sourceIP: string;
    sourcePort: string;
    destinationIP: string;
    destinationPort: string;
    host: string;
    dnsMode?: string;
    process?: string;
    remoteDestination?: string;
  };
}

export interface SubscriptionItem {
  id: string;
  name: string;
  url: string;
  info_url: string;
  user_agent: string;
  prefer: 'remote' | 'local';
  expire: string;
  upload: string;
  download: string;
  total: string;
  used: string;
  avaliable: string;
  update: string;
  success: string;
  file_exists: boolean;
  file_size: number;
  active: boolean;
}

export interface ProfileFileItem {
  name: string;
  size: number;
  mtime: number;
  active: boolean;
}

export interface ProfilesResponse {
  ok: boolean;
  active_profile: string;
  subscriptions: SubscriptionItem[];
  files: ProfileFileItem[];
  revision: string;
}

export interface SchemaOptionSpec {
  kind: string;
  default?: string;
  optional?: boolean;
  required?: boolean;
  readonly?: boolean;
  secret?: boolean;
  values?: string[];
  suggestions?: string[];
  min?: number;
  max?: number;
  depends?: Record<string, string>;
}

export interface NikkiSchema {
  schema_version: string;
  upstream: Record<string, string>;
  named_sections: Record<string, { type: string; group: string; options: Record<string, SchemaOptionSpec> }>;
  repeatable_sections: Record<
    string,
    {
      sortable: boolean;
      addremove: boolean;
      parent_toggle?: { section: string; option: string };
      options: Record<string, SchemaOptionSpec>;
    }
  >;
}

export interface ConfigResponse {
  ok: boolean;
  schema_version: string;
  revision: string;
  named: Record<string, Record<string, unknown>>;
  repeatable: Record<string, Array<Record<string, unknown>>>;
  unknown_options: Record<string, Record<string, unknown>>;
  unknown_sections: Array<Record<string, unknown>>;
  schema: NikkiSchema;
  identifiers: {
    users: string[];
    groups: string[];
    cgroups: string[];
    networks: string[];
    hosts: Array<{ mac: string; name: string; ipaddrs: string[]; ip6addrs: string[] }>;
  };
}

export interface AccessConfig {
  version: string;
  enabled: boolean;
  access_mode: AccessMode;
  http_port: number;
  https_port: number;
  listen_interfaces: string[];
  cert: string;
  key: string;
  cert_exists: boolean;
  key_exists: boolean;
  ssl_supported: boolean;
  can_generate_cert: boolean;
  session_timeout: number;
  wan_risk_acknowledged: boolean;
  lan_guest_active: boolean;
  effective_listen_addrs: string[];
  theme: ThemeMode;
  lang: LangCode;
  last_service_error: string;
  security_notes: {
    ubus_admin_boundary: string;
    wan_firewall_manual: string;
    recovery_cli: string;
  };
}

export interface ManagedFileEntry {
  name: string;
  category: string;
  writable: boolean;
  binary?: boolean;
  exists: boolean;
  size: number;
  mtime: number;
}
