import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ubusCall,
  setSessionSid,
  clearSessionSid,
  getSessionSid,
  setAuthExpiredHandler,
  splitUtf8Chunks,
  RpcError
} from '../frontend/src/api/ubus';

describe('ubus HTTP client security & resilience', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    clearSessionSid();
    setAuthExpiredHandler(null);
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('keeps SID strictly in memory and sends via Authorization Bearer with credentials=omit', async () => {
    setSessionSid('0123456789abcdef0123456789abcdef');
    expect(document.cookie).toBe('');
    expect(localStorage.length).toBe(0);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const res = await ubusCall<{ ok: boolean }>('nikki-dash', 'get_status', {});
    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/ubus/call/nikki-dash');
    expect(init.credentials).toBe('omit');
    expect(init.headers['Authorization']).toBe('Bearer 0123456789abcdef0123456789abcdef');
  });

  it('clears SID and fires expired handler on -32001 session not found', async () => {
    setSessionSid('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const onExp = vi.fn();
    setAuthExpiredHandler(onExp);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'Session not found' } })
    }) as unknown as typeof fetch;

    await expect(ubusCall('nikki-dash', 'get_status')).rejects.toBeInstanceOf(RpcError);
    expect(getSessionSid()).toBe('');
    expect(onExp).toHaveBeenCalledTimes(1);
  });

  it('splits large UTF-8 YAML into base64 chunks under uhttpd 64 KiB POST limit', () => {
    const bigYaml = 'proxies:\n' + '  - name: "节点-🚀"\n'.repeat(3000);
    const chunks = splitUtf8Chunks(bigYaml, 28 * 1024);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.length).toBeLessThan(48 * 1024);
    }
    // Reassemble and verify exact round-trip
    const rawParts = chunks.map((b64) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    });
    const total = rawParts.reduce((a, b) => a + b.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const p of rawParts) {
      joined.set(p, offset);
      offset += p.length;
    }
    expect(new TextDecoder().decode(joined)).toBe(bigYaml);
  });
});
