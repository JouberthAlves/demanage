export type Card = {
  id: string;
  name: string;
  limit?: number;
  closingDay?: number;
  pendingClosingDay?: number | null;
  expiresAt?: string;
  lastInvoicedOn?: string;
  lastBillingProcessedAt?: string | null;
  createdAt?: string;
  expired?: boolean;
  /** Limit already committed in the current billing cycle (from the backend). */
  committed: number;
  /** Limit minus committed; null when the card has no limit. */
  available: number | null;
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
  'assinatura' | 'parcela' | 'divida' | 'outro' | 'cofrinho' | 'investimento';

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

export type ExpensePaymentOccurrence = {
  month: string;
  amount: number;
  paidAt: string;
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
  occurredAt?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  registeredAt?: string;
  paidForMonth?: string;
  paidAt?: string;
  createdAt?: string;
  notes?: string;
  isInvoice?: boolean;
  customTagId?: string;
  customTag?: Pick<CustomTag, 'id' | 'name' | 'color'>;
  splits?: ExpenseSplit[];
  payments?: ExpensePaymentOccurrence[];
};

export type IncomeType = 'salario' | 'freelance' | 'outro';
export type IncomeFrequency = 'mensal' | 'semanal' | 'unica';

export type EntryReceiptOccurrence = {
  month: string;
  amount: number;
  receivedAt: string;
};

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
  receiptHoldForMonth?: string;
  receivedForMonth?: string;
  receivedAt?: string;
  createdAt?: string;
  customTagId?: string;
  customTag?: Pick<CustomTag, 'id' | 'name' | 'color'>;
  receipts?: EntryReceiptOccurrence[];
};

export type MonthlySnapshot = {
  month: string;
  income: number;
  expense: number;
  hasActivity: boolean;
};

export type FinanceState = {
  profile: Profile;
  expenses: RecurringExpense[];
  incomes: Income[];
};
