import { create } from 'zustand';

import { expenseContributionThisMonth } from '@/lib/expense-schedule';
import { incomeContributionThisMonth } from '@/lib/income-schedule';
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

type FinanceClock = {
  calendarDayKey: string;
};

export type FinanceStore = FinanceState & FinanceActions & FinanceClock;

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

function currentLocalDayKey(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function dateFromDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function clearLegacyStorage() {
  if (typeof window === 'undefined') return;
  for (const key of LEGACY_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
}

clearLegacyStorage();

export const useFinanceStore = create<FinanceStore>((set) => ({
  ...emptyFinanceState,
  calendarDayKey: currentLocalDayKey(),

  setCards: (cards) =>
    set((state) => ({
      profile: { ...state.profile, cards },
    })),

  setExpenses: (expenses) => set({ expenses }),

  setIncomes: (incomes) => set({ incomes }),

  clearAll: () =>
    set({ ...emptyFinanceState, calendarDayKey: currentLocalDayKey() }),
}));

if (typeof window !== 'undefined') {
  window.setInterval(() => {
    const nextKey = currentLocalDayKey();
    if (useFinanceStore.getState().calendarDayKey !== nextKey) {
      useFinanceStore.setState({ calendarDayKey: nextKey });
    }
  }, 60_000);
}

export function selectMonthlyIncome(state: FinanceStore) {
  const now = dateFromDayKey(state.calendarDayKey);
  return state.incomes.reduce(
    (sum, income) => sum + incomeContributionThisMonth(income, now),
    0,
  );
}

export function selectMonthlyExpenses(state: FinanceStore) {
  const now = dateFromDayKey(state.calendarDayKey);
  return state.expenses.reduce(
    (sum, expense) => sum + expenseContributionThisMonth(expense, now),
    0,
  );
}

export function selectAverageMonthlyExpense(state: FinanceStore) {
  if (state.history.length === 0) return selectMonthlyExpenses(state);
  const total = state.history.reduce((sum, item) => sum + item.expense, 0);
  return total / state.history.length;
}

export function selectRecurringShare(state: FinanceStore) {
  const income = selectMonthlyIncome(state);
  if (income <= 0) return 0;
  return selectMonthlyExpenses(state) / income;
}
