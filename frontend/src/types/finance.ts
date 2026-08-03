export type Card = {
  id: string;
  name: string;
  limit?: number;
  closingDay?: number;
  dueDay?: number;
};

export type Profile = {
  cards: Card[];
};

export type ExpenseCategory = 'assinatura' | 'parcela' | 'divida' | 'outro';

export type RecurringExpense = {
  id: string;
  name: string;
  amount: number;
  category: ExpenseCategory;
  frequency: 'mensal';
  cardId?: string;
  dueDay?: number;
  notes?: string;
};

export type IncomeType = 'salario' | 'freelance' | 'outro';
export type IncomeFrequency = 'mensal' | 'unica';

export type Income = {
  id: string;
  name: string;
  amount: number;
  type: IncomeType;
  frequency: IncomeFrequency;
  date?: string;
};

export type MonthlySnapshot = {
  month: string;
  income: number;
  expense: number;
};

export type FinanceState = {
  profile: Profile;
  expenses: RecurringExpense[];
  incomes: Income[];
  history: MonthlySnapshot[];
};
