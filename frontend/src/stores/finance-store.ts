import { create } from "zustand"
import { persist } from "zustand/middleware"

import { financeSeed } from "@/data/seed"
import type {
  Card,
  FinanceState,
  Income,
  Profile,
  RecurringExpense,
} from "@/types/finance"
import { createId } from "@/lib/format"

type FinanceActions = {
  updateProfile: (patch: Partial<Omit<Profile, "cards">>) => void
  addCard: (card: Omit<Card, "id">) => void
  updateCard: (id: string, patch: Partial<Omit<Card, "id">>) => void
  removeCard: (id: string) => void
  addExpense: (expense: Omit<RecurringExpense, "id">) => void
  updateExpense: (
    id: string,
    patch: Partial<Omit<RecurringExpense, "id">>,
  ) => void
  removeExpense: (id: string) => void
  addIncome: (income: Omit<Income, "id">) => void
  updateIncome: (id: string, patch: Partial<Omit<Income, "id">>) => void
  removeIncome: (id: string) => void
  resetToSeed: () => void
}

export type FinanceStore = FinanceState & FinanceActions

export const useFinanceStore = create<FinanceStore>()(
  persist(
    (set) => ({
      ...financeSeed,

      updateProfile: (patch) =>
        set((state) => ({
          profile: { ...state.profile, ...patch },
        })),

      addCard: (card) =>
        set((state) => ({
          profile: {
            ...state.profile,
            cards: [...state.profile.cards, { ...card, id: createId("card") }],
          },
        })),

      updateCard: (id, patch) =>
        set((state) => ({
          profile: {
            ...state.profile,
            cards: state.profile.cards.map((card) =>
              card.id === id ? { ...card, ...patch } : card,
            ),
          },
        })),

      removeCard: (id) =>
        set((state) => ({
          profile: {
            ...state.profile,
            cards: state.profile.cards.filter((card) => card.id !== id),
          },
          expenses: state.expenses.map((expense) =>
            expense.cardId === id ? { ...expense, cardId: undefined } : expense,
          ),
        })),

      addExpense: (expense) =>
        set((state) => ({
          expenses: [
            ...state.expenses,
            { ...expense, id: createId("exp") },
          ],
        })),

      updateExpense: (id, patch) =>
        set((state) => ({
          expenses: state.expenses.map((expense) =>
            expense.id === id ? { ...expense, ...patch } : expense,
          ),
        })),

      removeExpense: (id) =>
        set((state) => ({
          expenses: state.expenses.filter((expense) => expense.id !== id),
        })),

      addIncome: (income) =>
        set((state) => ({
          incomes: [...state.incomes, { ...income, id: createId("inc") }],
        })),

      updateIncome: (id, patch) =>
        set((state) => ({
          incomes: state.incomes.map((income) =>
            income.id === id ? { ...income, ...patch } : income,
          ),
        })),

      removeIncome: (id) =>
        set((state) => ({
          incomes: state.incomes.filter((income) => income.id !== id),
        })),

      resetToSeed: () => set({ ...financeSeed }),
    }),
    {
      name: "demanage-finance",
    },
  ),
)

export function selectMonthlyIncome(state: FinanceState) {
  return state.incomes
    .filter((income) => income.frequency === "mensal")
    .reduce((sum, income) => sum + income.amount, 0)
}

export function selectMonthlyExpenses(state: FinanceState) {
  return state.expenses.reduce((sum, expense) => sum + expense.amount, 0)
}

export function selectAverageMonthlyExpense(state: FinanceState) {
  if (state.history.length === 0) return selectMonthlyExpenses(state)
  const total = state.history.reduce((sum, item) => sum + item.expense, 0)
  return total / state.history.length
}

export function selectRecurringShare(state: FinanceState) {
  const income = selectMonthlyIncome(state)
  if (income <= 0) return 0
  return selectMonthlyExpenses(state) / income
}
