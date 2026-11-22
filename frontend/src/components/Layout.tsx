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
  IconSpark,
  IconSun,
  IconMoon
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
  const { t, lang } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navGroups: Array<{
    id: string;
    label: string;
    items: Array<{ id: PageId; label: string; icon: (p: { className?: string }) => preact.JSX.Element }>;
  }> = [
    {
      id: 'nav-runtime',
      label: t.nav.groupRuntime,
      items: [
        { id: 'overview', label: t.nav.overview, icon: IconOverview },
        { id: 'proxies', label: t.nav.proxies, icon: IconProxies },
        { id: 'connections', label: t.nav.connections, icon: IconConnections },
        { id: 'rules', label: t.nav.rules, icon: IconRules }
      ]
    },
    {
      id: 'nav-config',
      label: t.nav.groupConfig,
      items: [
        { id: 'profiles', label: t.nav.profiles, icon: IconProfiles },
        { id: 'settings', label: t.nav.settings, icon: IconSettings },
        { id: 'yaml', label: t.nav.yaml, icon: IconCode }
      ]
    },
    {
      id: 'nav-system',
      label: t.nav.groupSystem,
      items: [
        { id: 'logs', label: t.nav.logs, icon: IconLogs },
        { id: 'panel', label: t.nav.panel, icon: IconShield },
        { id: 'onboarding', label: t.nav.onboarding, icon: IconSpark }
      ]
    }
  ];

  const mobileTabs: Array<{ id: PageId; label: string; icon: (p: { className?: string }) => preact.JSX.Element }> = [
    { id: 'overview', label: lang === 'en-US' ? 'Home' : '总览', icon: IconOverview },
    { id: 'proxies', label: lang === 'en-US' ? 'Proxy' : '代理', icon: IconProxies },
    { id: 'connections', label: lang === 'en-US' ? 'Conn' : '连接', icon: IconConnections },
    { id: 'profiles', label: lang === 'en-US' ? 'Sub' : '配置', icon: IconProfiles },
    { id: 'settings', label: lang === 'en-US' ? 'Set' : '设置', icon: IconSettings }
  ];

  const running = props.status?.running ?? false;
  const activeTaskCount = props.status?.active_tasks?.length ?? 0;
  const isBusy = props.busyAction || activeTaskCount > 0;
  const currentMode = props.status?.mode ?? 'rule';
  const profileLabel =
    props.profileDisplayName ||
    (props.status?.profile ? props.status.profile.replace(/^(file|subscription):/, '') : t.status.noProfile);
  const avatarText = (props.session.isGuest ? (lang === 'en-US' ? 'G' : '客') : props.session.username.slice(0, 1).toUpperCase()) || 'U';
  const versionText = `v${props.status?.dash_version || '0.5.0'}`;

  const navigate = (p: PageId) => {
    props.onNavigate(p);
    setDrawerOpen(false);
  };

  return (
    <div class="app-shell">
      <div class={`sidebar-backdrop ${drawerOpen ? 'open' : ''}`} onClick={() => setDrawerOpen(false)} />

      <aside class={`sidebar ${drawerOpen ? 'open' : ''}`} aria-label="主导航">
        <button
          type="button"
          class="sidebar-brand"
          onClick={() => navigate('overview')}
          title={`${t.appName} ${versionText}`}
        >
          <span class="brand-wordmark">{t.appName}</span>
          <span class="brand-short">ND</span>
          <span class="brand-sep" aria-hidden="true" />
          <span class="brand-sub">{lang === 'en-US' ? 'Console' : '控制台'}</span>
        </button>

        <nav class="sidebar-nav" aria-label="功能导航">
          {navGroups.map((g) => (
            <div key={g.id} class="nav-group">
              <div id={g.id} class="nav-group-label">
                {g.label}
              </div>
              <div class="nav-items" role="group" aria-labelledby={g.id}>
                {g.items.map((item) => {
                  const Icon = item.icon;
                  const active = props.page === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      class={`nav-item ${active ? 'active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                      title={item.label}
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
          <div class="row-between" style={{ gap: '8px' }}>
            <span class="sidebar-version mono">{versionText}</span>
            {props.session.isGuest ? (
              <button type="button" class="btn btn-ghost" onClick={props.onSwitchToAdminLogin}>
                管理员登录
              </button>
            ) : (
              <button type="button" class="btn btn-ghost" onClick={props.onLogout}>
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
              aria-label="打开导航菜单"
              onClick={() => setDrawerOpen((v) => !v)}
            >
              <IconMenu />
            </button>

            <span class={`badge badge-lg ${isBusy ? 'badge-amber' : running ? 'badge-green' : ''}`}>
              {isBusy && <span class="spinner" style={{ width: '14px', height: '14px' }} />}
              {isBusy ? t.status.busy : running ? t.status.running : t.status.stopped}
            </span>

            <button
              type="button"
              class="profile-chip"
              title={`${t.status.activeProfile}: ${props.status?.profile || '—'}（点击管理）`}
              onClick={() => navigate('profiles')}
            >
              <span class="profile-chip-text">{profileLabel}</span>
            </button>
          </div>

          <div class="topbar-right">
            <div class="segmented" role="group" aria-label="代理模式">
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
            >
              <input
                type="checkbox"
                aria-label={running ? '停止代理服务' : '启动代理服务'}
                checked={running}
                disabled={isBusy}
                onChange={(e) => {
                  const target = e.currentTarget as HTMLInputElement;
                  const desired = target.checked;
                  target.checked = running;
                  props.onToggleService(desired);
                }}
              />
              <span class="switch-track" />
              <span class="topbar-desktop-only" style={{ fontWeight: 500 }}>
                {running ? t.status.running : t.status.stopped}
              </span>
            </label>

            <span class="topbar-divider topbar-desktop-only" aria-hidden="true" />

            {props.onToggleTheme && (
              <button
                type="button"
                class="icon-btn"
                onClick={props.onToggleTheme}
                aria-label={props.resolvedTheme === 'light' ? '切换深色主题' : '切换浅色主题'}
                title={props.resolvedTheme === 'light' ? '当前浅色，点击切换深色' : '当前深色，点击切换浅色'}
              >
                {props.resolvedTheme === 'light' ? <IconSun /> : <IconMoon />}
              </button>
            )}

            {props.onToggleLang && (
              <button
                type="button"
                class="btn btn-ghost topbar-desktop-only"
                onClick={props.onToggleLang}
                title="切换中英文界面"
              >
                {props.lang === 'en-US' ? '中文' : 'EN'}
              </button>
            )}

            <span class="topbar-divider topbar-desktop-only" aria-hidden="true" />

            <div class="user-trigger topbar-desktop-only">
              <span class="user-avatar" aria-hidden="true">
                {avatarText}
              </span>
              <span style={{ fontWeight: 500 }}>
                {props.session.isGuest ? t.status.guest : props.session.username}
              </span>
            </div>
          </div>
        </header>

        <main class="content-container">{props.children}</main>
      </div>

      <nav class="mobile-bottom-nav" aria-label="底部快捷导航">
        {mobileTabs.map((item) => {
          const Icon = item.icon;
          const active = props.page === item.id;
          return (
            <button
              key={item.id}
              type="button"
              class={`mobile-tab ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
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
