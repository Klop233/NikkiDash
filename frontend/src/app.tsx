import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import {
  checkSessionAlive,
  fetchAuthInfo,
  loginSession,
  logoutSession,
  nikkiApi
} from './api/nikki';
import {
  clearSessionSid,
  loadStoredSession,
  saveStoredSession,
  setAuthExpiredHandler,
  setSessionSid,
  RpcError
} from './api/ubus';
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
import { formatTaskKind, formatTaskStatus, formatTaskStep } from './utils/format';
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
const LANG_STORAGE_KEY = 'nikki_dash_lang';
const VALID_PAGES: PageId[] = [
  'overview', 'proxies', 'connections', 'rules', 'profiles',
  'settings', 'yaml', 'logs', 'panel', 'onboarding'
];

function readHashPage(): PageId {
  if (typeof window === 'undefined') return 'overview';
  const raw = window.location.hash.replace(/^#/, '') as PageId;
  return VALID_PAGES.includes(raw) ? raw : 'overview';
}

function readStoredLang(): LangCode | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_STORAGE_KEY) : null;
    if (v === 'zh-CN' || v === 'en-US') return v;
  } catch {
    // ignore
  }
  return null;
}

export function App() {
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<SessionState | null>(null);
  const [expiredNotice, setExpiredNotice] = useState(false);

  const [page, setPageState] = useState<PageId>(readHashPage);
  const [yamlTarget, setYamlTarget] = useState<{ category: string; name: string } | null>(null);
  const [lang, setLangState] = useState<LangCode>(() => readStoredLang() || 'zh-CN');
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme('system');

  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfilesResponse | null>(null);
  const [activeTask, setActiveTask] = useState<AsyncTask | null>(null);
  const [taskCompletedSeq, setTaskCompletedSeq] = useState(0);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const setPage = useCallback((next: PageId) => {
    setPageState(next);
    if (typeof window !== 'undefined' && window.location.hash !== `#${next}`) {
      window.location.hash = next;
    }
  }, []);

  const setLang = useCallback((next: LangCode) => {
    setLangState(next);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHash = () => setPageState(readHashPage());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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
    const res = await loginSession('nikki-dash-guest', '', authInfo?.session_timeout ?? 3600);
    const sess: SessionState = {
      sid: res.sid,
      username: res.username,
      isGuest: true,
      isAdmin: false,
      expiresAt: Date.now() + res.expires * 1000
    };
    saveStoredSession(sess, false);
    setSession(sess);
    setExpiredNotice(false);
  }, [authInfo?.session_timeout]);

  const performLogin = useCallback(
    async (username: string, password: string, remember = true) => {
      const res = await loginSession(username, password, authInfo?.session_timeout ?? 3600);
      const sess: SessionState = {
        sid: res.sid,
        username: res.username,
        isGuest: res.username === 'nikki-dash-guest',
        isAdmin: res.username !== 'nikki-dash-guest',
        expiresAt: Date.now() + res.expires * 1000
      };
      saveStoredSession(sess, remember);
      setSession(sess);
      setExpiredNotice(false);
    },
    [authInfo?.session_timeout]
  );

  const bootstrap = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      const info = await fetchAuthInfo();
      setAuthInfo(info);
      try {
        if (info.default_theme && !localStorage.getItem('nikki_dash_theme')) setTheme(info.default_theme);
        if (info.default_lang && !localStorage.getItem(LANG_STORAGE_KEY)) setLangState(info.default_lang);
      } catch {
        if (info.default_theme) setTheme(info.default_theme);
        if (info.default_lang) setLangState(info.default_lang);
      }

      // Restore persisted session across page refreshes & browser restarts after verifying with router
      const stored = loadStoredSession();
      if (stored && stored.sid) {
        setSessionSid(stored.sid);
        const alive = await checkSessionAlive();
        if (alive) {
          setSession(stored);
          setExpiredNotice(false);
          return;
        }
        clearSessionSid();
      }

      if (info.lan_guest_enabled) {
        try {
          const res = await loginSession('nikki-dash-guest', '', info.session_timeout ?? 3600);
          const sess: SessionState = {
            sid: res.sid,
            username: res.username,
            isGuest: true,
            isAdmin: false,
            expiresAt: Date.now() + res.expires * 1000
          };
          saveStoredSession(sess, false);
          setSession(sess);
        } catch {
          // Stay on login screen if guest login fails
        }
      }
    } catch (err) {
      setBootError((err as Error)?.message || '无法连接到路由器 /ubus 接口');
    } finally {
      setBooting(false);
    }
  }, [setTheme]);

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
  }, [session, notify, setPage]);

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

  const taskInFlight = activeTask !== null && (activeTask.status === 'queued' || activeTask.status === 'running');

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
        if (t.status === 'succeeded') notify('success', `${formatTaskKind(t.kind)}：${t.message || '已完成'}`);
        else if (t.status === 'rolled_back') notify('error', `${formatTaskKind(t.kind)}失败并已回滚：${t.error || t.message}`);
        else if (t.status === 'unknown') notify('info', t.message || '任务超时，请核对实时状态');
        else notify('error', `${formatTaskKind(t.kind)}失败：${t.error || t.message}`);
        setTaskCompletedSeq((n) => n + 1);
        void refreshStatus();
        if (
          t.kind === 'install_core' ||
          t.kind === 'remove_luci_nikki' ||
          t.kind === 'update_subscription' ||
          t.kind === 'apply_config'
        ) {
          void loadCapabilitiesAndProfiles();
        }
      }
    },
    () => {},
    {
      intervalMs: 1200,
      enabled: session !== null && taskInFlight,
      refreshKey: activeTask?.id
    }
  );

  const runServiceAction = async (act: 'start' | 'stop' | 'restart' | 'reload') => {
    setBusyAction(true);
    try {
      const res = await nikkiApi.serviceAction(act, `svc_${act}_${Math.floor(Date.now() / 3000)}`);
      setActiveTask(res.task);
      const labels: Record<string, string> = { start: '启动', stop: '停止', restart: '重启', reload: '重载' };
      notify('info', `已提交 Nikki ${labels[act] || act}任务...`);
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
      const modeNames: Record<ProxyMode, string> = { rule: '规则模式', global: '全局模式', direct: '直连模式' };
      notify('success', `已切换为${modeNames[mode]}`);
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

  const friendlyProfileName = useMemo(() => {
    const raw = status?.profile || '';
    if (!raw) return '';
    if (raw.startsWith('subscription:')) {
      const id = raw.slice('subscription:'.length);
      const sub = profiles?.subscriptions?.find((s) => s.id === id);
      return sub ? `订阅: ${sub.name}` : raw;
    }
    return raw.replace(/^file:/, '');
  }, [status?.profile, profiles?.subscriptions]);

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
        profileDisplayName={friendlyProfileName}
        resolvedTheme={resolvedTheme}
        onToggleTheme={toggleTheme}
        lang={lang}
        onToggleLang={() => setLang(lang === 'zh-CN' ? 'en-US' : 'zh-CN')}
        onToggleService={handleToggleService}
        onModeChange={handleModeChange}
        onLogout={handleLogout}
        onSwitchToAdminLogin={handleSwitchToAdminLogin}
        busyAction={busyAction || taskInFlight}
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
            <div style={{ flex: 1 }}>
              <div class="row" style={{ gap: '8px' }}>
                {taskInFlight && <span class="spinner" />}
                <strong>
                  {formatTaskKind(activeTask.kind)} — {formatTaskStatus(activeTask.status)}
                </strong>
              </div>
              {activeTask.message && <div style={{ marginTop: '3px' }}>{activeTask.message}</div>}
              {activeTask.error && (
                <div class="mono" style={{ fontSize: '12px', marginTop: '4px', wordBreak: 'break-word' }}>
                  {activeTask.error}
                </div>
              )}
              {activeTask.steps.length > 0 && (
                <div style={{ fontSize: '11.5px', opacity: 0.88, marginTop: '6px' }}>
                  进度：{activeTask.steps.map((s) => formatTaskStep(s.name)).join(' → ')}
                </div>
              )}
            </div>
            {!taskInFlight && (
              <button class="btn btn-sm btn-ghost" onClick={() => setActiveTask(null)}>
                关闭
              </button>
            )}
          </div>
        )}

        {page === 'overview' && (
          <OverviewPage
            capabilities={capabilities}
            status={status}
            statusError={statusError}
            profileDisplayName={friendlyProfileName}
            busyAction={busyAction || taskInFlight}
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
            refreshSeq={taskCompletedSeq}
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
          <SettingsPage
            refreshSeq={taskCompletedSeq}
            onTrackTask={setActiveTask}
            onRefreshStatus={refreshStatus}
            notify={notify}
          />
        )}

        {page === 'yaml' && <YamlEditorPage initialTarget={yamlTarget} notify={notify} />}

        {page === 'logs' && <LogsDiagnosticsPage notify={notify} />}

        {page === 'panel' && (
          <PanelSettingsPage
            session={session}
            capabilities={capabilities}
            theme={theme}
            lang={lang}
            onThemeChange={setTheme}
            onLangChange={setLang}
            onSwitchToAdminLogin={handleSwitchToAdminLogin}
            onTrackTask={setActiveTask}
            onRefreshCapabilities={() => void loadCapabilitiesAndProfiles()}
            notify={notify}
          />
        )}

        {page === 'onboarding' && (
          <OnboardingPage
            session={session}
            capabilities={capabilities}
            profiles={profiles}
            onTrackTask={setActiveTask}
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
