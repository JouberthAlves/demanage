export type Card = {
  id: string;
  name: string;
  limit?: number;
  closingDay?: number;
  expiresAt?: string;
  lastInvoicedOn?: string;
  expired?: boolean;
};

export type Profile = {
  cards: Card[];
};

export type CustomTagScope = 'expense' | 'income';

export type CustomTag = {
  id: string;
  scope: CustomTagScope;
  name: string;
  color: string;
};

export type ExpenseCategory =
  | 'assinatura'
  | 'parcela'
  | 'divida'
  | 'outro'
  | 'cofrinho'
  | 'investimento';

export type PiggyBank = {
  id: string;
  name: string;
  goalAmount: number | null;
  targetDate: string | null;
  monthlyGoal: number;
  autoDebit: boolean;
  autoDebitDay: number;
  isEmergency: boolean;
  yieldEnabled: boolean;
  cdiPercent: number;
  interestAccruedThrough: string | null;
  archivedAt: string | null;
  completedAt: string | null;
  balance: number;
  progress: number;
  remaining: number;
  createdAt: string;
  updatedAt: string;
};

export type PiggyTransaction = {
  id: string;
  piggyBankId: string;
  type: 'deposit' | 'withdraw' | 'interest';
  source: 'manual' | 'auto_debit' | 'yield';
  amount: number;
  date: string;
  expenseId: string | null;
  entryId: string | null;
  note: string | null;
  cdiRate: number | null;
  cdiPercent: number | null;
  baseBalance: number | null;
  resultingBalance: number | null;
  createdAt: string;
};

export type ExpenseFrequency = 'mensal' | 'semanal' | 'unica';
export type ExpenseSplitKind = 'card' | 'pix';

export type ExpenseSplit = {
  id?: string;
  kind: ExpenseSplitKind;
  cardId?: string | null;
  percent: number;
  amount: number;
  cardName?: string | null;
};

export type RecurringExpense = {
  id: string;
  name: string;
  amount: number;
  category: ExpenseCategory;
  frequency: ExpenseFrequency;
  cardId?: string;
  dueDay?: number;
  startsAt?: string;
  endsAt?: string;
  registeredAt?: string;
  notes?: string;
  isInvoice?: boolean;
  customTagId?: string;
  customTag?: Pick<CustomTag, 'id' | 'name' | 'color'>;
  splits?: ExpenseSplit[];
};

export type IncomeType = 'salario' | 'freelance' | 'outro';
export type IncomeFrequency = 'mensal' | 'semanal' | 'unica';

export type Income = {
  id: string;
  name: string;
  amount: number;
  type: IncomeType;
  frequency: IncomeFrequency;
  receiveDay?: number;
  startsAt?: string;
  endsAt?: string;
  date?: string;
  customTagId?: string;
  customTag?: Pick<CustomTag, 'id' | 'name' | 'color'>;
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
