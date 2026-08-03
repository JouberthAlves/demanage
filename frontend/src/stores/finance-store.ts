import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type {
  Card,
  FinanceState,
  Income,
  Profile,
  RecurringExpense,
} from '@/types/finance';

type FinanceActions = {
  updateProfile: (patch: Partial<Omit<Profile, 'cards'>>) => void;
  setCards: (cards: Card[]) => void;
  setExpenses: (expenses: RecurringExpense[]) => void;
  setIncomes: (incomes: Income[]) => void;
  clearAll: () => void;
};

export type FinanceStore = FinanceState & FinanceActions;

const emptyFinanceState: FinanceState = {
  profile: {
    name: '',
    salary: 0,
    notes: undefined,
    cards: [],
  },
  expenses: [],
  incomes: [],
  history: [],
};

export const useFinanceStore = create<FinanceStore>()(
  persist(
    (set) => ({
      ...emptyFinanceState,

      updateProfile: (patch) =>
        set((state) => ({
          profile: { ...state.profile, ...patch },
        })),

      setCards: (cards) =>
        set((state) => ({
          profile: { ...state.profile, cards },
        })),

      setExpenses: (expenses) => set({ expenses }),

      setIncomes: (incomes) => set({ incomes }),

      clearAll: () => set({ ...emptyFinanceState }),
    }),
    {
      name: 'demanage-finance-v3',
      partialize: (state) => ({
        profile: {
          name: state.profile.name,
          salary: state.profile.salary,
          notes: state.profile.notes,
          cards: [],
        },
        history: state.history,
      }),
    },
  ),
);

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
