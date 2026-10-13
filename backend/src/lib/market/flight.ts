const inflight = new Map<string, Promise<unknown>>();
const lastRefresh = new Map<string, number>();

/**
 * Coalesces concurrent identical requests into one. Callers MUST NOT mutate
 * the shared result; wrap it (see series.cloneSeries) before handing it out.
 */
export function singleFlight<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function markRefreshed(key: string, now = Date.now()) {
  lastRefresh.set(key, now);
}

export function refreshedWithin(key: string, ms: number, now = Date.now()) {
  return now - (lastRefresh.get(key) ?? 0) < ms;
}
