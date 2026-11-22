import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { LoginPage } from '../frontend/src/pages/LoginPage';
import { ConnectionsPage } from '../frontend/src/pages/ConnectionsPage';
import { LogsDiagnosticsPage } from '../frontend/src/pages/LogsDiagnosticsPage';
import { nikkiApi } from '../frontend/src/api/nikki';

describe('NikkiDash UI components & XSS safety', () => {
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
    expect(onLogin).toHaveBeenCalledWith('root', 'routerpass');
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
});
