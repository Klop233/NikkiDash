import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../i18n';
import type { AuthInfo } from '../api/types';

export function LoginPage(props: {
  authInfo: AuthInfo | null;
  expiredNotice: boolean;
  onLogin: (username: string, password: string, remember: boolean) => Promise<void>;
  onGuestLogin: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => !(props.authInfo?.wan_warning ?? false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (props.authInfo) {
      setRemember(!props.authInfo.wan_warning);
    }
  }, [props.authInfo?.wan_warning]);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await props.onLogin(username.trim(), password, remember);
    } catch (err) {
      setError((err as Error)?.message || t.login.failed);
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  const handleGuest = async () => {
    setError('');
    setBusy(true);
    try {
      await props.onGuestLogin();
    } catch (err) {
      setError((err as Error)?.message || t.login.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login-wrap">
      <div class="login-card">
        <div class="row" style={{ marginBottom: '16px' }}>
          <div class="brand-mark">ND</div>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px' }}>{t.login.title}</h1>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {t.appName} v{props.authInfo?.version || '0.3.1'}
            </div>
          </div>
        </div>

        <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t.login.subtitle}</p>

        {props.expiredNotice && <div class="alert alert-warning">{t.login.expired}</div>}
        {props.authInfo?.wan_warning && <div class="alert alert-danger">{t.login.wanBanner}</div>}
        {error && (
          <div class="alert alert-danger" role="alert">
            {error}
          </div>
        )}

        <form class="stack" onSubmit={handleSubmit}>
          <div class="field">
            <label class="field-label" for="nd-user">
              {t.login.username}
            </label>
            <input
              id="nd-user"
              class="input"
              type="text"
              autocomplete="username"
              value={username}
              onInput={(e) => setUsername((e.currentTarget as HTMLInputElement).value)}
              required
            />
          </div>

          <div class="field">
            <label class="field-label" for="nd-pass">
              {t.login.password}
            </label>
            <input
              id="nd-pass"
              class="input"
              type="password"
              autocomplete="current-password"
              value={password}
              onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
            />
          </div>

          <div class="field" style={{ gap: '3px' }}>
            <label class="row" style={{ cursor: 'pointer', fontSize: '12.5px' }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember((e.currentTarget as HTMLInputElement).checked)}
              />
              <span>{t.login.remember}</span>
            </label>
            <span class="field-hint">{t.login.rememberHint}</span>
          </div>

          <button class="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', padding: '10px' }}>
            {busy ? t.login.loggingIn : t.login.submit}
          </button>
        </form>

        {props.authInfo?.lan_guest_enabled && (
          <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              class="btn"
              disabled={busy}
              onClick={handleGuest}
              style={{ width: '100%' }}
            >
              {t.login.guestButton}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
