import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { LoginPage } from '../frontend/src/pages/LoginPage';
import { ConnectionsPage } from '../frontend/src/pages/ConnectionsPage';
import { LogsDiagnosticsPage } from '../frontend/src/pages/LogsDiagnosticsPage';
import { YamlEditorPage } from '../frontend/src/pages/YamlEditorPage';
import { ProxiesPage } from '../frontend/src/pages/ProxiesPage';
import { OverviewPage } from '../frontend/src/pages/OverviewPage';
import { nikkiApi } from '../frontend/src/api/nikki';

describe('NikkiDash UI components & XSS safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('renders LoginPage with WAN warning when wan_warning=true and submits credentials', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    const { getByLabelText, getByText } = render(
      <LoginPage
        authInfo={{
          version: '0.1.0',
          title: 'NikkiDash',
          access_mode: 'wan_https',
          lan_guest_enabled: false,
          default_theme: 'dark',
          default_lang: 'zh-CN',
          wan_warning: true
        }}
        expiredNotice={false}
        onLogin={onLogin}
        onGuestLogin={vi.fn()}
      />
    );

    expect(getByText(/WAN HTTPS/)).toBeTruthy();
    const passInput = getByLabelText('密码') as HTMLInputElement;
    fireEvent.input(passInput, { target: { value: 'routerpass' } });
    fireEvent.click(getByText('登录'));
    // In WAN HTTPS mode, "remember across restarts" defaults to false (sessionStorage only)
    expect(onLogin).toHaveBeenCalledWith('root', 'routerpass', false);
  });

  it('renders LogsDiagnosticsPage safely without executing HTML/XSS payloads', async () => {
    vi.spyOn(nikkiApi, 'getLogs').mockResolvedValue({
      ok: true,
      source: 'app',
      exists: true,
      total_bytes: 120,
      truncated: false,
      lines: ['<img src=x onerror="window.__xss=1">', '<script>window.__xss=2</script>']
    });

    const { findByText, container } = render(<LogsDiagnosticsPage notify={vi.fn()} />);
    await findByText('<img src=x onerror="window.__xss=1">');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('paginates large connection lists smoothly without rendering all rows at once', async () => {
    const bigList = Array.from({ length: 240 }, (_, i) => ({
      id: `conn-${i}`,
      upload: i * 100,
      download: i * 500,
      start: new Date().toISOString(),
      chains: ['HK-01', 'Proxy'],
      rule: 'DOMAIN-SUFFIX',
      rulePayload: `host${i}.example.com`,
      metadata: {
        network: 'tcp',
        type: 'HTTP',
        sourceIP: '192.168.100.10',
        sourcePort: String(40000 + i),
        destinationIP: '93.184.216.34',
        destinationPort: '443',
        host: `host${i}.example.com`
      }
    }));

    vi.spyOn(nikkiApi, 'getConnections').mockResolvedValue({
      ok: true,
      upload_total: 100000,
      download_total: 500000,
      memory: 24000000,
      connections: bigList
    });

    const { findByText, container } = render(<ConnectionsPage running={true} notify={vi.fn()} />);
    await findByText(/活跃连接 \(240\)/);
    // Page size is 50, so only 50 body rows should render in DOM
    expect(container.querySelectorAll('tbody tr').length).toBe(50);
  });

  it('YamlEditorPage does not re-fetch or wipe unsaved edits when parent re-renders', async () => {
    vi.spyOn(nikkiApi, 'listFiles').mockResolvedValue({
      ok: true,
      files: {
        mixin: [{ name: 'mixin.yaml', category: 'mixin', writable: true, exists: true, size: 12, mtime: 1 }]
      }
    });
    const readSpy = vi.spyOn(nikkiApi, 'readFileAll').mockResolvedValue({
      ok: true,
      exists: true,
      writable: true,
      content: 'log-level: info\n',
      size: 16,
      offset: 0,
      eof: true,
      revision: 'rev1'
    });
    vi.spyOn(nikkiApi, 'listBackups').mockResolvedValue({ ok: true, backups: [] });

    const { container, rerender } = render(<YamlEditorPage notify={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: 'log-level: debug\n' } });

    // Simulate parent 4-second polling re-render with a fresh notify reference
    rerender(<YamlEditorPage notify={vi.fn()} />);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('log-level: debug\n');
  });

  it('ProxiesPage keeps profile group order, switches Selector nodes, and never switches URLTest/Fallback groups', async () => {
    vi.spyOn(nikkiApi, 'getProxies').mockResolvedValue({
      ok: true,
      proxies: {
        GLOBAL: { name: 'GLOBAL', type: 'Selector', now: 'ManualGroup', all: ['ManualGroup', 'AutoGroup'] },
        AutoGroup: { name: 'AutoGroup', type: 'URLTest', now: 'HK-1', all: ['HK-1', 'JP-1'] },
        ManualGroup: {
          name: 'ManualGroup',
          type: 'Selector',
          now: 'HK-1',
          all: ['剩余流量：408.73 GB', 'HK-1', 'JP-1', 'AutoGroup']
        },
        '剩余流量：408.73 GB': { name: '剩余流量：408.73 GB', type: 'Shadowsocks', history: [] },
        'HK-1': { name: 'HK-1', type: 'Shadowsocks', history: [{ time: '2026-01-01T00:00:00Z', delay: 42 }] },
        'JP-1': { name: 'JP-1', type: 'Shadowsocks', history: [{ time: '2026-01-01T00:00:00Z', delay: 88 }] }
      },
      providers: {}
    });
    const selSpy = vi.spyOn(nikkiApi, 'selectProxy').mockResolvedValue({ ok: true });

    const { findAllByRole, queryByText, getByText } = render(<ProxiesPage running={true} notify={vi.fn()} />);
    const tabs = await findAllByRole('tab');
    // Order follows GLOBAL.all (profile order), not alphabetical / type
    expect(tabs.map((t) => t.querySelector('.group-tab-name')?.textContent)).toEqual(['ManualGroup', 'AutoGroup']);

    // Subscription banner info pseudo-nodes are hidden by default with a visible count
    expect(queryByText('剩余流量：408.73 GB')).toBeNull();
    expect(getByText(/隐藏信息节点 \(1\)/)).toBeTruthy();

    // First group (Selector) is shown by default: clicking a node MUST call selectProxy
    fireEvent.click(document.querySelector('.node-grid .node-card[title*="切换到 JP-1"]') as HTMLElement);
    await waitFor(() => expect(selSpy).toHaveBeenCalledWith('ManualGroup', 'JP-1'));

    // Nested strategy group card offers a quick jump button without triggering selection
    selSpy.mockClear();
    fireEvent.click(document.querySelector('.node-jump-btn') as HTMLElement);
    await waitFor(() => expect(tabs[1].getAttribute('aria-selected')).toBe('true'));
    expect(selSpy).not.toHaveBeenCalled();

    // In URLTest group: clicking a node must NOT call selectProxy
    fireEvent.click(document.querySelector('.node-grid .node-card[title*="URLTest"]') as HTMLElement);
    expect(selSpy).not.toHaveBeenCalled();
  });

  it('OverviewPage displays outbound mode card, active subscription quota, and jumps directly to clicked strategy group', async () => {
    vi.spyOn(nikkiApi, 'getNetworkProbe').mockResolvedValue({
      ok: true,
      status: 'done',
      updated_at: Math.floor(Date.now() / 1000)
    });
    vi.spyOn(nikkiApi, 'getOverviewMetrics').mockResolvedValue({
      ok: true,
      mode: 'rule',
      upload_total: 1024,
      download_total: 2048,
      memory: 12000000,
      connection_count: 15,
      groups: [
        { name: '主代理', type: 'Selector', now: '香港自动', leaf_now: 'HK-01', now_delay: 52, selectable: true, count: 8 },
        { name: '香港自动', type: 'URLTest', now: 'HK-01', now_delay: 64, selectable: false, count: 4 }
      ],
      timestamp: Math.floor(Date.now() / 1000)
    });

    const onOpenProxyGroup = vi.fn();
    const onModeChange = vi.fn();

    const { findByText, getByText } = render(
      <OverviewPage
        status={{
          ok: true,
          running: true,
          pid: 1234,
          uptime: 3600,
          enabled: true,
          autostart: true,
          profile: 'subscription:sub1',
          core_only: false,
          proxy_enabled: true,
          tcp_mode: 'redirect',
          udp_mode: 'tproxy',
          dns_mode: 'fake-ip',
          mode: 'rule',
          core_version: 'v1.19.32',
          dash_version: '0.7.0',
          revision: 'rev',
          controller: {
            configured: true,
            source: 'run_config',
            protocol: 'http',
            listen_addr: '127.0.0.1:9090',
            loopback_only: true,
            exposed_warning: false,
            has_secret: false,
            reachable: true
          },
          health: { controller_ok: true, nft_hijack_ok: true, tun_up: false, conflicts: [] },
          active_tasks: []
        }}
        statusError={null}
        profiles={{
          ok: true,
          active_profile: 'subscription:sub1',
          revision: 'rev',
          files: [],
          subscriptions: [
            {
              id: 'sub1',
              name: 'DemoSub',
              url: 'https://example.com/sub',
              info_url: '',
              user_agent: 'clash.meta',
              prefer: 'remote',
              expire: '2099-12-31',
              upload: '1 GB',
              download: '9 GB',
              total: '100 GB',
              used: '10 GB',
              avaliable: '90 GB',
              update: '2026-11-26',
              success: '1',
              file_exists: true,
              file_size: 4096,
              active: true
            }
          ]
        }}
        onRefreshStatus={vi.fn()}
        onToggleService={vi.fn()}
        onServiceAction={vi.fn()}
        onModeChange={onModeChange}
        onNavigate={vi.fn()}
        onOpenProxyGroup={onOpenProxyGroup}
        onTrackTask={vi.fn()}
        notify={vi.fn()}
      />
    );

    expect(await findByText('DemoSub')).toBeTruthy();
    expect(await findByText('主代理')).toBeTruthy();
    expect(await findByText('52 ms')).toBeTruthy();

    fireEvent.click(getByText('全局模式'));
    expect(onModeChange).toHaveBeenCalledWith('global');

    fireEvent.click(getByText('主代理'));
    expect(onOpenProxyGroup).toHaveBeenCalledWith('主代理');
  });

  it('OverviewPage displays domestic IP, overseas IP, ISP type, fraud score and service connectivity', async () => {
    vi.spyOn(nikkiApi, 'getNetworkProbe').mockResolvedValue({
      ok: true,
      status: 'done',
      updated_at: Math.floor(Date.now() / 1000),
      route_mode: 'transparent',
      nikki_running: true,
      domestic: {
        ok: true,
        ip: '198.51.100.10',
        country: '中国',
        region: '广东',
        city: '广州',
        location: '中国 · 广东 · 广州',
        isp: '中国移动',
        asn: 'AS9808 China Mobile',
        source: 'ipip.net'
      },
      overseas: {
        ok: true,
        ip: '203.0.113.25',
        country: '日本',
        country_code: 'JP',
        region: 'Tokyo',
        city: 'Tokyo',
        location: '日本 · Tokyo',
        isp: 'Example Broadband',
        org: 'Example Broadband',
        asn: 'AS64512',
        isp_type: 'residential',
        isp_type_label: '住宅家宽 / 宽带 ISP',
        fraud_score: 0,
        risk_level: 'low',
        risk_label: '极低风险',
        flags: {
          is_proxy: false,
          is_vpn: false,
          is_tor: false,
          is_datacenter: false,
          is_hosting: false,
          is_mobile: false
        },
        sources: ['proxycheck.io', 'ipquery.io', 'ip-api.com']
      },
      services: [
        { id: 'baidu', name: '百度', group: 'domestic', ok: true, status_kind: 'ok', http_code: 200, latency_ms: 42 },
        { id: 'google', name: 'Google', group: 'overseas', ok: true, status_kind: 'ok', http_code: 204, latency_ms: 188 }
      ]
    });

    const { findByText } = render(
      <OverviewPage
        status={{
          ok: true,
          running: false,
          pid: null,
          uptime: 0,
          enabled: false,
          profile: 'file:demo.yaml',
          core_only: false,
          proxy_enabled: true,
          tcp_mode: 'redirect',
          udp_mode: 'tproxy',
          dns_mode: 'fake-ip',
          mode: 'rule',
          core_version: 'v1.19.32',
          dash_version: '0.5.0',
          revision: 'rev',
          controller: {
            configured: true,
            source: 'uci',
            protocol: 'http',
            listen_addr: '127.0.0.1:9090',
            loopback_only: true,
            exposed_warning: false,
            has_secret: false,
            reachable: false
          },
          health: { controller_ok: false, nft_hijack_ok: false, tun_up: false, conflicts: [] },
          active_tasks: []
        }}
        statusError={null}
        onRefreshStatus={vi.fn()}
        onToggleService={vi.fn()}
        onServiceAction={vi.fn()}
        onModeChange={vi.fn()}
        onNavigate={vi.fn()}
        onTrackTask={vi.fn()}
        notify={vi.fn()}
      />
    );

    expect(await findByText('198.51.100.10')).toBeTruthy();
    expect(await findByText('203.0.113.25')).toBeTruthy();
    expect(await findByText('欺诈分 0')).toBeTruthy();
    expect(await findByText('极低风险')).toBeTruthy();
    expect(await findByText('Google')).toBeTruthy();
    expect(await findByText('188 ms')).toBeTruthy();
  });
});
