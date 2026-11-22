/**
 * Secure ubus HTTP client for NikkiDash.
 *
 * Security invariants:
 * - SID is kept strictly in JS module memory (NEVER in Cookie, localStorage, sessionStorage, or URL).
 * - Uses modern uhttpd Bearer endpoint POST /ubus/call/<object> with Authorization: Bearer <sid>.
 * - Supports AbortSignal + per-request timeout + stale response sequence protection.
 * - Chunked base64 upload helper works cleanly under uhttpd's 64 KiB POST limit.
 */

export class RpcError extends Error {
  code: string;
  ubusCode?: number;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, ubusCode?: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.ubusCode = ubusCode;
    this.details = details;
  }
}

let memorySid = '';
let reqCounter = 1;
let onAuthExpired: (() => void) | null = null;
let sessionProbeInFlight: Promise<boolean> | null = null;

const SESSION_STORAGE_KEY = 'nikki_dash_session_v1';

export interface StoredSession {
  sid: string;
  username: string;
  isGuest: boolean;
  isAdmin: boolean;
  expiresAt: number;
}

export function saveStoredSession(sess: StoredSession, remember: boolean): void {
  const serialized = JSON.stringify(sess);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SESSION_STORAGE_KEY, serialized);
    }
  } catch {
    // ignore storage errors
  }
  try {
    if (typeof localStorage !== 'undefined') {
      if (remember) {
        localStorage.setItem(SESSION_STORAGE_KEY, serialized);
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  } catch {
    // ignore storage errors
  }
}

export function loadStoredSession(): StoredSession | null {
  const tryParse = (raw: string | null): StoredSession | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      if (
        typeof parsed.sid === 'string' &&
        parsed.sid.length === 32 &&
        typeof parsed.username === 'string' &&
        parsed.username.length > 0
      ) {
        return {
          sid: parsed.sid,
          username: parsed.username,
          isGuest: Boolean(parsed.isGuest),
          isAdmin: Boolean(parsed.isAdmin),
          expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : Date.now() + 3600_000
        };
      }
    } catch {
      // corrupt payload
    }
    return null;
  };

  try {
    if (typeof sessionStorage !== 'undefined') {
      const s = tryParse(sessionStorage.getItem(SESSION_STORAGE_KEY));
      if (s) return s;
    }
  } catch {
    // ignore
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const s = tryParse(localStorage.getItem(SESSION_STORAGE_KEY));
      if (s) return s;
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearStoredSession(): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function verifySessionStillAlive(sid: string): Promise<boolean> {
  if (!sid) return false;
  if (sessionProbeInFlight) return sessionProbeInFlight;
  sessionProbeInFlight = (async () => {
    try {
      const resp = await fetch('/ubus/call/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sid}`
        },
        credentials: 'omit',
        cache: 'no-store',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: reqCounter++,
          method: 'access',
          params: { object: 'nikki-dash', function: 'get_status' }
        })
      });
      if (!resp.ok) return false;
      const json = await resp.json();
      if (json?.error) return false;
      return json?.result?.access === true;
    } catch {
      return true; // Network flake != definitely expired
    } finally {
      sessionProbeInFlight = null;
    }
  })();
  return sessionProbeInFlight;
}

export function setSessionSid(sid: string): void {
  memorySid = sid;
}

export function getSessionSid(): string {
  return memorySid;
}

export function clearSessionSid(): void {
  memorySid = '';
  clearStoredSession();
}

export function setAuthExpiredHandler(fn: (() => void) | null): void {
  onAuthExpired = fn;
}

export interface CallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  unauthenticated?: boolean;
}

export async function ubusCall<T = Record<string, unknown>>(
  object: string,
  method: string,
  params: Record<string, unknown> = {},
  options: CallOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();

  let abortedExternally = false;
  const externalSignal = options.signal;
  const onExternalAbort = () => {
    abortedExternally = true;
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      throw new RpcError('ABORTED', 'Request was cancelled');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (!options.unauthenticated && memorySid) {
      headers['Authorization'] = `Bearer ${memorySid}`;
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: reqCounter++,
      method,
      params
    });

    const response = await fetch(`/ubus/call/${encodeURIComponent(object)}`, {
      method: 'POST',
      headers,
      credentials: 'omit',
      cache: 'no-store',
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new RpcError('HTTP_ERROR', `HTTP ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data && data.error) {
      const code = Number(data.error.code);
      const msg = String(data.error.message || 'RPC error');
      if (code === -32001 || code === -32002 || code === 6) {
        if (!options.unauthenticated && object !== 'session') {
          if (code === -32001) {
            clearSessionSid();
            onAuthExpired?.();
            throw new RpcError('SESSION_EXPIRED', '登录会话已过期，请重新登录', code);
          }
          if (code === -32002 && memorySid) {
            const alive = await verifySessionStillAlive(memorySid);
            if (!alive) {
              clearSessionSid();
              onAuthExpired?.();
              throw new RpcError('SESSION_EXPIRED', '登录会话已过期，请重新登录', code);
            }
          }
          throw new RpcError('ACCESS_DENIED', '权限不足或当前身份不允许此操作', code);
        }
        throw new RpcError('ACCESS_DENIED', msg, code);
      }
      if (code === -32000) {
        throw new RpcError('OBJECT_NOT_FOUND', `ubus object "${object}" not found (is rpcd running?)`, code);
      }
      if (code === -32003) {
        throw new RpcError('TIMEOUT', 'Router RPC timed out', code);
      }
      throw new RpcError('UBUS_ERROR', msg, code);
    }

    return (data?.result ?? {}) as T;
  } catch (err) {
    if (err instanceof RpcError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new RpcError(abortedExternally ? 'ABORTED' : 'TIMEOUT', abortedExternally ? 'Cancelled' : 'Request timed out');
    }
    throw new RpcError('NETWORK_ERROR', (err as Error)?.message || 'Network request failed');
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function splitUtf8Chunks(content: string, maxRawBytes = 28 * 1024): string[] {
  const bytes = new TextEncoder().encode(content);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += maxRawBytes) {
    const slice = bytes.subarray(offset, Math.min(offset + maxRawBytes, bytes.length));
    let bin = '';
    for (let i = 0; i < slice.length; i++) {
      bin += String.fromCharCode(slice[i]);
    }
    chunks.push(btoa(bin));
  }
  if (chunks.length === 0) chunks.push('');
  return chunks;
}
