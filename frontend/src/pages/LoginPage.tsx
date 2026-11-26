import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../i18n';
import { IconError, IconWarning } from '../components/Icons';
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
        <div class="login-brand-bar">
          <span class="brand-wordmark">{t.appName}</span>
          <span class="brand-sep" aria-hidden="true" />
          <span class="brand-sub mono">v{props.authInfo?.version || '0.7.0'}</span>
        </div>

        <div class="login-body">
          <h1 class="section-title" style={{ marginBottom: '8px' }}>
            {t.login.title}
          </h1>
          <p style={{ margin: '0 0 20px', fontSize: '16px', lineHeight: '26px', color: 'var(--text)' }}>
            {t.login.subtitle}
          </p>

          {props.expiredNotice && (
            <div class="alert alert-warning" role="status">
              <IconWarning className="alert-icon" />
              <div class="alert-body">{t.login.expired}</div>
            </div>
          )}

          {props.authInfo?.wan_warning && (
            <div class="alert alert-danger" role="alert">
              <IconError className="alert-icon" />
              <div class="alert-body">{t.login.wanBanner}</div>
            </div>
          )}

          {error && (
            <div class="alert alert-danger" role="alert">
              <IconError className="alert-icon" />
              <div class="alert-body">{error}</div>
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
                class={`input ${error ? 'input-error' : ''}`}
                type="password"
                autocomplete="current-password"
                value={password}
                onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
              />
            </div>

            <div class="field" style={{ gap: '4px' }}>
              <label class="check-row">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember((e.currentTarget as HTMLInputElement).checked)}
                />
                <span>{t.login.remember}</span>
              </label>
              <span class="field-hint">{t.login.rememberHint}</span>
            </div>

            <button class="btn btn-lg btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? t.login.loggingIn : t.login.submit}
            </button>
          </form>

          {props.authInfo?.lan_guest_enabled && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                class="btn btn-lg"
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
    </div>
  );
}
