import { create } from 'zustand';

import type {
  Card,
  FinanceState,
  Income,
  RecurringExpense,
} from '@/types/finance';

type FinanceActions = {
  setCards: (cards: Card[]) => void;
  setExpenses: (expenses: RecurringExpense[]) => void;
  setIncomes: (incomes: Income[]) => void;
  clearAll: () => void;
};

export type FinanceStore = FinanceState & FinanceActions;

const emptyFinanceState: FinanceState = {
  profile: {
    cards: [],
  },
  expenses: [],
  incomes: [],
  history: [],
};

const LEGACY_STORAGE_KEYS = [
  'demanage-finance',
  'demanage-finance-v2',
  'demanage-finance-v3',
];

function clearLegacyStorage() {
  if (typeof window === 'undefined') return;
  for (const key of LEGACY_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
}

clearLegacyStorage();

export const useFinanceStore = create<FinanceStore>((set) => ({
  ...emptyFinanceState,

  setCards: (cards) =>
    set((state) => ({
      profile: { ...state.profile, cards },
    })),

  setExpenses: (expenses) => set({ expenses }),

  setIncomes: (incomes) => set({ incomes }),

  clearAll: () => set({ ...emptyFinanceState }),
}));

export function selectMonthlyIncome(state: FinanceState) {
  return state.incomes
    .filter((income) => income.frequency === 'mensal')
    .reduce((sum, income) => sum + income.amount, 0);
}

export function selectMonthlyExpenses(state: FinanceState) {
  return state.expenses.reduce((sum, expense) => sum + expense.amount, 0);
}

export function selectAverageMonthlyExpense(state: FinanceState) {
  if (state.history.length === 0) return selectMonthlyExpenses(state);
  const total = state.history.reduce((sum, item) => sum + item.expense, 0);
  return total / state.history.length;
}

export function selectRecurringShare(state: FinanceState) {
  const income = selectMonthlyIncome(state);
  if (income <= 0) return 0;
  return selectMonthlyExpenses(state) / income;
}
