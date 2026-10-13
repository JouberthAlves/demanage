import type { QueryClient } from '@tanstack/react-query';

import type { CustomTagScope } from '@/types/finance';
import type { Asset } from '@/types/patrimony';

/** Single source of truth for React Query cache keys. */
export const queryKeys = {
  expenses: ['expenses'] as const,
  entries: ['entries'] as const,
  cards: ['cards'] as const,
  piggyBanks: {
    all: ['piggy-banks'] as const,
    list: (includeArchived: boolean) =>
      ['piggy-banks', 'list', { includeArchived }] as const,
    transactions: (piggyBankId: string | null) =>
      ['piggy-banks', piggyBankId, 'transactions'] as const,
  },
  assets: {
    all: ['assets'] as const,
    transactions: (asset: Asset) => ['assets', asset, 'transactions'] as const,
    history: (asset: Asset, from: string, to: string) =>
      ['assets', asset, 'history', from, to] as const,
  },
  patrimony: {
    all: ['patrimony'] as const,
    settings: ['patrimony', 'settings'] as const,
    history: (from?: string, to?: string) =>
      ['patrimony', 'history', from, to] as const,
  },
  customTags: (scope: CustomTagScope) => ['custom-tags', scope] as const,
};

/**
 * What else must be refetched when a domain changes on the server. Balances
 * (patrimony) depend on every ledger, piggy movements create expense/entry
 * rows, card changes can generate invoices, and asset trades touch all of it.
 */
const DEPENDENTS = {
  // Cards carry `committed`/`available`, which every expense change moves.
  expenses: [queryKeys.expenses, queryKeys.cards, queryKeys.patrimony.all],
  entries: [queryKeys.entries, queryKeys.patrimony.all],
  cards: [queryKeys.cards, queryKeys.expenses, queryKeys.patrimony.all],
  piggyBanks: [
    queryKeys.piggyBanks.all,
    queryKeys.expenses,
    queryKeys.cards,
    queryKeys.entries,
    queryKeys.patrimony.all,
  ],
  assets: [
    queryKeys.assets.all,
    queryKeys.patrimony.all,
    queryKeys.expenses,
    queryKeys.cards,
    queryKeys.entries,
    queryKeys.piggyBanks.all,
  ],
  patrimony: [queryKeys.patrimony.all],
  profile: [queryKeys.entries, queryKeys.patrimony.all],
} as const;

export type InvalidationDomain = keyof typeof DEPENDENTS;

export function invalidateDomain(
  queryClient: QueryClient,
  domain: InvalidationDomain,
) {
  return Promise.all(
    DEPENDENTS[domain].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}
