import type { QueryClient } from '@tanstack/react-query';

import type { DayKey } from '@/lib/dates';

type DailyJob = 'cards' | 'piggyBanks';
type RetryScheduler = (delayMs: number, callback: () => void) => () => void;

type JobState = {
  day: DayKey;
  attempts: number;
  retired: boolean;
  cancelRetry?: () => void;
};

const jobs = new WeakMap<QueryClient, Map<DailyJob, JobState>>();
const MAX_ATTEMPTS_PER_DAY = 3;

const scheduleRetry: RetryScheduler = (delayMs, callback) => {
  const id = setTimeout(callback, delayMs);
  return () => clearTimeout(id);
};

/**
 * Idempotent per QueryClient, financial day and job. Retries partial responses
 * and network failures twice with backoff, even without remounting observers.
 */
export function runDailyMaintenance<T>(
  client: QueryClient,
  kind: DailyJob,
  day: DayKey,
  options: {
    run: () => Promise<T>;
    needsRetry: (result: T) => boolean;
    onResult?: (result: T) => Promise<unknown> | unknown;
    onError?: () => void;
    onPartial?: (result: T) => void;
    scheduleRetry?: RetryScheduler;
  },
) {
  let byKind = jobs.get(client);
  if (!byKind) {
    byKind = new Map();
    jobs.set(client, byKind);
  }
  const registry = byKind;

  const old = registry.get(kind);
  // A stale observer must never retire maintenance for a newer day.
  if (old && old.day > day) return;
  if (old?.day === day) return;
  if (old) {
    old.retired = true;
    old.cancelRetry?.();
  }

  const state: JobState = { day, attempts: 0, retired: false };
  registry.set(kind, state);
  const isCurrent = () => !state.retired && registry.get(kind) === state;

  const retry = () => {
    if (!isCurrent() || state.attempts >= MAX_ATTEMPTS_PER_DAY) return;
    state.cancelRetry = (options.scheduleRetry ?? scheduleRetry)(
      60_000 * state.attempts,
      () => {
        state.cancelRetry = undefined;
        void attempt();
      },
    );
  };

  const attempt = async () => {
    if (!isCurrent()) return;
    state.attempts++;
    try {
      const result = await options.run();
      if (!isCurrent()) return;
      await options.onResult?.(result);
      if (!isCurrent()) return;
      if (options.needsRetry(result)) {
        options.onPartial?.(result);
        retry();
      }
    } catch {
      if (!isCurrent()) return;
      options.onError?.();
      retry();
    }
  };

  void attempt();
}

/** Stop retries belonging to a previous authentication session. */
export function cancelDailyMaintenance(client: QueryClient) {
  const byKind = jobs.get(client);
  if (!byKind) return;
  for (const job of byKind.values()) {
    job.retired = true;
    job.cancelRetry?.();
  }
  jobs.delete(client);
}
