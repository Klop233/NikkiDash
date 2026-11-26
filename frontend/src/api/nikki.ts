import {
  ubusCall,
  RpcError,
  setSessionSid,
  clearSessionSid,
  getSessionSid,
  splitUtf8Chunks,
  type CallOptions
} from './ubus';
import type {
  AccessConfig,
  AccessMode,
  AsyncTask,
  AuthInfo,
  CapabilitiesResponse,
  ConfigResponse,
  ConnectionItem,
  CorePlatformInfo,
  LangCode,
  ManagedFileEntry,
  NetworkProbeResponse,
  OverviewMetricsResponse,
  ProfilesResponse,
  ProxyMode,
  ProxyNode,
  ProxyProvider,
  RuleItem,
  RuleProvider,
  StatusResponse,
  ThemeMode
} from './types';

function unwrap<T extends { ok?: boolean; error?: string; error_code?: string }>(res: T): T {
  if (res && res.ok === false) {
    throw new RpcError(res.error_code || 'RPC_FAILED', res.error || 'Operation failed', undefined, res as Record<string, unknown>);
  }
  return res;
}

export async function fetchAuthInfo(opts?: CallOptions): Promise<AuthInfo> {
  return ubusCall<AuthInfo>('nikki-dash', 'auth_info', {}, { ...opts, unauthenticated: true });
}

export async function loginSession(username: string, password: string, timeout = 3600): Promise<{
  sid: string;
  username: string;
  timeout: number;
  expires: number;
}> {
  const res = await ubusCall<{
    ubus_rpc_session?: string;
    timeout?: number;
    expires?: number;
    data?: { username?: string };
  }>('session', 'login', { username, password, timeout }, { unauthenticated: true });

  if (!res.ubus_rpc_session) {
    throw new RpcError('AUTH_FAILED', 'Invalid username or password');
  }
  setSessionSid(res.ubus_rpc_session);
  return {
    sid: res.ubus_rpc_session,
    username: res.data?.username || username,
    timeout: res.timeout ?? timeout,
    expires: res.expires ?? timeout
  };
}

export async function logoutSession(): Promise<void> {
  const sid = getSessionSid();
  try {
    if (sid) {
      await ubusCall('session', 'destroy', {});
    }
  } catch {
    // Ignore destroy failures when session already expired
  } finally {
    clearSessionSid();
  }
}

export async function checkSessionAlive(): Promise<boolean> {
  if (!getSessionSid()) return false;
  try {
    const res = await ubusCall<{ access?: boolean }>('session', 'access', {
      object: 'nikki-dash',
      function: 'get_status'
    });
    return res.access === true;
  } catch {
    return false;
  }
}

export const nikkiApi = {
  capabilities: async (opts?: CallOptions) =>
    unwrap(await ubusCall<CapabilitiesResponse>('nikki-dash', 'capabilities', {}, opts)),

  getStatus: async (opts?: CallOptions) =>
    unwrap(await ubusCall<StatusResponse>('nikki-dash', 'get_status', {}, opts)),

  getOverviewMetrics: async (opts?: CallOptions) =>
    unwrap(await ubusCall<OverviewMetricsResponse>('nikki-dash', 'get_overview_metrics', {}, opts)),

  getNetworkProbe: async (opts?: CallOptions) =>
    unwrap(await ubusCall<NetworkProbeResponse>('nikki-dash', 'get_network_probe', {}, opts)),

  runNetworkProbe: async (opts?: CallOptions) =>
    unwrap(await ubusCall<NetworkProbeResponse>('nikki-dash', 'run_network_probe', {}, opts)),

  getConfig: async (opts?: CallOptions) =>
    unwrap(await ubusCall<ConfigResponse>('nikki-dash', 'get_config', {}, opts)),

  getProfiles: async (opts?: CallOptions) =>
    unwrap(await ubusCall<ProfilesResponse>('nikki-dash', 'get_profiles', {}, opts)),

  getProxies: async (opts?: CallOptions) =>
    unwrap(
      await ubusCall<{
        ok: boolean;
        proxies: Record<string, ProxyNode>;
        providers: Record<string, ProxyProvider>;
        error?: string;
      }>('nikki-dash', 'get_proxies', {}, opts)
    ),

  selectProxy: async (group: string, name: string) =>
    unwrap(await ubusCall<{ ok: boolean }>('nikki-dash', 'select_proxy', { group, name })),

  testDelay: async (kind: 'proxy' | 'group', name: string, url?: string, timeout = 5000) =>
    unwrap(
      await ubusCall<{ ok: boolean; kind: string; name: string; result: Record<string, unknown> }>(
        'nikki-dash',
        'test_delay',
        { kind, name, url: url || 'https://www.gstatic.com/generate_204', timeout },
        { timeoutMs: timeout + 8000 }
      )
    ),

  setMode: async (mode: ProxyMode, persist = false) =>
    unwrap(await ubusCall<{ ok: boolean; mode: ProxyMode }>('nikki-dash', 'set_mode', { mode, persist })),

  getConnections: async (opts?: CallOptions) =>
    unwrap(
      await ubusCall<{
        ok: boolean;
        upload_total: number;
        download_total: number;
        memory: number;
        total_count?: number;
        connections: ConnectionItem[];
      }>('nikki-dash', 'get_connections', {}, opts)
    ),

  closeConnection: async (id: string) =>
    unwrap(await ubusCall<{ ok: boolean }>('nikki-dash', 'close_connection', { id })),

  closeAllConnections: async () =>
    unwrap(await ubusCall<{ ok: boolean }>('nikki-dash', 'close_all_connections', {})),

  flushFakeIp: async () =>
    unwrap(await ubusCall<{ ok: boolean }>('nikki-dash', 'flush_fakeip', {})),

  getRules: async (opts?: CallOptions) =>
    unwrap(
      await ubusCall<{
        ok: boolean;
        rules: RuleItem[];
        rule_providers: Record<string, RuleProvider>;
        proxy_providers: Record<string, ProxyProvider>;
      }>('nikki-dash', 'get_rules', {}, opts)
    ),

  updateProvider: async (kind: 'rule' | 'proxy', name: string) =>
    unwrap(
      await ubusCall<{ ok: boolean }>('nikki-dash', 'update_provider', { kind, name }, { timeoutMs: 25000 })
    ),

  getLogs: async (source: 'app' | 'core', tailLines = 400, opts?: CallOptions) =>
    unwrap(
      await ubusCall<{
        ok: boolean;
        source: string;
        exists: boolean;
        total_bytes: number;
        truncated: boolean;
        lines: string[];
      }>('nikki-dash', 'get_logs', { source, tail_lines: tailLines }, opts)
    ),

  clearLogs: async (source: 'app' | 'core' | 'all') =>
    unwrap(await ubusCall<{ ok: boolean }>('nikki-dash', 'clear_logs', { source })),

  getDiagnostics: async () =>
    unwrap(
      await ubusCall<{
        ok: boolean;
        generated_at: number;
        redacted: boolean;
        markdown: string;
        summary: Record<string, unknown>;
      }>('nikki-dash', 'get_diagnostics', {}, { timeoutMs: 25000 })
    ),

  listFiles: async () =>
    unwrap(
      await ubusCall<{ ok: boolean; files: Record<string, ManagedFileEntry[]> }>('nikki-dash', 'list_files', {})
    ),

  readFile: async (category: string, name = '', offset = 0, maxBytes = 512 * 1024) =>
    unwrap(
      await ubusCall<{
        ok: boolean;
        exists: boolean;
        writable: boolean;
        content: string;
        size: number;
        mtime?: number;
        offset: number;
        eof: boolean;
        revision: string;
      }>('nikki-dash', 'read_file', { category, name, offset, max_bytes: maxBytes }, { timeoutMs: 25000 })
    ),

  /**
   * Reads a complete managed text file across multiple chunks when larger than 512 KiB
   * so edits never truncate large profiles or run/config.yaml.
   */
  readFileAll: async (category: string, name = '') => {
    const chunkSize = 512 * 1024;
    const first = await nikkiApi.readFile(category, name, 0, chunkSize);
    if (!first.exists || first.eof) return first;

    let content = first.content || '';
    let offset = content.length;
    let eof: boolean = first.eof;
    let guard = 0;
    while (!eof && guard < 12) {
      guard++;
      const next = await nikkiApi.readFile(category, name, offset, chunkSize);
      if (!next.content || next.content.length === 0) break;
      content += next.content;
      offset += next.content.length;
      eof = next.eof;
    }
    return { ...first, content, eof: true };
  },

  /**
   * Automatically uses chunked upload when content exceeds 32 KiB so it always fits
   * cleanly beneath uhttpd's 64 KiB POST body limit.
   */
  saveFileSmart: async (
    category: string,
    name: string,
    content: string,
    expectedRevision = '',
    requireClashKeys = false
  ) => {
    const byteSize = new TextEncoder().encode(content).length;
    if (byteSize <= 32 * 1024) {
      return unwrap(
        await ubusCall<{ ok: boolean; saved: boolean; backup_id: string | null; size: number; revision: string }>(
          'nikki-dash',
          'save_file',
          {
            category,
            name,
            content,
            expected_revision: expectedRevision,
            require_clash_keys: requireClashKeys
          }
        )
      );
    }

    const begin = unwrap(
      await ubusCall<{ ok: boolean; upload_id: string }>('nikki-dash', 'upload_begin', {
        category,
        name,
        total_size: byteSize,
        expected_revision: expectedRevision
      })
    );
    const chunks = splitUtf8Chunks(content, 28 * 1024);
    for (let i = 0; i < chunks.length; i++) {
      unwrap(
        await ubusCall<{ ok: boolean }>('nikki-dash', 'upload_chunk', {
          upload_id: begin.upload_id,
          chunk_b64: chunks[i],
          seq: i
        })
      );
    }
    return unwrap(
      await ubusCall<{ ok: boolean; saved: boolean; backup_id: string | null; size: number; revision: string }>(
        'nikki-dash',
        'upload_commit',
        {
          upload_id: begin.upload_id,
          require_clash_keys: requireClashKeys
        },
        { timeoutMs: 30000 }
      )
    );
  },

  listBackups: async (category: string, name = '') =>
    unwrap(
      await ubusCall<{ ok: boolean; backups: Array<{ id: string; size: number; mtime: number }> }>(
        'nikki-dash',
        'list_backups',
        { category, name }
      )
    ),

  restoreBackup: async (category: string, name: string, backupId: string) =>
    unwrap(
      await ubusCall<{ ok: boolean; restored_from: string; revision: string }>('nikki-dash', 'restore_backup', {
        category,
        name,
        backup_id: backupId
      })
    ),

  importProfile: async (name: string, content: string, activate = false) => {
    const saved = await nikkiApi.saveFileSmart('profile', name, content, '', true);
    if (activate) {
      await nikkiApi.switchProfile(`file:${name}`, false);
    }
    return saved;
  },

  deleteProfile: async (name: string, fallbackProfile = '', forceStop = false) =>
    unwrap(
      await ubusCall<{ ok: boolean; deleted: string; revision: string }>('nikki-dash', 'delete_profile', {
        name,
        fallback_profile: fallbackProfile,
        force_stop: forceStop
      })
    ),

  saveSubscription: async (params: {
    id?: string;
    name: string;
    url: string;
    info_url?: string;
    user_agent?: string;
    prefer?: 'remote' | 'local';
    revision?: string;
  }) =>
    unwrap(
      await ubusCall<{ ok: boolean; id: string; http_warning: boolean; revision: string }>(
        'nikki-dash',
        'save_subscription',
        {
          id: params.id || '',
          name: params.name,
          url: params.url,
          info_url: params.info_url || '',
          user_agent: params.user_agent || 'clash',
          prefer: params.prefer || 'remote',
          revision: params.revision || ''
        }
      )
    ),

  deleteSubscription: async (id: string, fallbackProfile = '', forceStop = false) =>
    unwrap(
      await ubusCall<{ ok: boolean; deleted: string; revision: string }>('nikki-dash', 'delete_subscription', {
        id,
        fallback_profile: fallbackProfile,
        force_stop: forceStop
      })
    ),

  switchProfile: async (profile: string, apply = false, idempotencyKey = '') =>
    unwrap(
      await ubusCall<{ ok: boolean; task?: AsyncTask; profile?: string; revision?: string }>(
        'nikki-dash',
        'switch_profile',
        { profile, apply, idempotency_key: idempotencyKey }
      )
    ),

  fixControllerBind: async (bindAddr = '127.0.0.1:9090', clearTlsWildcard = false, apply = true) =>
    unwrap(
      await ubusCall<{ ok: boolean; task?: AsyncTask }>('nikki-dash', 'fix_controller_bind', {
        bind_addr: bindAddr,
        clear_tls_wildcard: clearTlsWildcard,
        apply,
        idempotency_key: `fixctrl_${Date.now()}`
      })
    ),

  applyConfig: async (
    revision: string,
    changes: Record<string, unknown>,
    action: 'save' | 'test' | 'apply',
    idempotencyKey = ''
  ) =>
    unwrap(
      await ubusCall<{ ok: boolean; saved?: boolean; revision?: string; task?: AsyncTask }>(
        'nikki-dash',
        'apply_config',
        { revision, changes, action, idempotency_key: idempotencyKey }
      )
    ),

  serviceAction: async (action: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable', idempotencyKey = '') =>
    unwrap(
      await ubusCall<{ ok: boolean; task: AsyncTask }>('nikki-dash', 'service_action', {
        action,
        idempotency_key: idempotencyKey
      })
    ),

  updateSubscription: async (sectionId: string, reloadIfActive = true, idempotencyKey = '') =>
    unwrap(
      await ubusCall<{ ok: boolean; task: AsyncTask }>('nikki-dash', 'update_subscription', {
        section_id: sectionId,
        reload_if_active: reloadIfActive,
        idempotency_key: idempotencyKey
      })
    ),

  getTask: async (taskId: string, opts?: CallOptions) =>
    unwrap(await ubusCall<{ ok: boolean; task: AsyncTask }>('nikki-dash', 'get_task', { task_id: taskId }, opts)),

  listTasks: async (limit = 15, opts?: CallOptions) =>
    unwrap(await ubusCall<{ ok: boolean; tasks: AsyncTask[] }>('nikki-dash', 'list_tasks', { limit }, opts)),

  getCoreStatus: async (opts?: CallOptions) =>
    unwrap(await ubusCall<{ ok: boolean; platform: CorePlatformInfo }>('nikki-dash', 'get_core_status', {}, opts)),

  installCore: async (coreVariant: 'meta' | 'alpha' = 'meta', idempotencyKey = '') =>
    unwrap(
      await ubusCall<{ ok: boolean; task: AsyncTask }>('nikki-dash', 'install_core', {
        core_variant: coreVariant,
        idempotency_key: idempotencyKey
      })
    ),

  removeLuciNikki: async (idempotencyKey = '') =>
    unwrap(
      await ubusCall<{ ok: boolean; task: AsyncTask }>('nikki-dash', 'remove_luci_nikki', {
        idempotency_key: idempotencyKey
      })
    ),

  getAccess: async (opts?: CallOptions) =>
    unwrap(await ubusCall<{ ok: boolean; access: AccessConfig }>('nikki-dash', 'get_access', {}, opts)),

  setAccess: async (params: {
    access_mode?: AccessMode;
    http_port?: number;
    https_port?: number;
    listen_interfaces?: string[];
    cert?: string;
    key?: string;
    session_timeout?: number;
    confirm_wan_risk?: boolean;
    generate_self_signed?: boolean;
    theme?: ThemeMode;
    lang?: LangCode;
  }) =>
    unwrap(
      await ubusCall<{
        ok: boolean;
        access: AccessConfig;
        restarting: boolean;
        next_scheme: string;
        next_port: number;
      }>('nikki-dash', 'set_access', params as Record<string, unknown>)
    )
};
