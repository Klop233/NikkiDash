import { useEffect, useRef, useCallback } from 'preact/hooks';

export interface PollingOptions {
  intervalMs: number;
  enabled: boolean;
  immediate?: boolean;
  refreshKey?: string | number;
}

/**
 * Safe polling hook with:
 * - AbortController cancellation on unmount / next tick
 * - Monotonic sequence guard so stale responses can never overwrite fresh state
 * - Automatic pause when document.visibilityState === 'hidden'
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  onData: (data: T) => void,
  onError: ((err: unknown) => void) | undefined,
  options: PollingOptions
) {
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const fetcherRef = useRef(fetcher);
  const onDataRef = useRef(onData);
  const onErrorRef = useRef(onError);

  fetcherRef.current = fetcher;
  onDataRef.current = onData;
  onErrorRef.current = onError;

  const runOnce = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const seq = ++seqRef.current;

    try {
      const res = await fetcherRef.current(ctrl.signal);
      if (seq === seqRef.current && !ctrl.signal.aborted) {
        onDataRef.current(res);
      }
    } catch (err) {
      if (seq === seqRef.current && !ctrl.signal.aborted) {
        onErrorRef.current?.(err);
      }
    }
  }, []);

  useEffect(() => {
    if (!options.enabled) {
      abortRef.current?.abort();
      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    const startTimer = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        void runOnce();
      }, options.intervalMs);
    };

    const handleVis = () => {
      if (document.visibilityState === 'hidden') {
        abortRef.current?.abort();
      } else {
        void runOnce();
      }
    };

    if (options.immediate !== false) {
      void runOnce();
    }
    startTimer();

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVis);
    }

    return () => {
      if (timer) clearInterval(timer);
      abortRef.current?.abort();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVis);
      }
    };
  }, [options.enabled, options.intervalMs, options.immediate, options.refreshKey, runOnce]);

  return { refresh: runOnce };
}
