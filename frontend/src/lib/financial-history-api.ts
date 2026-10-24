import { api } from '@/lib/api';
import { type ApiEntry, mapEntryToIncome } from '@/lib/entries-api';
import { type ApiExpense, mapExpenseToLocal } from '@/lib/expenses-api';

/** Independent historical source; normal /entries and /expenses remain CRUD-only. */
export async function listFinancialHistory() {
  const { data } = await api.get<{
    expenses: ApiExpense[];
    incomes: ApiEntry[];
  }>('/financial-history');
  return {
    expenses: data.expenses.map(mapExpenseToLocal),
    incomes: data.incomes.map(mapEntryToIncome),
  };
}
