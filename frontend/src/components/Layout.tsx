import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  IconOverview,
  IconProxies,
  IconConnections,
  IconRules,
  IconProfiles,
  IconSettings,
  IconCode,
  IconLogs,
  IconShield,
  IconMenu,
  IconSpark
} from './Icons';
import { useI18n } from '../i18n';
import type { LangCode, ProxyMode, SessionState, StatusResponse } from '../api/types';

export type PageId =
  | 'overview'
  | 'proxies'
  | 'connections'
  | 'rules'
  | 'profiles'
  | 'settings'
  | 'yaml'
  | 'logs'
  | 'panel'
  | 'onboarding';

export function Layout(props: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  session: SessionState;
  status: StatusResponse | null;
  profileDisplayName?: string;
  resolvedTheme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  lang?: LangCode;
  onToggleLang?: () => void;
  onToggleService: (nextRunning: boolean) => void;
  onModeChange: (mode: ProxyMode) => void;
  onLogout: () => void;
  onSwitchToAdminLogin: () => void;
  busyAction: boolean;
  children: ComponentChildren;
}) {
  const { t } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navGroups: Array<{
    label: string;
    items: Array<{ id: PageId; label: string; icon: (p: { className?: string }) => preact.JSX.Element }>;
  }> = [
    {
      label: t.nav.groupRuntime,
      items: [
        { id: 'overview', label: t.nav.overview, icon: IconOverview },
        { id: 'proxies', label: t.nav.proxies, icon: IconProxies },
        { id: 'connections', label: t.nav.connections, icon: IconConnections },
        { id: 'rules', label: t.nav.rules, icon: IconRules }
      ]
    },
    {
      label: t.nav.groupConfig,
      items: [
        { id: 'profiles', label: t.nav.profiles, icon: IconProfiles },
        { id: 'settings', label: t.nav.settings, icon: IconSettings },
        { id: 'yaml', label: t.nav.yaml, icon: IconCode }
      ]
    },
    {
      label: t.nav.groupSystem,
      items: [
        { id: 'logs', label: t.nav.logs, icon: IconLogs },
        { id: 'panel', label: t.nav.panel, icon: IconShield },
        { id: 'onboarding', label: t.nav.onboarding, icon: IconSpark }
      ]
    }
  ];

  const mobileTabs: Array<{ id: PageId; label: string; icon: (p: { className?: string }) => preact.JSX.Element }> = [
    { id: 'overview', label: t.nav.overview, icon: IconOverview },
    { id: 'proxies', label: t.nav.proxies, icon: IconProxies },
    { id: 'connections', label: t.nav.connections, icon: IconConnections },
    { id: 'profiles', label: t.nav.profiles, icon: IconProfiles },
    { id: 'settings', label: t.nav.settings, icon: IconSettings }
  ];

  const running = props.status?.running ?? false;
  const activeTaskCount = props.status?.active_tasks?.length ?? 0;
  const isBusy = props.busyAction || activeTaskCount > 0;
  const currentMode = props.status?.mode ?? 'rule';
  const profileLabel =
    props.profileDisplayName ||
    (props.status?.profile ? props.status.profile.replace(/^(file|subscription):/, '') : t.status.noProfile);

  const navigate = (p: PageId) => {
    props.onNavigate(p);
    setDrawerOpen(false);
  };

  return (
    <div class="app-shell">
      <div class={`sidebar-backdrop ${drawerOpen ? 'open' : ''}`} onClick={() => setDrawerOpen(false)} />

      <aside class={`sidebar ${drawerOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div class="sidebar-brand">
          <div class="brand-mark">ND</div>
          <div class="brand-meta">
            <span class="brand-title">{t.appName}</span>
            <span class="brand-sub">v{props.status?.dash_version || '0.3.0'}</span>
          </div>
        </div>

        <nav class="sidebar-nav">
          {navGroups.map((g) => (
            <div key={g.label}>
              <div class="nav-group-label">{g.label}</div>
              <div class="nav-items">
                {g.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      class={`nav-item ${props.page === item.id ? 'active' : ''}`}
                      onClick={() => navigate(item.id)}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div class="sidebar-footer">
          <div class="row-between" style={{ gap: '6px' }}>
            {props.onToggleTheme && (
              <button
                type="button"
                class="btn btn-sm"
                style={{ flex: 1 }}
                onClick={props.onToggleTheme}
                title="切换明暗主题"
              >
                {props.resolvedTheme === 'light' ? '☀ 浅色' : '☾ 深色'}
              </button>
            )}
            {props.onToggleLang && (
              <button
                type="button"
                class="btn btn-sm"
                style={{ flex: 1 }}
                onClick={props.onToggleLang}
                title="Switch Language"
              >
                {props.lang === 'en-US' ? 'EN / 中' : '中 / EN'}
              </button>
            )}
          </div>

          <div class="session-pill">
            <div>
              <div style={{ fontWeight: 600 }}>{props.session.username}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {props.session.isGuest ? t.status.guest : t.status.admin}
              </div>
            </div>
            {props.session.isGuest ? (
              <button class="btn btn-sm btn-primary" onClick={props.onSwitchToAdminLogin}>
                管理员登录
              </button>
            ) : (
              <button class="btn btn-sm" onClick={props.onLogout}>
                {t.status.logout}
              </button>
            )}
          </div>
        </div>
      </aside>

      <div class="main-area">
        <header class="topbar">
          <div class="topbar-left">
            <button
              type="button"
              class="menu-btn"
              aria-label="Open menu"
              onClick={() => setDrawerOpen((v) => !v)}
            >
              <IconMenu />
            </button>

            <span class={`badge ${isBusy ? 'badge-amber' : running ? 'badge-green' : 'badge-red'}`}>
              {isBusy ? <span class="spinner" style={{ width: '10px', height: '10px' }} /> : <span class="dot" />}
              {isBusy ? t.status.busy : running ? t.status.running : t.status.stopped}
            </span>

            <button
              type="button"
              class="badge"
              style={{ border: 0, cursor: 'pointer' }}
              title={`${t.status.activeProfile}: ${props.status?.profile || '-'}（点击管理）`}
              onClick={() => navigate('profiles')}
            >
              {profileLabel}
            </button>
          </div>

          <div class="topbar-right">
            <div class="segmented" role="group" aria-label="Proxy mode">
              {(['rule', 'global', 'direct'] as ProxyMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  class={currentMode === m ? 'active' : ''}
                  disabled={!running || isBusy}
                  onClick={() => props.onModeChange(m)}
                >
                  {t.status[m]}
                </button>
              ))}
            </div>

            <label
              class="switch"
              title={running ? t.status.stop : t.status.start}
              style={{ opacity: isBusy ? 0.6 : 1 }}
            >
              <input
                type="checkbox"
                checked={running}
                disabled={isBusy}
                onChange={(e) => {
                  const target = e.currentTarget as HTMLInputElement;
                  const desired = target.checked;
                  // Keep checkbox synced with live running state until action succeeds
                  target.checked = running;
                  props.onToggleService(desired);
                }}
              />
              <span class="switch-track" />
              <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
                {isBusy ? t.status.busy : running ? t.status.running : t.status.stopped}
              </span>
            </label>
          </div>
        </header>

        <main class="content-container">{props.children}</main>
      </div>

      <nav class="mobile-bottom-nav" aria-label="Mobile quick navigation">
        {mobileTabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              class={`mobile-tab ${props.page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
