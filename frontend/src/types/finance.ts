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
  | 'cofrinho';

export type PiggyBank = {
  id: string;
  name: string;
  goalAmount: number;
  targetDate: string;
  monthlyGoal: number;
  autoDebit: boolean;
  isEmergency: boolean;
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
  type: 'deposit' | 'withdraw';
  source: 'manual' | 'auto_debit';
  amount: number;
  date: string;
  expenseId: string | null;
  entryId: string | null;
  note: string | null;
  createdAt: string;
};
export type ExpenseFrequency = 'mensal' | 'semanal' | 'unica';

export type RecurringExpense = {
  id: string;
  name: string;
  amount: number;
  category: ExpenseCategory;
  frequency: ExpenseFrequency;
  cardId?: string;
  /** Dia do mês (1-31) em que a despesa entra no saldo. */
  dueDay?: number;
  /** YYYY-MM-DD — primeira data de desconto (mês/ano de início). */
  startsAt?: string;
  /** YYYY-MM-DD — após essa data a recorrência para. */
  endsAt?: string;
  /** Data de registro (YYYY-MM-DD), usada em despesas únicas. */
  registeredAt?: string;
  notes?: string;
  isInvoice?: boolean;
  customTagId?: string;
  customTag?: Pick<CustomTag, 'id' | 'name' | 'color'>;
};

export type IncomeType = 'salario' | 'freelance' | 'outro';
export type IncomeFrequency = 'mensal' | 'semanal' | 'unica';

export type Income = {
  id: string;
  name: string;
  amount: number;
  type: IncomeType;
  frequency: IncomeFrequency;
  /** Dia do mês (1-31) em que a entrada entra no saldo. */
  receiveDay?: number;
  /** YYYY-MM-DD — primeira data de recebimento (mês/ano de início). */
  startsAt?: string;
  /** YYYY-MM-DD — após essa data a recorrência para. */
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
