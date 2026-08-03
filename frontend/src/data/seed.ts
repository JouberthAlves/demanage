import type {
  FinanceState,
  Income,
  MonthlySnapshot,
  RecurringExpense,
} from "@/types/finance"

const cardNubankId = "card-nubank"
const cardInterId = "card-inter"

export const EXPENSE_CATEGORY_LABELS: Record<
  RecurringExpense["category"],
  string
> = {
  assinatura: "Assinatura",
  parcela: "Parcela",
  divida: "Dívida",
  outro: "Outro",
}

export const INCOME_TYPE_LABELS: Record<Income["type"], string> = {
  salario: "Salário",
  freelance: "Freelance",
  outro: "Outro",
}

export const INCOME_FREQUENCY_LABELS: Record<Income["frequency"], string> = {
  mensal: "Mensal",
  unica: "Única",
}

const seedExpenses: RecurringExpense[] = [
  {
    id: "exp-netflix",
    name: "Netflix",
    amount: 55.9,
    category: "assinatura",
    frequency: "mensal",
    cardId: cardNubankId,
    dueDay: 10,
  },
  {
    id: "exp-spotify",
    name: "Spotify",
    amount: 34.9,
    category: "assinatura",
    frequency: "mensal",
    cardId: cardNubankId,
    dueDay: 12,
  },
  {
    id: "exp-notebook",
    name: "Notebook (parcela 4/12)",
    amount: 416.58,
    category: "parcela",
    frequency: "mensal",
    cardId: cardInterId,
    dueDay: 5,
  },
  {
    id: "exp-academia",
    name: "Academia",
    amount: 129.9,
    category: "assinatura",
    frequency: "mensal",
    dueDay: 1,
  },
  {
    id: "exp-emprestimo",
    name: "Empréstimo pessoal",
    amount: 680,
    category: "divida",
    frequency: "mensal",
    dueDay: 15,
  },
]

const seedIncomes: Income[] = [
  {
    id: "inc-salary",
    name: "Salário",
    amount: 7500,
    type: "salario",
    frequency: "mensal",
  },
  {
    id: "inc-freelance",
    name: "Freelance design",
    amount: 1200,
    type: "freelance",
    frequency: "mensal",
  },
]

const seedHistory: MonthlySnapshot[] = [
  { month: "2025-10", income: 8200, expense: 4100 },
  { month: "2025-11", income: 8500, expense: 3950 },
  { month: "2025-12", income: 9100, expense: 5200 },
  { month: "2026-01", income: 8700, expense: 4300 },
  { month: "2026-02", income: 8600, expense: 4050 },
  { month: "2026-03", income: 8700, expense: 1317.28 },
]

export const financeSeed: FinanceState = {
  profile: {
    name: "Jouberth",
    salary: 7500,
    notes: "Meta: guardar 20% da renda todo mês.",
    cards: [
      {
        id: cardNubankId,
        name: "Nubank",
        limit: 8000,
        closingDay: 2,
        dueDay: 10,
      },
      {
        id: cardInterId,
        name: "Inter",
        limit: 5000,
        closingDay: 20,
        dueDay: 28,
      },
    ],
  },
  expenses: seedExpenses,
  incomes: seedIncomes,
  history: seedHistory,
}
