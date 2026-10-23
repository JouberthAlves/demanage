import { QueryClient } from '@tanstack/react-query';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancelDailyMaintenance,
  runDailyMaintenance,
} from '@/lib/daily-maintenance';

function createClock() {
  const pending = new Set<() => void>();
  return {
    pending,
    scheduleRetry: (_delay: number, callback: () => void) => {
      pending.add(callback);
      return () => {
        pending.delete(callback);
      };
    },
    fire: () => {
      const [next] = pending;
      assert.ok(next, 'expected a scheduled retry');
      pending.delete(next);
      next();
    },
  };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('one card job per QueryClient/day despite multiple observers and an in-flight request', async () => {
  const client = new QueryClient();
  let calls = 0;
  let finish!: (value: { createdCount: number }) => void;
  const job = () => {
    calls += 1;
    return new Promise<{ createdCount: number }>((resolve) => {
      finish = resolve;
    });
  };
  const options = { run: job, needsRetry: () => false };

  runDailyMaintenance(client, 'cards', '2026-10-23', options);
  runDailyMaintenance(client, 'cards', '2026-10-23', options);
  assert.equal(calls, 1);
  finish({ createdCount: 0 });
  await tick();
  runDailyMaintenance(client, 'cards', '2026-10-23', options);
  assert.equal(calls, 1);

  runDailyMaintenance(client, 'cards', '2026-10-24', options);
  assert.equal(calls, 2, 'new financial day must run without remount');
  finish({ createdCount: 1 });
  await tick();
  runDailyMaintenance(new QueryClient(), 'cards', '2026-10-24', options);
  assert.equal(calls, 3, 'another account/client runs independently');
  finish({ createdCount: 0 });
  cancelDailyMaintenance(client);
});

test('partial piggy result retries twice, deduplicates observers and caps requests', async () => {
  const client = new QueryClient();
  const clock = createClock();
  const results = [
    { autoDebitFailedCount: 1, interestStale: true },
    { autoDebitFailedCount: 1, interestStale: false },
    { autoDebitFailedCount: 1, interestStale: false },
  ];
  let calls = 0;
  const options = {
    run: async () => {
      const result = results[calls++];
      assert.ok(result);
      return result;
    },
    needsRetry: (result: (typeof results)[number]) =>
      result.autoDebitFailedCount > 0 || result.interestStale,
    scheduleRetry: clock.scheduleRetry,
  };

  runDailyMaintenance(client, 'piggyBanks', '2026-10-23', options);
  await tick();
  assert.equal(calls, 1);
  assert.equal(clock.pending.size, 1);
  runDailyMaintenance(client, 'piggyBanks', '2026-10-23', options);
  assert.equal(calls, 1);
  clock.fire();
  await tick();
  assert.equal(calls, 2);
  assert.equal(clock.pending.size, 1);
  clock.fire();
  await tick();
  assert.equal(calls, 3);
  assert.equal(clock.pending.size, 0, 'finite budget exhausted');
  runDailyMaintenance(client, 'piggyBanks', '2026-10-23', options);
  assert.equal(calls, 3);
  cancelDailyMaintenance(client);
});

test('failure and day rollover cancel superseded retries and detached QueryClients', async () => {
  const client = new QueryClient();
  const clock = createClock();
  let calls = 0;
  const options = {
    run: async () => {
      calls += 1;
      throw new Error('network');
    },
    needsRetry: () => false,
    scheduleRetry: clock.scheduleRetry,
  };

  runDailyMaintenance(client, 'cards', '2026-10-23', options);
  await tick();
  assert.equal(clock.pending.size, 1);
  runDailyMaintenance(client, 'cards', '2026-10-24', options);
  assert.equal(
    clock.pending.size,
    0,
    'old day timer removed before starting fresh job',
  );
  await tick();
  assert.equal(calls, 2);
  assert.equal(clock.pending.size, 1);
  cancelDailyMaintenance(client);
  assert.equal(clock.pending.size, 0);
});

test('a delayed previous-day result cannot schedule retries or invalidate the new day', async () => {
  const client = new QueryClient();
  const clock = createClock();
  let resolvePrevious!: (value: { interestStale: boolean }) => void;
  let updates = 0;
  const run = () =>
    new Promise<{ interestStale: boolean }>((resolve) => {
      resolvePrevious = resolve;
    });
  const options = {
    run,
    needsRetry: (result: { interestStale: boolean }) => result.interestStale,
    onResult: () => {
      updates++;
    },
    scheduleRetry: clock.scheduleRetry,
  };

  runDailyMaintenance(client, 'piggyBanks', '2026-10-23', options);
  const oldResolution = resolvePrevious;
  runDailyMaintenance(client, 'piggyBanks', '2026-10-24', options);
  oldResolution({ interestStale: true });
  await tick();
  assert.equal(updates, 0);
  assert.equal(clock.pending.size, 0);

  resolvePrevious({ interestStale: false });
  await tick();
  assert.equal(updates, 1);
  assert.equal(clock.pending.size, 0);
  cancelDailyMaintenance(client);
});
