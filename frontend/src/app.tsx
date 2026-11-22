import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  fetchAuthInfo,
  loginSession,
  logoutSession,
  nikkiApi
} from './api/nikki';
import { setAuthExpiredHandler, RpcError } from './api/ubus';
import { I18nContext, getDict } from './i18n';
import { useTheme } from './hooks/useTheme';
import { usePolling } from './hooks/usePolling';
import { Layout, type PageId } from './components/Layout';
import { ToastStack, type ToastItem } from './components/Toast';
import { ConfirmModal } from './components/ConfirmModal';
import { StateView } from './components/StateView';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProxiesPage } from './pages/ProxiesPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { RulesProvidersPage } from './pages/RulesProvidersPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { LogsDiagnosticsPage } from './pages/LogsDiagnosticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { YamlEditorPage } from './pages/YamlEditorPage';
import { PanelSettingsPage } from './pages/PanelSettingsPage';
import type {
  AsyncTask,
  AuthInfo,
  CapabilitiesResponse,
  LangCode,
  ProfilesResponse,
  ProxyMode,
  SessionState,
  StatusResponse
} from './api/types';

let toastSeq = 1;

export function App() {
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<SessionState | null>(null);
  const [expiredNotice, setExpiredNotice] = useState(false);

  const [page, setPage] = useState<PageId>('overview');
  const [yamlTarget, setYamlTarget] = useState<{ category: string; name: string } | null>(null);
  const [lang, setLang] = useState<LangCode>('zh-CN');
  const { theme, setTheme } = useTheme('system');

  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfilesResponse | null>(null);
  const [activeTask, setActiveTask] = useState<AsyncTask | null>(null);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((kind: 'success' | 'error' | 'info', message: string) => {
    const id = toastSeq++;
    setToasts((prev) => [...prev.slice(-4), { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4500);
  }, []);

  useEffect(() => {
    setAuthExpiredHandler(() => {
      setSession(null);
      setExpiredNotice(true);
    });
    return () => setAuthExpiredHandler(null);
  }, []);

  const performGuestLogin = useCallback(async () => {
    const res = await loginSession('nikki-dash-guest', '', 3600);
    setSession({
      sid: res.sid,
      username: res.username,
      isGuest: true,
      isAdmin: false,
      expiresAt: Date.now() + res.expires * 1000
    });
    setExpiredNotice(false);
  }, []);

  const performLogin = useCallback(async (username: string, password: string) => {
    const res = await loginSession(username, password, 3600);
    setSession({
      sid: res.sid,
      username: res.username,
      isGuest: res.username === 'nikki-dash-guest',
      isAdmin: res.username !== 'nikki-dash-guest',
      expiresAt: Date.now() + res.expires * 1000
    });
    setExpiredNotice(false);
  }, []);

  const bootstrap = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      const info = await fetchAuthInfo();
      setAuthInfo(info);
      if (info.default_theme) setTheme(info.default_theme);
      if (info.default_lang) setLang(info.default_lang);
      if (info.lan_guest_enabled) {
        try {
          await performGuestLogin();
        } catch {
          // Stay on login screen if guest login fails
        }
      }
    } catch (err) {
      setBootError((err as Error)?.message || '无法连接到路由器 /ubus 接口');
    } finally {
      setBooting(false);
    }
  }, [performGuestLogin, setTheme]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const loadCapabilitiesAndProfiles = useCallback(async () => {
    if (!session) return;
    try {
      const [caps, profs, tasks] = await Promise.all([
        nikkiApi.capabilities(),
        nikkiApi.getProfiles(),
        nikkiApi.listTasks(5)
      ]);
      setCapabilities(caps);
      setProfiles(profs);
      const runningTask = (tasks.tasks || []).find((t) => t.status === 'queued' || t.status === 'running');
      if (runningTask) setActiveTask(runningTask);

      // If Nikki is missing or has zero profiles/subscriptions, guide user to onboarding
      if (
        !caps.dependencies.nikki_installed ||
        !caps.dependencies.mihomo_installed ||
        (profs.subscriptions.length === 0 && profs.files.length === 0)
      ) {
        setPage('onboarding');
      }
    } catch (err) {
      if (err instanceof RpcError && err.code === 'SESSION_EXPIRED') return;
      notify('error', `初始化检查失败: ${(err as Error).message}`);
    }
  }, [session, notify]);

  useEffect(() => {
    if (session) {
      void loadCapabilitiesAndProfiles();
    }
  }, [session, loadCapabilitiesAndProfiles]);

  const fetchStatus = useCallback((signal: AbortSignal) => nikkiApi.getStatus({ signal, timeoutMs: 8000 }), []);

  const { refresh: refreshStatus } = usePolling(
    fetchStatus,
    (res) => {
      setStatus(res);
      setStatusError(null);
      if (!activeTask && res.active_tasks && res.active_tasks.length > 0) {
        setActiveTask(res.active_tasks[0]);
      }
    },
    (err) => {
      if (err instanceof RpcError && err.code === 'SESSION_EXPIRED') return;
      setStatusError((err as Error).message);
    },
    { intervalMs: 4000, enabled: session !== null }
  );

  // Poll active async task until terminal state
  const pollTask = useCallback(
    (signal: AbortSignal) => nikkiApi.getTask(activeTask!.id, { signal }),
    [activeTask]
  );

  usePolling(
    pollTask,
    (res) => {
      const t = res.task;
      setActiveTask(t);
      if (t.status !== 'queued' && t.status !== 'running') {
        if (t.status === 'succeeded') notify('success', t.message || '任务已完成');
        else if (t.status === 'rolled_back') notify('error', `任务失败并已回滚: ${t.error || t.message}`);
        else if (t.status === 'unknown') notify('info', t.message || '任务超时，状态未明，请核对实时状态');
        else notify('error', `任务失败: ${t.error || t.message}`);
        void refreshStatus();
      }
    },
    () => {},
    {
      intervalMs: 1200,
      enabled: session !== null && activeTask !== null && (activeTask.status === 'queued' || activeTask.status === 'running')
    }
  );

  const runServiceAction = async (act: 'start' | 'stop' | 'restart' | 'reload') => {
    setBusyAction(true);
    try {
      const res = await nikkiApi.serviceAction(act, `svc_${act}_${Math.floor(Date.now() / 3000)}`);
      setActiveTask(res.task);
      notify('info', `已提交 Nikki ${act} 任务...`);
    } catch (err) {
      notify('error', (err as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleToggleService = (next: boolean) => {
    if (!next) {
      setStopConfirm(true);
    } else {
      void runServiceAction('start');
    }
  };

  const handleModeChange = async (mode: ProxyMode) => {
    setBusyAction(true);
    try {
      await nikkiApi.setMode(mode, false);
      setStatus((prev) => (prev ? { ...prev, mode } : prev));
      notify('success', `代理模式已切换为 ${mode}`);
    } catch (err) {
      notify('error', (err as Error).message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleLogout = async () => {
    await logoutSession();
    setSession(null);
    setStatus(null);
    setActiveTask(null);
    setExpiredNotice(false);
  };

  const handleSwitchToAdminLogin = async () => {
    await logoutSession();
    setSession(null);
    setExpiredNotice(false);
  };

  const i18nVal = { lang, setLang, t: getDict(lang) };

  if (booting) {
    return (
      <div class="login-wrap">
        <StateView kind="loading" title="正在连接 NikkiDash..." message="检查认证模式与路由器 RPC 状态" />
      </div>
    );
  }

  if (bootError) {
    return (
      <div class="login-wrap">
        <StateView
          kind="error"
          title="无法连接 NikkiDash 后端"
          message={bootError}
          actionLabel="重新连接"
          onAction={bootstrap}
        />
      </div>
    );
  }

  if (!session) {
    return (
      <I18nContext.Provider value={i18nVal}>
        <LoginPage
          authInfo={authInfo}
          expiredNotice={expiredNotice}
          onLogin={performLogin}
          onGuestLogin={performGuestLogin}
        />
      </I18nContext.Provider>
    );
  }

  return (
    <I18nContext.Provider value={i18nVal}>
      <Layout
        page={page}
        onNavigate={setPage}
        session={session}
        status={status}
        onToggleService={handleToggleService}
        onModeChange={handleModeChange}
        onLogout={handleLogout}
        onSwitchToAdminLogin={handleSwitchToAdminLogin}
        busyAction={busyAction}
      >
        {activeTask && (
          <div
            class={`alert ${
              activeTask.status === 'succeeded'
                ? 'alert-success'
                : activeTask.status === 'failed' || activeTask.status === 'rolled_back' || activeTask.status === 'rollback_failed'
                  ? 'alert-danger'
                  : activeTask.status === 'unknown'
                    ? 'alert-warning'
                    : 'alert-info'
            }`}
          >
            <div>
              <strong>
                后台任务 ({activeTask.kind}) — {activeTask.status}
              </strong>
              <div>{activeTask.message}</div>
              {activeTask.error && (
                <div class="mono" style={{ fontSize: '12px', marginTop: '4px' }}>
                  {activeTask.error}
                </div>
              )}
              {activeTask.steps.length > 0 && (
                <div style={{ fontSize: '11.5px', opacity: 0.85, marginTop: '4px' }}>
                  步骤: {activeTask.steps.map((s) => s.name).join(' → ')}
                </div>
              )}
            </div>
            {activeTask.status !== 'queued' && activeTask.status !== 'running' && (
              <button class="btn btn-sm btn-ghost" onClick={() => setActiveTask(null)}>
                关闭
              </button>
            )}
          </div>
        )}

        {page === 'overview' && (
          <OverviewPage
            status={status}
            statusError={statusError}
            onRefreshStatus={refreshStatus}
            onToggleService={handleToggleService}
            onServiceAction={(a) => void runServiceAction(a)}
            onModeChange={(m) => void handleModeChange(m)}
            onNavigate={(p) => setPage(p)}
            onTrackTask={setActiveTask}
            notify={notify}
          />
        )}

        {page === 'proxies' && <ProxiesPage running={status?.running ?? false} notify={notify} />}

        {page === 'connections' && <ConnectionsPage running={status?.running ?? false} notify={notify} />}

        {page === 'rules' && <RulesProvidersPage running={status?.running ?? false} notify={notify} />}

        {page === 'profiles' && (
          <ProfilesPage
            onRefreshStatus={refreshStatus}
            onTrackTask={setActiveTask}
            onEditFile={(category, name) => {
              setYamlTarget({ category, name });
              setPage('yaml');
            }}
            notify={notify}
          />
        )}

        {page === 'settings' && (
          <SettingsPage onTrackTask={setActiveTask} onRefreshStatus={refreshStatus} notify={notify} />
        )}

        {page === 'yaml' && <YamlEditorPage initialTarget={yamlTarget} notify={notify} />}

        {page === 'logs' && <LogsDiagnosticsPage notify={notify} />}

        {page === 'panel' && (
          <PanelSettingsPage
            session={session}
            theme={theme}
            lang={lang}
            onThemeChange={setTheme}
            onLangChange={setLang}
            onSwitchToAdminLogin={handleSwitchToAdminLogin}
            notify={notify}
          />
        )}

        {page === 'onboarding' && (
          <OnboardingPage
            capabilities={capabilities}
            profiles={profiles}
            onRefreshAll={() => {
              void loadCapabilitiesAndProfiles();
              void refreshStatus();
            }}
            onDone={() => setPage('overview')}
            notify={notify}
          />
        )}
      </Layout>

      <ConfirmModal
        open={stopConfirm}
        title="停止 Nikki 代理服务？"
        message="停止后将清除 Nikki 透明代理 nftables 规则并恢复路由器常规网络转发，不会关闭 NikkiDash 面板。"
        danger
        busy={busyAction}
        confirmLabel="确认停止"
        onConfirm={() => {
          setStopConfirm(false);
          void runServiceAction('stop');
        }}
        onCancel={() => setStopConfirm(false)}
      />

      <ToastStack
        items={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))}
      />
    </I18nContext.Provider>
  );
}
