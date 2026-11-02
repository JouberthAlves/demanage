import { api } from '@/lib/api';
import { type ApiEntry, mapEntryToIncome } from '@/lib/entries-api';
import { type ApiExpense, mapExpenseToLocal } from '@/lib/expenses-api';

export type FinancialHistoryPage = {
  snapshot: string;
  expenses: ApiExpense[];
  incomes: ApiEntry[];
  nextExpenseCursor: string | null;
  nextIncomeCursor: string | null;
};

/** Bounded transport reads; never publish an incomplete cash balance. */
export async function collectFinancialHistoryPages(
  getPage: (params: URLSearchParams) => Promise<FinancialHistoryPage>,
  signal?: AbortSignal,
) {
  const expenses: ApiExpense[] = [];
  const incomes: ApiEntry[] = [];
  let snapshot: string | undefined;
  let expenseCursor: string | undefined;
  let incomeCursor: string | undefined;
  const seenPositions = new Set<string>();

  for (let i = 0; i < 1000; i++) {
    signal?.throwIfAborted();
    const params = new URLSearchParams({ limit: '200' });
    if (snapshot) params.set('snapshot', snapshot);
    if (expenseCursor) params.set('expenseCursor', expenseCursor);
    if (incomeCursor) params.set('incomeCursor', incomeCursor);
    const data = await getPage(params);
    signal?.throwIfAborted();
    if (
      typeof data.snapshot !== 'string' || !Number.isFinite(Date.parse(data.snapshot)) ||
      (snapshot && data.snapshot !== snapshot) ||
      !Array.isArray(data.expenses) || !Array.isArray(data.incomes) ||
      (data.nextExpenseCursor !== null && typeof data.nextExpenseCursor !== 'string') ||
      (data.nextIncomeCursor !== null && typeof data.nextIncomeCursor !== 'string')
    ) throw new Error('Invalid financial history page');
    snapshot = data.snapshot;
    expenses.push(...data.expenses);
    incomes.push(...data.incomes);
    if (data.nextExpenseCursor === null && data.nextIncomeCursor === null) {
      return { expenses, incomes };
    }
    if ((data.nextExpenseCursor && !data.expenses.length) ||
        (data.nextIncomeCursor && !data.incomes.length)) {
      throw new Error('Financial history page did not advance');
    }
    expenseCursor = data.nextExpenseCursor ?? 'end';
    incomeCursor = data.nextIncomeCursor ?? 'end';
    const marker = `${snapshot}|${expenseCursor}|${incomeCursor}`;
    if (seenPositions.has(marker)) throw new Error('Financial history cursor repeated');
    seenPositions.add(marker);
  }
  throw new Error('Financial history exceeded safe page limit');
}

/** Independent historical source; normal /entries and /expenses remain CRUD-only. */
export async function listFinancialHistory(signal?: AbortSignal) {
  const data = await collectFinancialHistoryPages(async (params) => {
    const result = await api.get<FinancialHistoryPage>(`/financial-history?${params.toString()}`, { signal });
    return result.data;
  }, signal);
  return {
    expenses: data.expenses.map(mapExpenseToLocal),
    incomes: data.incomes.map(mapEntryToIncome),
  };
}
