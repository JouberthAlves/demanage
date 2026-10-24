import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';
import assert from 'node:assert/strict';
import test from 'node:test';

import { usePiggyTotal } from '@/hooks/use-piggy-banks';
import { api } from '@/lib/api';
import { listPiggyBanks } from '@/lib/piggy-api';
import { queryKeys } from '@/lib/query-keys';
import type { PiggyBank } from '@/types/finance';

const active = { id: 'active', balance: 50, archivedAt: null } as PiggyBank;
const archived = {
  id: 'archived',
  balance: 125.5,
  archivedAt: '2026-10-20T12:00:00.000Z',
} as PiggyBank;

test('dashboard totals archived and active piggy balances while active-only cache stays separate', () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  });
  client.setQueryData(queryKeys.piggyBanks.list(false), [active]);
  client.setQueryData(queryKeys.piggyBanks.list(true), [active, archived]);

  function BalanceProbe() {
    const { total } = usePiggyTotal();
    return createElement('output', null, String(total));
  }
  const result = renderToString(
    createElement(QueryClientProvider, { client }, createElement(BalanceProbe)),
  );
  assert.match(result, />175\.5<\/output>/);
  assert.deepEqual(client.getQueryData(queryKeys.piggyBanks.list(false)), [
    active,
  ]);
  client.clear();
});

test('archived piggy query is explicit, ordinary CRUD query remains active-only', async () => {
  const original = api.defaults.adapter;
  const requests: unknown[] = [];
  api.defaults.adapter = async (config): Promise<AxiosResponse> => {
    requests.push(config.params);
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      data: config.params?.includeArchived ? [active, archived] : [active],
    };
  };
  try {
    assert.deepEqual(await listPiggyBanks(), [active]);
    assert.deepEqual(await listPiggyBanks(true), [active, archived]);
    assert.deepEqual(requests, [undefined, { includeArchived: true }]);
  } finally {
    api.defaults.adapter = original;
  }
});
