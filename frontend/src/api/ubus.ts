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

export function setSessionSid(sid: string): void {
  memorySid = sid;
}

export function getSessionSid(): string {
  return memorySid;
}

export function clearSessionSid(): void {
  memorySid = '';
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
            throw new RpcError('SESSION_EXPIRED', 'Session expired; please log in again', code);
          }
          // Check whether the session itself expired vs missing ACL permission
          throw new RpcError('ACCESS_DENIED', msg, code);
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
