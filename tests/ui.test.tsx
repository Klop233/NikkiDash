import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { LoginPage } from '../frontend/src/pages/LoginPage';
import { ConnectionsPage } from '../frontend/src/pages/ConnectionsPage';
import { LogsDiagnosticsPage } from '../frontend/src/pages/LogsDiagnosticsPage';
import { YamlEditorPage } from '../frontend/src/pages/YamlEditorPage';
import { ProxiesPage } from '../frontend/src/pages/ProxiesPage';
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

  it('ProxiesPage only allows manual node selection on Selector groups, never URLTest/Fallback', async () => {
    vi.spyOn(nikkiApi, 'getProxies').mockResolvedValue({
      ok: true,
      proxies: {
        AutoGroup: { name: 'AutoGroup', type: 'URLTest', now: 'HK-1', all: ['HK-1', 'JP-1'] },
        ManualGroup: { name: 'ManualGroup', type: 'Selector', now: 'HK-1', all: ['HK-1', 'JP-1'] },
        'HK-1': { name: 'HK-1', type: 'Shadowsocks', history: [] },
        'JP-1': { name: 'JP-1', type: 'Shadowsocks', history: [] }
      },
      providers: {}
    });
    const selSpy = vi.spyOn(nikkiApi, 'selectProxy').mockResolvedValue({ ok: true });

    const { findByText, getAllByText } = render(<ProxiesPage running={true} notify={vi.fn()} />);
    await findByText('AutoGroup');

    // ManualGroup comes first (Selector sorted before URLTest), AutoGroup second
    const jpNodes = getAllByText('JP-1');
    fireEvent.click(jpNodes[1]); // AutoGroup -> must NOT call selectProxy
    expect(selSpy).not.toHaveBeenCalled();

    fireEvent.click(jpNodes[0]); // ManualGroup -> MUST call selectProxy
    await waitFor(() => expect(selSpy).toHaveBeenCalledWith('ManualGroup', 'JP-1'));
  });
});
